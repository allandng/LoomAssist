"""
Phase 10 — Cross-Event Dependencies
Run in isolation:
    cd backend-api && pytest tests/test_dependencies.py -v
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


def _cal():
    r = client.post("/calendars/", json={"name": "Test", "description": "", "color": "#6366f1"})
    return r.json()["id"]


def _event(cal_id, title, start="2026-05-10T09:00:00", end="2026-05-10T10:00:00", dep_id=None, offset=None):
    import ollama as _m
    _m.chat.return_value = {"message": {"content": '{"minutes":15,"rationale":"ok"}'}}
    payload = {"title": title, "start_time": start, "end_time": end, "calendar_id": cal_id}
    if dep_id is not None:
        payload["depends_on_event_id"] = dep_id
    if offset is not None:
        payload["depends_offset_minutes"] = offset
    r = client.post("/events/", json=payload)
    return r.json()["event"]["id"]


# ── Dependency field round-trip ───────────────────────────────────────────────

def test_create_event_with_dependency():
    cal_id = _cal()
    parent_id = _event(cal_id, "Lecture 5")
    child_id  = _event(cal_id, "PSet 3 due", dep_id=parent_id, offset=7200)  # 5 days = 7200 min

    events = client.get("/events/").json()
    child = next(e for e in events if e["id"] == child_id)
    assert child["depends_on_event_id"] == parent_id
    assert child["depends_offset_minutes"] == 7200


# ── PUT returns dependents ────────────────────────────────────────────────────

def test_update_parent_returns_dependents():
    cal_id    = _cal()
    parent_id = _event(cal_id, "Lecture 5", start="2026-05-10T10:00:00", end="2026-05-10T11:00:00")
    child_id  = _event(cal_id, "PSet 3 due", dep_id=parent_id, offset=0)

    import ollama as _m
    _m.chat.return_value = {"message": {"content": '{"minutes":15,"rationale":"ok"}'}}
    r = client.put(f"/events/{parent_id}", json={
        "title": "Lecture 5 (rescheduled)",
        "start_time": "2026-05-11T10:00:00", "end_time": "2026-05-11T11:00:00",
        "calendar_id": cal_id,
    })
    assert r.status_code == 200
    data = r.json()
    assert "dependents" in data
    dep_ids = [d["id"] for d in data["dependents"]]
    assert child_id in dep_ids


# ── Cascade endpoint ──────────────────────────────────────────────────────────

def test_cascade_dependents_shifts_child():
    cal_id    = _cal()
    parent_id = _event(cal_id, "Lecture", start="2026-05-10T10:00:00", end="2026-05-10T11:00:00")
    child_id  = _event(cal_id, "Assignment due",
                        start="2026-05-11T10:00:00", end="2026-05-11T11:00:00",
                        dep_id=parent_id, offset=60)  # 60 min after parent end

    # Move parent to next day
    import ollama as _m
    _m.chat.return_value = {"message": {"content": '{"minutes":15,"rationale":"ok"}'}}
    client.put(f"/events/{parent_id}", json={
        "title": "Lecture", "start_time": "2026-05-12T10:00:00", "end_time": "2026-05-12T11:00:00",
        "calendar_id": cal_id,
    })

    # Cascade
    r = client.post(f"/events/{parent_id}/cascade-dependents")
    assert r.status_code == 200
    updated = r.json()["updated"]
    assert len(updated) == 1
    # New child start = parent end (11:00) + 60 min = 12:00
    assert updated[0]["start_time"] == "2026-05-12T12:00:00"


# ── Circular dependency guard ─────────────────────────────────────────────────

def test_circular_dependency_rejected():
    cal_id = _cal()
    a_id   = _event(cal_id, "Event A")
    b_id   = _event(cal_id, "Event B", dep_id=a_id, offset=60)

    import ollama as _m
    _m.chat.return_value = {"message": {"content": '{"minutes":15,"rationale":"ok"}'}}
    # Try to make A depend on B (A→B→A would be circular)
    r = client.put(f"/events/{a_id}", json={
        "title": "Event A", "start_time": "2026-05-10T09:00:00", "end_time": "2026-05-10T10:00:00",
        "calendar_id": cal_id, "depends_on_event_id": b_id,
    })
    assert r.status_code == 400
    assert "circular" in str(r.json()).lower()


# ── Delete parent clears child dependency ─────────────────────────────────────

def test_delete_parent_nullifies_child_dependency():
    cal_id    = _cal()
    parent_id = _event(cal_id, "Parent")
    child_id  = _event(cal_id, "Child", dep_id=parent_id, offset=0)

    client.delete(f"/events/{parent_id}")

    events = client.get("/events/").json()
    child = next(e for e in events if e["id"] == child_id)
    assert child["depends_on_event_id"] is None
    # Child still exists
    assert child["title"] == "Child"
