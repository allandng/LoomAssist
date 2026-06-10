"""KEK/DEK primitives + per-record AES-256-GCM for the v3.0 vault sync layer.

This module is the pure-crypto foundation for Stage 2 (AWS sync v0). It
does NOT touch the database, FastAPI, or the wire transport. Higher layers
(Stage 2C+) own envelope serialization, base64 boundaries, versioning,
tombstones, and request/response handling.

Two-layer key model (matches `LoomAssist_Roadmap.md` §4):

    password ──scrypt(salt)──▶ KEK ──AES-GCM──▶ wraps DEK (stored on server)
                                                       │
                                                       └─AES-GCM──▶ each record

Password change rewraps the DEK (cheap) rather than re-encrypting every
record (expensive). See `test_password_change_rewrap`.

Parameter choice — VAULT_SCRYPT_N = 2**17 — is deliberately slower than
the `.loombackup` value in services/crypto/backup.py (2**14). Backup KDF
runs once at user request on a desktop; vault KEK is derived under an
attacker's offline guessing budget if the server is ever compromised.
The threat-model trade-off is in §4.

Boundaries this module enforces:
- Inputs and outputs are raw `bytes`. No base64 here.
- Decrypt failures raise `ValueError` (mirrors backup.py's translation
  from `cryptography.exceptions.InvalidTag` so callers don't import the
  cryptography exception hierarchy).
- Every encrypt call generates a fresh nonce via `secrets.token_bytes`.
"""
from __future__ import annotations


VAULT_SCRYPT_N = 2 ** 17
VAULT_SCRYPT_R = 8
VAULT_SCRYPT_P = 1
VAULT_KEY_LENGTH = 32
DEK_LENGTH = 32
NONCE_LENGTH = 12
GCM_TAG_LENGTH = 16
MIN_SALT_LENGTH = 16


def derive_kek(password: str, salt: bytes) -> bytes:
    from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
    if len(salt) < MIN_SALT_LENGTH:
        raise ValueError(f"salt must be at least {MIN_SALT_LENGTH} bytes")
    kdf = Scrypt(
        salt=salt,
        length=VAULT_KEY_LENGTH,
        n=VAULT_SCRYPT_N,
        r=VAULT_SCRYPT_R,
        p=VAULT_SCRYPT_P,
    )
    return kdf.derive(password.encode("utf-8"))


def generate_salt() -> bytes:
    import secrets as _secrets
    return _secrets.token_bytes(32)


def generate_dek() -> bytes:
    import secrets as _secrets
    return _secrets.token_bytes(DEK_LENGTH)


def wrap_dek(dek: bytes, kek: bytes) -> tuple[bytes, bytes]:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import secrets as _secrets
    if len(dek) != DEK_LENGTH:
        raise ValueError(f"dek must be {DEK_LENGTH} bytes")
    if len(kek) != VAULT_KEY_LENGTH:
        raise ValueError(f"kek must be {VAULT_KEY_LENGTH} bytes")
    nonce = _secrets.token_bytes(NONCE_LENGTH)
    ciphertext = AESGCM(kek).encrypt(nonce, dek, None)
    return ciphertext, nonce


def unwrap_dek(wrapped: bytes, nonce: bytes, kek: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.exceptions import InvalidTag
    if len(kek) != VAULT_KEY_LENGTH:
        raise ValueError(f"kek must be {VAULT_KEY_LENGTH} bytes")
    try:
        return AESGCM(kek).decrypt(nonce, wrapped, None)
    except InvalidTag:
        raise ValueError("wrong KEK or corrupted wrapped DEK")


def encrypt_record(plaintext: bytes, dek: bytes) -> tuple[bytes, bytes]:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import secrets as _secrets
    if len(dek) != DEK_LENGTH:
        raise ValueError(f"dek must be {DEK_LENGTH} bytes")
    nonce = _secrets.token_bytes(NONCE_LENGTH)
    ciphertext = AESGCM(dek).encrypt(nonce, plaintext, None)
    return ciphertext, nonce


def decrypt_record(ciphertext: bytes, nonce: bytes, dek: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.exceptions import InvalidTag
    if len(dek) != DEK_LENGTH:
        raise ValueError(f"dek must be {DEK_LENGTH} bytes")
    try:
        return AESGCM(dek).decrypt(nonce, ciphertext, None)
    except InvalidTag:
        raise ValueError("wrong DEK or corrupted record")
