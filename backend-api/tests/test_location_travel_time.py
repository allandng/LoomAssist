"""
Integration tests for the location and travel_time_minutes fields on Event.

Verifies:
- POST /events/ accepts and round-trips location and travel_time_minutes
- PUT /events/{id} can update both fields
- GET /events/ returns the fields
- Null/absent fields are handled gracefully
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
    "start_time": "2024-04-25T09:00:00",
    "end_time": "2024-04-25T10:00:00",
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


class TestLocationFieldRoundTrip:
    def test_create_event_with_location(self, calendar_id):
        payload = {**BASE_EVENT, "calendar_id": calendar_id, "location": "Coffee Shop, Main St"}
        r = client.post("/events/", json=payload)
        assert r.status_code == 200
        ev = r.json()["event"]
        assert ev["location"] == "Coffee Shop, Main St"

    def test_create_event_without_location_returns_null(self, calendar_id):
        payload = {**BASE_EVENT, "calendar_id": calendar_id}
        r = client.post("/events/", json=payload)
        assert r.status_code == 200
        ev = r.json()["event"]
        assert ev.get("location") is None

    def test_list_events_includes_location(self, calendar_id):
        payload = {**BASE_EVENT, "calendar_id": calendar_id, "location": "Library"}
        client.post("/events/", json=payload)
        evs = client.get("/events/").json()
        assert any(e.get("location") == "Library" for e in evs)

    def test_update_location(self, calendar_id):
        payload = {**BASE_EVENT, "calendar_id": calendar_id, "location": "Home"}
        ev_id = client.post("/events/", json=payload).json()["event"]["id"]
        r = client.put(f"/events/{ev_id}", json={**BASE_EVENT, "calendar_id": calendar_id,
                                                   "location": "Office"})
        assert r.status_code == 200
        assert r.json()["event"]["location"] == "Office"

    def test_update_location_to_null(self, calendar_id):
        payload = {**BASE_EVENT, "calendar_id": calendar_id, "location": "Home"}
        ev_id = client.post("/events/", json=payload).json()["event"]["id"]
        r = client.put(f"/events/{ev_id}", json={**BASE_EVENT, "calendar_id": calendar_id,
                                                   "location": None})
        assert r.status_code == 200
        assert r.json()["event"].get("location") is None


class TestTravelTimeFieldRoundTrip:
    def test_create_event_with_travel_time(self, calendar_id):
        payload = {**BASE_EVENT, "calendar_id": calendar_id, "travel_time_minutes": 30}
        r = client.post("/events/", json=payload)
        assert r.status_code == 200
        ev = r.json()["event"]
        assert ev["travel_time_minutes"] == 30

    def test_create_event_without_travel_time_returns_null(self, calendar_id):
        payload = {**BASE_EVENT, "calendar_id": calendar_id}
        r = client.post("/events/", json=payload)
        assert r.status_code == 200
        ev = r.json()["event"]
        assert ev.get("travel_time_minutes") is None

    def test_update_travel_time(self, calendar_id):
        payload = {**BASE_EVENT, "calendar_id": calendar_id, "travel_time_minutes": 15}
        ev_id = client.post("/events/", json=payload).json()["event"]["id"]
        r = client.put(f"/events/{ev_id}", json={**BASE_EVENT, "calendar_id": calendar_id,
                                                   "travel_time_minutes": 45})
        assert r.status_code == 200
        assert r.json()["event"]["travel_time_minutes"] == 45

    def test_both_fields_together(self, calendar_id):
        payload = {**BASE_EVENT, "calendar_id": calendar_id,
                   "location": "Gym", "travel_time_minutes": 20}
        r = client.post("/events/", json=payload)
        assert r.status_code == 200
        ev = r.json()["event"]
        assert ev["location"] == "Gym"
        assert ev["travel_time_minutes"] == 20


class TestTravelTimeAffectsFreeSlotsAPI:
    def test_travel_time_blocks_pre_event_window(self, calendar_id):
        # Event 11:00-12:00 with 60min travel → busy from 10:00 to 12:00
        client.post("/events/", json={
            **BASE_EVENT, "calendar_id": calendar_id,
            "start_time": "2024-04-25T11:00:00",
            "end_time": "2024-04-25T12:00:00",
            "travel_time_minutes": 60,
        })

        from datetime import datetime, timedelta
        window_start = datetime(2024, 4, 25, 9, 0, 0)
        window_end   = datetime(2024, 4, 25, 18, 0, 0)
        r = client.post("/schedule/find-free", json={
            "window_start": window_start.isoformat(),
            "window_end":   window_end.isoformat(),
            "duration_minutes": 60,
            "working_hours_start": 9,
            "working_hours_end": 18,
        })
        assert r.status_code == 200
        slots = r.json()["slots"]
        for slot in slots:
            s = datetime.fromisoformat(slot["start"])
            e = datetime.fromisoformat(slot["end"])
            # No slot may overlap the travel-buffered busy window [10:00, 12:00)
            assert not (s < datetime(2024, 4, 25, 12, 0) and e > datetime(2024, 4, 25, 10, 0)), \
                f"Slot {slot} overlaps travel-time buffer"

    def test_zero_travel_time_no_extra_blocking(self, calendar_id):
        # Event 11:00-12:00 with 0 travel → only blocked 11:00-12:00
        client.post("/events/", json={
            **BASE_EVENT, "calendar_id": calendar_id,
            "start_time": "2024-04-25T11:00:00",
            "end_time": "2024-04-25T12:00:00",
            "travel_time_minutes": 0,
        })

        from datetime import datetime
        r = client.post("/schedule/find-free", json={
            "window_start": "2024-04-25T09:00:00",
            "window_end":   "2024-04-25T18:00:00",
            "duration_minutes": 60,
            "working_hours_start": 9,
            "working_hours_end": 18,
        })
        assert r.status_code == 200
        slots = r.json()["slots"]
        # Slot at 10:00 should be present (only 11:00-12:00 is blocked)
        starts = [datetime.fromisoformat(s["start"]).hour for s in slots]
        assert 10 in starts
