"""Self-signed TLS certificate + fingerprint helpers for LAN pairing.

Used by /pair/start (to identify this device over mDNS) and by the lifespan's
maybe_start_mdns hook.

Extracted from main.py in Stage 1 (substep 1A.5). No LLM dependency.
"""
from __future__ import annotations

from pathlib import Path


def _generate_self_signed_cert() -> tuple[str, str]:
    """Return (cert_pem, key_pem). Reuses existing files if present."""
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    import datetime as _dt

    cert_dir = Path("./certs")
    cert_dir.mkdir(exist_ok=True)
    cert_file = cert_dir / "loom.crt"
    key_file  = cert_dir / "loom.key"

    if cert_file.exists() and key_file.exists():
        return cert_file.read_text(), key_file.read_text()

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "loomassist")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(_dt.datetime.utcnow())
        .not_valid_after(_dt.datetime.utcnow() + _dt.timedelta(days=3650))
        .sign(private_key, hashes.SHA256())
    )
    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()
    key_pem  = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ).decode()
    cert_file.write_text(cert_pem)
    key_file.write_text(key_pem)
    return cert_pem, key_pem


def _cert_fingerprint(cert_pem: str) -> str:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization  # noqa: F401
    cert = x509.load_pem_x509_certificate(cert_pem.encode())
    return cert.fingerprint(hashes.SHA256()).hex()
