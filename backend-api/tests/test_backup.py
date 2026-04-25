"""
Phase 13 — Encrypted Local Backup
Run in isolation:
    cd backend-api && pytest tests/test_backup.py -v
"""
import sys, io, os, struct
from unittest.mock import MagicMock, patch
from sqlmodel import create_engine, Session, SQLModel
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

import database.database as _db
_TEST_ENGINE = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
_db.engine = _TEST_ENGINE
_db.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_TEST_ENGINE)

sys.modules.setdefault("faster_whisper", MagicMock())
sys.modules["faster_whisper"].WhisperModel = MagicMock(return_value=MagicMock())
sys.modules.setdefault("ollama", MagicMock())
sys.modules.setdefault("pypdf", MagicMock())
sys.modules["pypdf"].PdfReader = MagicMock()
sys.modules.setdefault("sentence_transformers", MagicMock())

from main import app, get_db  # noqa: E402
from fastapi.testclient import TestClient
import pytest

app.dependency_overrides[get_db] = lambda: (yield Session(_TEST_ENGINE))
client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_db():
    SQLModel.metadata.create_all(_TEST_ENGINE)
    yield
    SQLModel.metadata.drop_all(_TEST_ENGINE)


# ── Helpers ────────────────────────────────────────────────────────────────

def _export(passphrase: str = "test-pass", include_audio: bool = False):
    return client.post("/backup/export", json={"passphrase": passphrase, "include_audio": include_audio})


def _import_backup(blob: bytes, passphrase: str, db_path: str):
    """POST /backup/import as multipart form."""
    files = {"file": ("test.loombackup", io.BytesIO(blob), "application/octet-stream")}
    data  = {"passphrase": passphrase}
    with patch("main.os.environ.get", side_effect=lambda k, d="": db_path if k == "LOOM_DB_PATH" else d), \
         patch("main.engine") as mock_eng, \
         patch("main.shutil.move"), \
         patch("main.shutil.copy2"):
        mock_eng.dispose = MagicMock()
        return client.post("/backup/import", files=files, data=data)


# ── Tests ──────────────────────────────────────────────────────────────────

def test_export_returns_loombackup_file():
    """Export with a passphrase returns binary content starting with the magic bytes LBK1."""
    with patch("main.os.path.exists", return_value=True), \
         patch("sqlite3.connect") as mock_sqlite:
        mock_conn = MagicMock()
        mock_sqlite.return_value = mock_conn

        # Make backup() copy nothing (it's an in-memory DB stub)
        def fake_backup(dst, **kwargs):
            pass
        mock_conn.backup = fake_backup
        mock_conn.__enter__ = lambda s: s
        mock_conn.__exit__ = MagicMock(return_value=False)

        r = _export("my-secret")
    assert r.status_code == 200
    assert r.content[:4] == b"LBK1"
    assert "Content-Disposition" in r.headers
    assert ".loombackup" in r.headers["Content-Disposition"]


def test_export_roundtrip_decrypt():
    """Exported bytes can be decrypted with the same passphrase."""
    from main import _encrypt_backup, _decrypt_backup
    import tarfile, io as _io

    # Build a minimal tar.gz containing a fake sqlite3 DB
    tar_buf = _io.BytesIO()
    fake_db = b"SQLite format 3\x00" + b"\x00" * 100
    with tarfile.open(fileobj=tar_buf, mode="w:gz") as tar:
        info = tarfile.TarInfo(name="loom.sqlite3")
        info.size = len(fake_db)
        tar.addfile(info, _io.BytesIO(fake_db))
    archive = tar_buf.getvalue()

    encrypted = _encrypt_backup(archive, "hunter2")
    decrypted = _decrypt_backup(encrypted, "hunter2")
    assert decrypted == archive


def test_decrypt_wrong_passphrase_raises():
    """Decrypting with wrong passphrase raises ValueError."""
    from main import _encrypt_backup, _decrypt_backup
    encrypted = _encrypt_backup(b"hello world", "correct")
    with pytest.raises(ValueError, match="Wrong passphrase"):
        _decrypt_backup(encrypted, "wrong")


def test_import_bad_magic_returns_400():
    """Submitting random bytes to /backup/import returns 400."""
    files = {"file": ("bad.loombackup", io.BytesIO(b"garbage data"), "application/octet-stream")}
    data  = {"passphrase": "anything"}
    r = client.post("/backup/import", files=files, data=data)
    assert r.status_code == 400
    assert "decrypt_failed" in r.text or "invalid_backup" in r.text


def test_export_missing_db_returns_404():
    """Export when the DB file does not exist returns 404."""
    with patch("main.os.path.exists", return_value=False):
        r = _export()
    assert r.status_code == 404
