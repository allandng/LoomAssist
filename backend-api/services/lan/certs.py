"""Self-signed TLS certificate + fingerprint helpers for LAN pairing.

Used by /pair/start (to identify this device over mDNS) and by the lifespan's
maybe_start_mdns hook.

Certificate files live in ``core.paths.certs_dir()`` (backend-api/certs by
default, LOOM_CERTS_DIR / LOOM_DATA_DIR override) — never the CWD.

Extracted from main.py in Stage 1 (substep 1A.5). No LLM dependency.
"""
from __future__ import annotations

from pathlib import Path

from core.paths import certs_dir


def cert_file_path() -> Path:
    return certs_dir() / "loom.crt"


def key_file_path() -> Path:
    return certs_dir() / "loom.key"


def _generate_self_signed_cert() -> tuple[str, str]:
    """Return (cert_pem, key_pem). Reuses existing files if present."""
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    import datetime as _dt

    cert_dir = certs_dir()
    cert_dir.mkdir(parents=True, exist_ok=True)
    cert_file = cert_file_path()
    key_file  = key_file_path()

    if cert_file.exists() and key_file.exists():
        return cert_file.read_text(encoding="utf-8"), key_file.read_text(encoding="utf-8")

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "loomassist")])
    now = _dt.datetime.now(_dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + _dt.timedelta(days=3650))
        .sign(private_key, hashes.SHA256())
    )
    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()
    key_pem  = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ).decode()
    cert_file.write_text(cert_pem, encoding="utf-8")
    key_file.write_text(key_pem, encoding="utf-8")
    return cert_pem, key_pem


def _cert_fingerprint(cert_pem: str) -> str:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization  # noqa: F401
    cert = x509.load_pem_x509_certificate(cert_pem.encode())
    return cert.fingerprint(hashes.SHA256()).hex()
