"""
Integration tests for Class-Prep Auto-Blocking (event_type + prep_minutes).

Verifies:
- Round-trip of event_type and prep_minutes via POST/PUT/GET.
- Free-slot search expands the busy window for lecture prep.
- Lecture-gate: prep_minutes on a non-lecture event is stored but ignored by busy-window logic.
- Conflict check returns conflict_type="prep" for the prep window.
- normalize_to_google does NOT leak event_type/prep_minutes (local-only contract).
- Creating a lecture with prep_minutes does not perturb reminder_source inference.
"""
import sys
from unittest.mock import MagicMock
from sqlmodel import create_engine, SQLModel, Session
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker
import pytest

import database.database as _db
_TEST_ENGINE = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_db.engine = _TEST_ENGINE
_db.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_TEST_ENGINE)

sys.modules.setdefault("faster_whisper", MagicMock())
sys.modules["faster_whisper"].WhisperModel = MagicMock(return_value=MagicMock())
sys.modules.setdefault("ollama", MagicMock())
sys.modules.setdefault("pypdf", MagicMock())
sys.modules["pypdf"].PdfReader = MagicMock()

from main import app, get_db
from fastapi.testclient import TestClient

app.dependency_overrides[get_db] = lambda: (yield Session(_TEST_ENGINE))
client = TestClient(app)

BASE_EVENT = {
    "title": "Test Event",
    "start_time": "2024-04-25T11:00:00",
    "end_time": "2024-04-25T12:00:00",
    "is_all_day": False,
    "is_recurring": False,
    "recurrence_days": "",
    "recurrence_end": "",
    "description": "",
    "unique_description": "",
    "reminder_minutes": 0,
    "external_uid": "",
    "timezone": "local",
    "skipped_dates": "",
    "per_day_times": "",
    "checklist": "",
}


@pytest.fixture(autouse=True)
def reset_db():
    SQLModel.metadata.create_all(_TEST_ENGINE)
    yield
    SQLModel.metadata.drop_all(_TEST_ENGINE)


@pytest.fixture()
def calendar_id():
    r = client.post("/calendars/", json={"name": "Test", "description": "", "color": "#6366f1"})
    return r.json()["id"]


class TestRoundTrip:
    def test_lecture_with_prep_persists(self, calendar_id):
        payload = {**BASE_EVENT, "calendar_id": calendar_id,
                   "event_type": "lecture", "prep_minutes": 25}
        r = client.post("/events/", json=payload)
        assert r.status_code == 200
        ev = r.json()["event"]
        assert ev["event_type"] == "lecture"
        assert ev["prep_minutes"] == 25

    def test_non_lecture_with_prep_is_stored_verbatim(self, calendar_id):
        # Backend stores the value; FE gates the UI. Data is harmless because
        # busy-window/conflict logic gate on event_type=='lecture'.
        payload = {**BASE_EVENT, "calendar_id": calendar_id,
                   "event_type": "lab", "prep_minutes": 30}
        r = client.post("/events/", json=payload)
        assert r.status_code == 200
        ev = r.json()["event"]
        assert ev["event_type"] == "lab"
        assert ev["prep_minutes"] == 30

    def test_update_clears_prep_when_type_changes(self, calendar_id):
        ev_id = client.post("/events/", json={**BASE_EVENT, "calendar_id": calendar_id,
                                              "event_type": "lecture", "prep_minutes": 25}
                            ).json()["event"]["id"]
        # Frontend sends prep_minutes=None when leaving lecture; verify backend accepts.
        r = client.put(f"/events/{ev_id}", json={**BASE_EVENT, "calendar_id": calendar_id,
                                                  "event_type": "lab", "prep_minutes": None})
        assert r.status_code == 200
        ev = r.json()["event"]
        assert ev["event_type"] == "lab"
        assert ev.get("prep_minutes") is None


class TestPrepBlocksFreeSlots:
    def test_lecture_prep_blocks_pre_event_window(self, calendar_id):
        # Lecture 11:00-12:00 with prep=30, travel=15 → busy from 10:15 to 12:00
        client.post("/events/", json={
            **BASE_EVENT, "calendar_id": calendar_id,
            "start_time": "2024-04-25T11:00:00",
            "end_time":   "2024-04-25T12:00:00",
            "event_type": "lecture",
            "prep_minutes": 30,
            "travel_time_minutes": 15,
        })

        from datetime import datetime
        r = client.post("/schedule/find-free", json={
            "window_start": "2024-04-25T09:00:00",
            "window_end":   "2024-04-25T18:00:00",
            "duration_minutes": 30,
            "working_hours_start": 9,
            "working_hours_end": 18,
        })
        assert r.status_code == 200
        slots = r.json()["slots"]
        for slot in slots:
            s = datetime.fromisoformat(slot["start"])
            e = datetime.fromisoformat(slot["end"])
            # No slot may overlap [10:15, 12:00)
            assert not (s < datetime(2024, 4, 25, 12, 0) and e > datetime(2024, 4, 25, 10, 15)), \
                f"Slot {slot} overlaps prep+travel buffer"

    def test_non_lecture_prep_does_not_block(self, calendar_id):
        # event_type=lab with prep_minutes=30 and travel=15: only travel buffer applies → busy [10:45, 12:00)
        client.post("/events/", json={
            **BASE_EVENT, "calendar_id": calendar_id,
            "start_time": "2024-04-25T11:00:00",
            "end_time":   "2024-04-25T12:00:00",
            "event_type": "lab",
            "prep_minutes": 30,
            "travel_time_minutes": 15,
        })

        from datetime import datetime
        r = client.post("/schedule/find-free", json={
            "window_start": "2024-04-25T09:00:00",
            "window_end":   "2024-04-25T18:00:00",
            "duration_minutes": 30,
            "working_hours_start": 9,
            "working_hours_end": 18,
        })
        assert r.status_code == 200
        slots = r.json()["slots"]
        starts = [datetime.fromisoformat(s["start"]) for s in slots]
        # Slot 10:00-10:30 is free for a lab (busy starts at 10:45 with only travel applied).
        # For a lecture with prep=30, that same slot would be busy (busy starts at 10:15).
        assert datetime(2024, 4, 25, 10, 0) in starts

    def test_zero_prep_no_extra_blocking(self, calendar_id):
        client.post("/events/", json={
            **BASE_EVENT, "calendar_id": calendar_id,
            "start_time": "2024-04-25T11:00:00",
            "end_time":   "2024-04-25T12:00:00",
            "event_type": "lecture",
            "prep_minutes": 0,
        })
        from datetime import datetime
        r = client.post("/schedule/find-free", json={
            "window_start": "2024-04-25T09:00:00",
            "window_end":   "2024-04-25T18:00:00",
            "duration_minutes": 60,
            "working_hours_start": 9,
            "working_hours_end": 18,
        })
        slots = r.json()["slots"]
        # Slot at 10:00 should be present — nothing blocks the pre-event hour.
        starts = [datetime.fromisoformat(s["start"]).hour for s in slots]
        assert 10 in starts

    def test_combined_prep_and_travel(self, calendar_id):
        # prep=20, travel=10 → busy [10:30, 12:00). Slot at 10:00 overlaps; 09:30 free.
        client.post("/events/", json={
            **BASE_EVENT, "calendar_id": calendar_id,
            "start_time": "2024-04-25T11:00:00",
            "end_time":   "2024-04-25T12:00:00",
            "event_type": "lecture",
            "prep_minutes": 20,
            "travel_time_minutes": 10,
        })
        from datetime import datetime
        r = client.post("/schedule/find-free", json={
            "window_start": "2024-04-25T09:00:00",
            "window_end":   "2024-04-25T18:00:00",
            "duration_minutes": 30,
            "working_hours_start": 9,
            "working_hours_end": 18,
        })
        slots = r.json()["slots"]
        starts = [datetime.fromisoformat(s["start"]) for s in slots]
        # 10:00-10:30 overlaps [10:30, 12:00)? 10:00 < 12:00 and 10:30 > 10:30 is false (boundary).
        # The check is `b_s < slot_end and b_e > cursor`: 10:30 < 10:30 false → 10:00-10:30 is FREE.
        # We assert the deeper interior 10:15-10:45 is busy.
        for s in starts:
            slot_end_h = s.hour + (s.minute + 30) // 60
            slot_end_m = (s.minute + 30) % 60
            assert not (s < datetime(2024, 4, 25, 12, 0)
                        and datetime(2024, 4, 25, slot_end_h, slot_end_m) > datetime(2024, 4, 25, 10, 30)), \
                f"Slot starting {s} overlaps prep+travel buffer"


class TestConflictCheckReturnsPrep:
    def test_conflict_check_returns_prep_type(self, calendar_id):
        client.post("/events/", json={
            **BASE_EVENT, "calendar_id": calendar_id,
            "start_time": "2024-04-25T11:00:00",
            "end_time":   "2024-04-25T12:00:00",
            "event_type": "lecture",
            "prep_minutes": 30,
        })
        # Window [10:35, 10:55] sits inside the prep buffer [10:30, 11:00) for an 11:00 lecture.
        r = client.post("/events/check-conflicts", json={
            "start_time": "2024-04-25T10:35:00",
            "end_time":   "2024-04-25T10:55:00",
            "calendar_id": calendar_id,
        })
        assert r.status_code == 200
        types = [c["conflict_type"] for c in r.json()["conflicts"]]
        assert "prep" in types

    def test_conflict_check_no_prep_for_non_lecture(self, calendar_id):
        client.post("/events/", json={
            **BASE_EVENT, "calendar_id": calendar_id,
            "start_time": "2024-04-25T11:00:00",
            "end_time":   "2024-04-25T12:00:00",
            "event_type": "lab",
            "prep_minutes": 30,
        })
        r = client.post("/events/check-conflicts", json={
            "start_time": "2024-04-25T10:35:00",
            "end_time":   "2024-04-25T10:55:00",
            "calendar_id": calendar_id,
        })
        types = [c["conflict_type"] for c in r.json()["conflicts"]]
        assert "prep" not in types


class TestSyncLocalOnly:
    def test_normalize_to_google_omits_prep_and_type(self):
        from services.sync.google import normalize_to_google
        out = normalize_to_google({
            "title": "Algorithms",
            "start_time": "2024-04-25T11:00:00",
            "end_time":   "2024-04-25T12:00:00",
            "is_all_day": False,
            "description": "",
            "location": "Room 101",
            "event_type": "lecture",
            "prep_minutes": 25,
        })
        assert "event_type" not in out
        assert "prep_minutes" not in out


class TestReminderSourceUnaffectedByPrep:
    def test_create_lecture_with_prep_does_not_break_reminder_source(self, calendar_id):
        # No reminder_minutes provided — backend will attempt inference (which returns 0
        # via the mocked ollama). The point is reminder_source must still be set to
        # 'inferred' or 'none' (never 'user' just because we set prep).
        payload = {**BASE_EVENT, "calendar_id": calendar_id,
                   "event_type": "lecture", "prep_minutes": 25}
        # Pop reminder_minutes from BASE_EVENT to trigger inference path.
        payload.pop("reminder_minutes", None)
        r = client.post("/events/", json=payload)
        assert r.status_code == 200
        ev = r.json()["event"]
        assert ev["reminder_source"] in ("inferred", "none")
