"""AES-256-GCM backup encryption + scrypt-derived key.

The .loombackup file format is:
    [4-byte magic "LBK1"] [32-byte salt] [12-byte nonce] [ciphertext + 16-byte GCM tag]

Stage 2 reuse target: the scrypt parameters below are exported as module-level
constants so the cloud-sync KEK derivation can import them rather than
duplicating values. See `LoomAssist_Roadmap.md` §4.

⚠ Parameter discrepancy vs. roadmap §4. Roadmap states "n=2^17, r=8, p=1
(~1s on phone)". The existing production code (this module, extracted
verbatim from main.py) uses **n=2^14 (=16384)**. Existing encrypted backups
depend on this exact value for decryption — changing it would invalidate
every `.loombackup` file in the wild.

Stage 2's KEK derivation should pick its N value deliberately. If the
threat-model trade-off calls for a different N, define a separate
`KEK_SCRYPT_N` constant rather than mutating the value below.

Extracted from main.py in Stage 1 (substep 1A.3).
"""
from __future__ import annotations


# scrypt KDF parameters used by the .loombackup format.
# See module docstring for the n=2^14 vs. roadmap's n=2^17 discrepancy.
SCRYPT_N = 16384
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_KEY_LENGTH = 32  # bytes — AES-256


def _encrypt_backup(data: bytes, passphrase: str) -> bytes:
    from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import secrets as _secrets
    salt = _secrets.token_bytes(32)
    kdf = Scrypt(salt=salt, length=SCRYPT_KEY_LENGTH, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P)
    key = kdf.derive(passphrase.encode("utf-8"))
    aesgcm = AESGCM(key)
    nonce = _secrets.token_bytes(12)
    ciphertext = aesgcm.encrypt(nonce, data, None)
    # Format: 4-byte version | 32-byte salt | 12-byte nonce | ciphertext
    return b"LBK1" + salt + nonce + ciphertext


def _decrypt_backup(data: bytes, passphrase: str) -> bytes:
    from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.exceptions import InvalidTag
    if len(data) < 4 + 32 + 12 + 16:
        raise ValueError("File too short")
    if data[:4] != b"LBK1":
        raise ValueError("Not a .loombackup file")
    salt = data[4:36]
    nonce = data[36:48]
    ciphertext = data[48:]
    kdf = Scrypt(salt=salt, length=SCRYPT_KEY_LENGTH, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P)
    key = kdf.derive(passphrase.encode("utf-8"))
    aesgcm = AESGCM(key)
    try:
        return aesgcm.decrypt(nonce, ciphertext, None)
    except InvalidTag:
        raise ValueError("Wrong passphrase or corrupted backup")
