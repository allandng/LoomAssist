"""
Phase 1 — Adaptive Reminders
Run in isolation:
    cd backend-api && pytest tests/test_reminder.py -v
"""
import sys
from unittest.mock import MagicMock, patch
from sqlmodel import create_engine, Session, SQLModel
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

# ── Patch DB before importing main ────────────────────────────────────────────
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

# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_db():
    SQLModel.metadata.create_all(_TEST_ENGINE)
    yield
    SQLModel.metadata.drop_all(_TEST_ENGINE)


def _make_calendar():
    r = client.post("/calendars/", json={"name": "Test", "description": "", "color": "#6366f1"})
    return r.json()["id"]


# ── /ai/infer-reminder ────────────────────────────────────────────────────────

def test_infer_reminder_airport():
    """Drive-to-airport event should get ≥ 30 min reminder."""
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {
        "message": {"content": '{"minutes": 60, "rationale": "Need buffer for traffic"}'}
    }
    r = client.post("/ai/infer-reminder", json={"title": "Drive to airport", "description": None})
    assert r.status_code == 200
    data = r.json()
    assert data["minutes"] >= 30
    assert "rationale" in data


def test_infer_reminder_zoom_call():
    """Online meeting should get ≤ 10 min reminder."""
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {
        "message": {"content": '{"minutes": 5, "rationale": "Just a quick join link"}'}
    }
    r = client.post("/ai/infer-reminder", json={"title": "Zoom call with team", "description": None})
    assert r.status_code == 200
    assert r.json()["minutes"] <= 10


def test_infer_reminder_exam():
    """Exam event should get ≥ 60 min reminder."""
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {
        "message": {"content": '{"minutes": 1440, "rationale": "Day before to prepare"}'}
    }
    r = client.post("/ai/infer-reminder", json={"title": "Final exam", "description": None})
    assert r.status_code == 200
    assert r.json()["minutes"] >= 60


def test_infer_reminder_snaps_to_allowed_value():
    """LLM returns 45 min → snaps to nearest allowed (30 or 60)."""
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {
        "message": {"content": '{"minutes": 45, "rationale": "Some rationale"}'}
    }
    r = client.post("/ai/infer-reminder", json={"title": "Dentist", "description": None})
    assert r.status_code == 200
    assert r.json()["minutes"] in {0, 5, 10, 15, 30, 60, 1440}


def test_infer_reminder_malformed_llm_response():
    """Malformed LLM response should fall back to default (15)."""
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {"message": {"content": "I don't know"}}
    r = client.post("/ai/infer-reminder", json={"title": "Something", "description": None})
    assert r.status_code == 200
    assert r.json()["minutes"] == 15


# ── Auto-inference on event creation ─────────────────────────────────────────

def test_create_event_no_reminder_gets_inferred():
    """Event created without reminder_minutes should get reminder_source='inferred'."""
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {
        "message": {"content": '{"minutes": 30, "rationale": "Commute buffer"}'}
    }
    cal_id = _make_calendar()
    r = client.post("/events/", json={
        "title": "Calc midterm exam",
        "start_time": "2026-05-01T10:00:00",
        "end_time":   "2026-05-01T12:00:00",
        "calendar_id": cal_id,
    })
    assert r.status_code == 200
    event = r.json()["event"]
    assert event["reminder_source"] == "inferred"
    assert event["reminder_minutes"] == 30


def test_create_event_with_reminder_gets_user_source():
    """Event created with explicit reminder_minutes should get reminder_source='user'."""
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {"message": {"content": '{"minutes": 1440, "rationale": "exam"}'}}
    cal_id = _make_calendar()
    r = client.post("/events/", json={
        "title": "Office meeting",
        "start_time": "2026-05-02T09:00:00",
        "end_time":   "2026-05-02T10:00:00",
        "calendar_id": cal_id,
        "reminder_minutes": 15,
    })
    assert r.status_code == 200
    event = r.json()["event"]
    assert event["reminder_source"] == "user"
    assert event["reminder_minutes"] == 15


def test_existing_event_reminder_unchanged_on_update():
    """PUT with explicit reminder_minutes and reminder_source='user' should not re-infer."""
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {"message": {"content": '{"minutes": 1440, "rationale": "exam"}'}}
    cal_id = _make_calendar()
    # Create with explicit reminder
    r = client.post("/events/", json={
        "title": "Standup",
        "start_time": "2026-05-03T09:00:00",
        "end_time":   "2026-05-03T09:30:00",
        "calendar_id": cal_id,
        "reminder_minutes": 5,
    })
    event_id = r.json()["event"]["id"]

    # Update title only, keep reminder
    r2 = client.put(f"/events/{event_id}", json={
        "title": "Daily Standup",
        "start_time": "2026-05-03T09:00:00",
        "end_time":   "2026-05-03T09:30:00",
        "calendar_id": cal_id,
        "reminder_minutes": 5,
        "reminder_source": "user",
    })
    assert r2.status_code == 200
    updated = r2.json()["event"]
    assert updated["reminder_minutes"] == 5
    assert updated["reminder_source"] == "user"
    # Confirm LLM was NOT called for the update (call count stayed at 1 from create)
    # Only the create should have called the LLM; the update should not
    # (call_count includes all prior tests — verify it didn't increase from the update call)
    calls_after_create = _ollama_mod.chat.call_count
    client.put(f"/events/{event_id}", json={
        "title": "Daily Standup 2",
        "start_time": "2026-05-03T09:00:00",
        "end_time":   "2026-05-03T09:30:00",
        "calendar_id": cal_id,
        "reminder_minutes": 5,
        "reminder_source": "user",
    })
    assert _ollama_mod.chat.call_count == calls_after_create
