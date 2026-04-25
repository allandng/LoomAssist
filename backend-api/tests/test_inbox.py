"""
Phase 4 — Quick-Capture Inbox
Run in isolation:
    cd backend-api && pytest tests/test_inbox.py -v
"""
import sys
from unittest.mock import MagicMock
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


def _make_calendar():
    r = client.post("/calendars/", json={"name": "Test", "description": "", "color": "#6366f1"})
    return r.json()["id"]


# ── CRUD ──────────────────────────────────────────────────────────────────────

def test_create_inbox_item():
    r = client.post("/inbox", json={"text": "buy groceries on the way home"})
    assert r.status_code == 200
    data = r.json()
    assert data["text"] == "buy groceries on the way home"
    assert data["archived"] is False
    assert data["proposed_start"] is None


def test_list_inbox_excludes_archived():
    client.post("/inbox", json={"text": "item 1"})
    r2 = client.post("/inbox", json={"text": "item 2"})
    item2_id = r2.json()["id"]
    client.delete(f"/inbox/{item2_id}")  # archive item 2

    items = client.get("/inbox").json()
    assert len(items) == 1
    assert items[0]["text"] == "item 1"


def test_delete_inbox_item_archives():
    r = client.post("/inbox", json={"text": "soft delete me"})
    item_id = r.json()["id"]
    del_r = client.delete(f"/inbox/{item_id}")
    assert del_r.status_code == 200
    assert del_r.json()["archived"] is True
    # Should not appear in list
    items = client.get("/inbox").json()
    assert all(i["id"] != item_id for i in items)


# ── Propose ───────────────────────────────────────────────────────────────────

def test_propose_inbox_item_returns_slot():
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {
        "message": {"content": '{"proposed_start":"2026-05-10T09:00:00","proposed_duration":60,"rationale":"Morning slot"}'}
    }
    r = client.post("/inbox", json={"text": "review pull requests"})
    item_id = r.json()["id"]

    prop = client.post(f"/inbox/{item_id}/propose")
    assert prop.status_code == 200
    data = prop.json()
    assert data["proposed_start"] is not None
    assert data["proposed_duration"] == 60
    assert "rationale" in data


def test_propose_nonexistent_item_returns_404():
    r = client.post("/inbox/9999/propose")
    assert r.status_code == 404


# ── Schedule (full flow) ──────────────────────────────────────────────────────

def test_schedule_inbox_item_creates_event_and_archives():
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {"message": {"content": '{"minutes": 15, "rationale": "quick task"}'}}
    cal_id = _make_calendar()
    r = client.post("/inbox", json={"text": "write tests"})
    item_id = r.json()["id"]

    sched = client.post(f"/inbox/{item_id}/schedule", json={
        "start": "2026-05-10T10:00:00",
        "end":   "2026-05-10T11:00:00",
        "calendar_id": cal_id,
    })
    assert sched.status_code == 200
    data = sched.json()
    assert data["archived"] is True
    assert data["scheduled_event_id"] is not None

    # The created event should exist
    events = client.get("/events/").json()
    assert any(e["id"] == data["scheduled_event_id"] for e in events)
