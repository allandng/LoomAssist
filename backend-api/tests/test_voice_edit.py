"""
Phase 5 — Voice-Driven Editing
Run in isolation:
    cd backend-api && pytest tests/test_voice_edit.py -v
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

from main import app, get_db, execute_intent  # noqa: E402
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


def _make_event(cal_id: int, title: str, start: str, end: str) -> int:
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {"message": {"content": '{"minutes":15,"rationale":"ok"}'}}
    r = client.post("/events/", json={
        "title": title, "start_time": start, "end_time": end, "calendar_id": cal_id,
    })
    return r.json()["event"]["id"]


# ── /intent route with new intents ───────────────────────────────────────────

def test_intent_move_event_returns_pending_confirm():
    import ollama as _ollama_mod
    cal_id = _make_calendar()
    event_id = _make_event(cal_id, "Standup", "2026-05-10T15:00:00", "2026-05-10T15:30:00")

    _ollama_mod.chat.return_value = {
        "message": {
            "content": '{"action":"move_event","parameters":{"event_query":"standup","new_start":"2026-05-10T17:00:00"}}'
        }
    }
    r = client.post("/intent", json={"text": "move standup to 5pm"})
    assert r.status_code == 200
    result = r.json()["result"]
    assert result["action"] == "move_event"
    assert result["status"] == "pending_confirm"
    assert result["resolved_event_id"] == event_id
    assert "proposed_change" in result


def test_intent_cancel_event_returns_pending_confirm():
    import ollama as _ollama_mod
    cal_id = _make_calendar()
    _make_event(cal_id, "Lunch", "2026-05-10T12:00:00", "2026-05-10T13:00:00")

    _ollama_mod.chat.return_value = {
        "message": {"content": '{"action":"cancel_event","parameters":{"event_query":"lunch"}}'}
    }
    r = client.post("/intent", json={"text": "cancel today's lunch"})
    assert r.status_code == 200
    result = r.json()["result"]
    assert result["action"] == "cancel_event"
    assert result["status"] == "pending_confirm"
    assert result["proposed_change"].get("delete") is True


def test_intent_resize_event():
    import ollama as _ollama_mod
    cal_id = _make_calendar()
    event_id = _make_event(cal_id, "Meeting", "2026-05-10T09:00:00", "2026-05-10T10:00:00")

    _ollama_mod.chat.return_value = {
        "message": {
            "content": '{"action":"resize_event","parameters":{"event_query":"meeting","new_duration_minutes":30}}'
        }
    }
    r = client.post("/intent", json={"text": "shorten meeting to 30 minutes"})
    assert r.status_code == 200
    result = r.json()["result"]
    assert result["action"] == "resize_event"
    assert result["status"] == "pending_confirm"
    new_end = result["proposed_change"]["end_time"]
    # 09:00 + 30 min = 09:30
    assert "09:30" in new_end


def test_intent_no_matching_event_returns_not_found():
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {
        "message": {"content": '{"action":"cancel_event","parameters":{"event_query":"nonexistent xyz"}}'}
    }
    r = client.post("/intent", json={"text": "cancel nonexistent xyz"})
    assert r.status_code == 200
    result = r.json()["result"]
    assert result["status"] == "not_found"


# ── /intent/apply route ───────────────────────────────────────────────────────

def test_apply_move_event():
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {"message": {"content": '{"minutes":15,"rationale":"ok"}'}}
    cal_id = _make_calendar()
    event_id = _make_event(cal_id, "Standup", "2026-05-10T15:00:00", "2026-05-10T15:30:00")

    r = client.post("/intent/apply", json={
        "action": "move_event",
        "event_id": event_id,
        "proposed_change": {
            "start_time": "2026-05-10T17:00:00",
            "end_time":   "2026-05-10T17:30:00",
        },
    })
    assert r.status_code == 200
    assert r.json()["status"] == "updated"
    assert r.json()["event"]["start_time"] == "2026-05-10T17:00:00"


def test_apply_cancel_event():
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {"message": {"content": '{"minutes":15,"rationale":"ok"}'}}
    cal_id = _make_calendar()
    event_id = _make_event(cal_id, "Lunch", "2026-05-10T12:00:00", "2026-05-10T13:00:00")

    r = client.post("/intent/apply", json={
        "action": "cancel_event",
        "event_id": event_id,
        "proposed_change": {"delete": True},
    })
    assert r.status_code == 200
    assert r.json()["status"] == "deleted"

    # Event should be gone
    events = client.get("/events/").json()
    assert all(e["id"] != event_id for e in events)
