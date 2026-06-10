"""Stage 2 — vault crypto primitives.

Pure crypto: no DB, no FastAPI, no engine patching. Run in isolation per
the CLAUDE.md rule:
    cd backend-api && pytest tests/test_vault.py -v
"""
import pytest

from services.crypto.vault import (
    DEK_LENGTH,
    NONCE_LENGTH,
    VAULT_KEY_LENGTH,
    decrypt_record,
    derive_kek,
    encrypt_record,
    generate_dek,
    generate_salt,
    unwrap_dek,
    wrap_dek,
)


PASSWORD = "correct horse battery staple"


def _kek_pair():
    salt = generate_salt()
    return derive_kek(PASSWORD, salt), salt


def test_kek_deterministic():
    salt = generate_salt()
    a = derive_kek(PASSWORD, salt)
    b = derive_kek(PASSWORD, salt)
    assert a == b
    assert len(a) == VAULT_KEY_LENGTH


def test_kek_differs_by_salt():
    a = derive_kek(PASSWORD, generate_salt())
    b = derive_kek(PASSWORD, generate_salt())
    assert a != b


def test_kek_rejects_short_salt():
    with pytest.raises(ValueError, match="salt must be at least"):
        derive_kek(PASSWORD, b"\x00" * 8)


def test_dek_wrap_roundtrip():
    kek, _ = _kek_pair()
    dek = generate_dek()
    wrapped, nonce = wrap_dek(dek, kek)
    assert len(nonce) == NONCE_LENGTH
    assert wrapped != dek
    assert unwrap_dek(wrapped, nonce, kek) == dek


def test_dek_wrong_kek_fails():
    kek1, _ = _kek_pair()
    kek2, _ = _kek_pair()
    dek = generate_dek()
    wrapped, nonce = wrap_dek(dek, kek1)
    with pytest.raises(ValueError, match="wrong KEK"):
        unwrap_dek(wrapped, nonce, kek2)


@pytest.mark.parametrize("size", [0, 1, 32, 1024, 100 * 1024])
def test_record_encrypt_roundtrip(size):
    dek = generate_dek()
    plaintext = b"\xa5" * size
    ciphertext, nonce = encrypt_record(plaintext, dek)
    assert len(nonce) == NONCE_LENGTH
    assert decrypt_record(ciphertext, nonce, dek) == plaintext


def test_record_nonce_unique():
    dek = generate_dek()
    plaintext = b"the same plaintext every time"
    nonces = {encrypt_record(plaintext, dek)[1] for _ in range(100)}
    assert len(nonces) == 100


def test_record_tamper_detection():
    dek = generate_dek()
    ciphertext, nonce = encrypt_record(b"original payload", dek)
    tampered = bytearray(ciphertext)
    tampered[0] ^= 0x01
    with pytest.raises(ValueError, match="wrong DEK or corrupted"):
        decrypt_record(bytes(tampered), nonce, dek)


def test_record_wrong_dek_fails():
    dek1 = generate_dek()
    dek2 = generate_dek()
    ciphertext, nonce = encrypt_record(b"payload", dek1)
    with pytest.raises(ValueError, match="wrong DEK"):
        decrypt_record(ciphertext, nonce, dek2)


def test_password_change_rewrap():
    # Initial vault: derive KEK_old, wrap a DEK, encrypt a record with that DEK.
    salt_old = generate_salt()
    kek_old = derive_kek(PASSWORD, salt_old)
    dek = generate_dek()
    wrapped_old, wrap_nonce_old = wrap_dek(dek, kek_old)

    plaintext = b"survives the password change"
    ct, rec_nonce = encrypt_record(plaintext, dek)

    # Password change: new salt + KEK, rewrap the SAME DEK.
    new_password = "rosebud"
    salt_new = generate_salt()
    kek_new = derive_kek(new_password, salt_new)

    recovered_dek = unwrap_dek(wrapped_old, wrap_nonce_old, kek_old)
    assert recovered_dek == dek
    wrapped_new, wrap_nonce_new = wrap_dek(recovered_dek, kek_new)

    # Old wrapping is now defunct; records still decrypt under the unchanged DEK.
    final_dek = unwrap_dek(wrapped_new, wrap_nonce_new, kek_new)
    assert decrypt_record(ct, rec_nonce, final_dek) == plaintext

    # And the old KEK can no longer unwrap the new wrapping.
    with pytest.raises(ValueError):
        unwrap_dek(wrapped_new, wrap_nonce_new, kek_old)


def test_wrap_validates_key_lengths():
    with pytest.raises(ValueError, match="dek must be"):
        wrap_dek(b"\x00" * 16, b"\x00" * VAULT_KEY_LENGTH)
    with pytest.raises(ValueError, match="kek must be"):
        wrap_dek(b"\x00" * DEK_LENGTH, b"\x00" * 16)
