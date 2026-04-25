"""
Phase 14 — LAN-Only Multi-Device Sync
Run in isolation:
    cd backend-api && pytest tests/test_sync.py -v
"""
import sys
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
sys.modules.setdefault("zeroconf", MagicMock())

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


# ── 14a: Pairing ──────────────────────────────────────────────────────────────

def test_pair_start_returns_six_digit_code():
    with patch("main._generate_self_signed_cert", return_value=("CERT", "KEY")), \
         patch("main._cert_fingerprint", return_value="abc123"):
        r = client.post("/pair/start")
    assert r.status_code == 200
    data = r.json()
    assert len(data["code"]) == 6
    assert data["code"].isdigit()
    assert data["cert_fingerprint"] == "abc123"


def test_pair_complete_invalid_code_returns_400():
    r = client.post("/pair/complete", json={
        "code": "000000",
        "peer_name": "MyPhone",
        "peer_cert_fingerprint": "deadbeef",
    })
    assert r.status_code == 400
    assert "invalid_code" in r.text


def test_pair_complete_valid_flow():
    import main as _m

    with patch("main._generate_self_signed_cert", return_value=("CERT", "KEY")), \
         patch("main._cert_fingerprint", return_value="fp123"):
        start = client.post("/pair/start").json()

    code = start["code"]
    # Force expiry to be far future
    _m._pairing_codes[code]["expires"] = "2099-01-01T00:00:00"

    r = client.post("/pair/complete", json={
        "code": code,
        "peer_name": "Laptop",
        "peer_cert_fingerprint": "remotefp",
    })
    assert r.status_code == 200
    assert r.json()["name"] == "Laptop"

    # Code should be consumed — second use returns 400
    r2 = client.post("/pair/complete", json={
        "code": code,
        "peer_name": "Laptop",
        "peer_cert_fingerprint": "remotefp",
    })
    assert r2.status_code == 400


def test_list_peers_returns_added_peer():
    import main as _m
    with patch("main._generate_self_signed_cert", return_value=("C", "K")), \
         patch("main._cert_fingerprint", return_value="fp"):
        code = client.post("/pair/start").json()["code"]
    _m._pairing_codes[code]["expires"] = "2099-01-01T00:00:00"
    client.post("/pair/complete", json={"code": code, "peer_name": "Tablet", "peer_cert_fingerprint": "fp2"})

    peers = client.get("/pair/peers").json()
    assert any(p["name"] == "Tablet" for p in peers)


# ── 14b: mDNS ─────────────────────────────────────────────────────────────────

def test_discovery_peers_returns_list():
    r = client.get("/discovery/peers")
    assert r.status_code == 200
    assert "peers" in r.json()


# ── 14c: Sync exchange ────────────────────────────────────────────────────────

def test_sync_exchange_returns_records_since():
    from datetime import datetime, timedelta
    import database.models as models

    with Session(_TEST_ENGINE) as db:
        # Create a calendar first (required for Event)
        cal = models.Calendar(name="Test", color="#fff")
        db.add(cal)
        db.commit()
        db.refresh(cal)
        cal_id = cal.id

        # Old event (before cutoff)
        old = models.Event(
            title="Old", start_time="2026-01-01T09:00:00", end_time="2026-01-01T10:00:00",
            calendar_id=cal_id, last_modified="2026-01-01T00:00:00",
        )
        # New event (after cutoff)
        new = models.Event(
            title="New", start_time="2026-05-01T09:00:00", end_time="2026-05-01T10:00:00",
            calendar_id=cal_id, last_modified="2026-05-01T00:00:00",
        )
        db.add(old); db.add(new); db.commit()

    r = client.post("/sync/exchange", json={"since": "2026-03-01T00:00:00"})
    assert r.status_code == 200
    data = r.json()
    titles = [e["title"] for e in data["events"]]
    assert "New" in titles
    assert "Old" not in titles
