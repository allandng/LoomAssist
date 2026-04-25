"""
Phase 7 — Time-Blocking Autopilot
Run in isolation:
    cd backend-api && pytest tests/test_autopilot.py -v
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


def _make_calendar():
    r = client.post("/calendars/", json={"name": "Test", "description": "", "color": "#6366f1"})
    return r.json()["id"]


_task_ctr = 0

def _make_task(cal_id: int, note: str, est_min: int, deadline: str | None = None) -> int:
    global _task_ctr
    _task_ctr += 1
    r = client.post("/tasks/", json={
        "event_id": _task_ctr, "note": note, "is_complete": False,
        "status": "backlog", "priority": "med",
        "estimated_minutes": est_min,
        "deadline": deadline,
    })
    return r.json()["id"]


def _make_event(cal_id, start, end):
    import ollama as _m
    _m.chat.return_value = {"message": {"content": '{"minutes":15,"rationale":"ok"}'}}
    client.post("/events/", json={
        "title": "Blocker", "start_time": start, "end_time": end, "calendar_id": cal_id,
    })


WINDOW = {
    "window_start": "2026-05-10T00:00:00",
    "window_end":   "2026-05-17T23:59:59",
    "working_hours_start": 9,
    "working_hours_end": 18,
}


def test_autopilot_returns_proposals():
    cal_id = _make_calendar()
    _make_task(cal_id, "Write tests", 60)
    _make_task(cal_id, "Deploy release", 30)

    r = client.post("/schedule/autopilot", json=WINDOW)
    assert r.status_code == 200
    data = r.json()
    assert len(data["proposals"]) == 2


def test_autopilot_proposals_do_not_overlap_existing_events():
    cal_id = _make_calendar()
    # Block 09:00–12:00 on May 10
    _make_event(cal_id, "2026-05-10T09:00:00", "2026-05-10T12:00:00")
    _make_task(cal_id, "Morning task", 60)

    r = client.post("/schedule/autopilot", json=WINDOW)
    proposals = r.json()["proposals"]
    assert len(proposals) >= 1
    for p in proposals:
        start_h = int(p["start"][11:13])
        # Should not start during the 09-12 block
        assert not (9 <= start_h < 12), f"Proposal inside blocked window: {p['start']}"


def test_autopilot_respects_working_hours():
    cal_id = _make_calendar()
    _make_task(cal_id, "Night owl task", 45)

    r = client.post("/schedule/autopilot", json=WINDOW)
    for p in r.json()["proposals"]:
        start_h = int(p["start"][11:13])
        end_h   = int(p["end"][11:13])
        assert 9 <= start_h < 18, f"Proposal outside working hours: {p['start']}"
        assert end_h <= 18, f"Proposal end outside working hours: {p['end']}"


def test_autopilot_proposals_do_not_overlap_each_other():
    cal_id = _make_calendar()
    _make_task(cal_id, "Task A", 120)
    _make_task(cal_id, "Task B", 120)
    _make_task(cal_id, "Task C", 120)

    r = client.post("/schedule/autopilot", json=WINDOW)
    proposals = r.json()["proposals"]

    from datetime import datetime
    for i, p1 in enumerate(proposals):
        for p2 in proposals[i+1:]:
            s1, e1 = datetime.fromisoformat(p1["start"]), datetime.fromisoformat(p1["end"])
            s2, e2 = datetime.fromisoformat(p2["start"]), datetime.fromisoformat(p2["end"])
            assert e1 <= s2 or e2 <= s1, f"Proposals overlap: {p1} and {p2}"


def test_autopilot_skips_completed_tasks():
    cal_id = _make_calendar()
    task_id = _make_task(cal_id, "Already done", 60)
    # Mark complete
    client.put(f"/tasks/{task_id}", json={"is_complete": True, "status": "done", "estimated_minutes": 60})

    r = client.post("/schedule/autopilot", json=WINDOW)
    assert len(r.json()["proposals"]) == 0


def test_autopilot_overflow_for_no_remaining_slots():
    cal_id = _make_calendar()
    # Fill all days in the window (May 10–17 inclusive) with full-day blockers
    for day in range(10, 18):
        _make_event(cal_id, f"2026-05-{day:02d}T09:00:00", f"2026-05-{day:02d}T18:00:00")
    _make_task(cal_id, "Impossible task", 60)

    r = client.post("/schedule/autopilot", json=WINDOW)
    data = r.json()
    assert len(data["proposals"]) == 0
    assert len(data["overflow"]) == 1
