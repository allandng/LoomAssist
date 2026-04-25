"""
Phase 3 — Smart Conflict Resolution
Run in isolation:
    cd backend-api && pytest tests/test_conflict_resolver.py -v
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


def test_resolve_conflict_returns_up_to_3_suggestions():
    """Resolver should return ≤ 3 suggestions from LLM."""
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {
        "message": {
            "content": (
                '[{"start":"2026-05-10T09:00:00","end":"2026-05-10T10:00:00","rationale":"First available slot"},'
                '{"start":"2026-05-10T14:00:00","end":"2026-05-10T15:00:00","rationale":"After lunch"},'
                '{"start":"2026-05-11T09:00:00","end":"2026-05-11T10:00:00","rationale":"Next morning"}]'
            )
        }
    }
    r = client.post("/schedule/resolve-conflict", json={
        "event": {
            "title": "Team meeting",
            "start_time": "2026-05-01T10:00:00",
            "end_time":   "2026-05-01T11:00:00",
            "calendar_id": 1,
        },
        "conflicts": [{"id": 2, "title": "Standup"}],
        "working_hours_start": 9,
        "working_hours_end": 18,
    })
    assert r.status_code == 200
    data = r.json()
    assert "suggestions" in data
    assert len(data["suggestions"]) <= 3
    for s in data["suggestions"]:
        assert "start" in s and "end" in s and "rationale" in s


def test_resolve_conflict_respects_working_hours():
    """No suggestion should land outside working hours (9–18)."""
    import ollama as _ollama_mod
    # LLM returns bad times → fallback to free-slot candidates
    _ollama_mod.chat.return_value = {"message": {"content": "not json"}}
    cal_id = _make_calendar()
    # Seed an event to make some slots busy
    client.post("/events/", json={
        "title": "Blocker",
        "start_time": "2026-05-10T09:00:00",
        "end_time":   "2026-05-10T10:00:00",
        "calendar_id": cal_id,
    })
    r = client.post("/schedule/resolve-conflict", json={
        "event": {
            "title": "Workshop",
            "start_time": "2026-05-10T09:00:00",
            "end_time":   "2026-05-10T10:00:00",
            "calendar_id": cal_id,
        },
        "conflicts": [{"id": 999, "title": "Blocker"}],
        "working_hours_start": 9,
        "working_hours_end": 18,
    })
    assert r.status_code == 200
    for s in r.json()["suggestions"]:
        start_h = int(s["start"][11:13])
        assert 9 <= start_h < 18, f"Suggestion outside working hours: {s['start']}"


def test_resolve_conflict_malformed_llm_falls_back():
    """Malformed LLM response should fall back to raw free-slot data (no crash)."""
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {"message": {"content": "I have no idea"}}
    r = client.post("/schedule/resolve-conflict", json={
        "event": {
            "title": "Anything",
            "start_time": "2026-05-10T10:00:00",
            "end_time":   "2026-05-10T11:00:00",
            "calendar_id": 1,
        },
        "conflicts": [{"id": 5, "title": "Other"}],
    })
    assert r.status_code == 200
    assert isinstance(r.json()["suggestions"], list)
