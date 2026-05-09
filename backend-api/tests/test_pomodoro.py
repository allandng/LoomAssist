"""
Tests for Pomodoro session persistence and the Energy Map aggregation route.

Setup mirrors tests/test_duration.py: patch DB engine and stub heavy module
imports before main is imported.
"""
import sys
from datetime import datetime, timedelta
from unittest.mock import MagicMock

from sqlmodel import create_engine, SQLModel, Session
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

import database.database as _db

_TEST_ENGINE = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_db.engine = _TEST_ENGINE
_db.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_TEST_ENGINE)

for _mod in ("faster_whisper", "ollama", "pypdf", "sentence_transformers", "zeroconf", "caldav"):
    sys.modules.setdefault(_mod, MagicMock())
sys.modules["faster_whisper"].WhisperModel = MagicMock(return_value=MagicMock())
sys.modules["pypdf"].PdfReader = MagicMock()

import pytest
from fastapi.testclient import TestClient

from database import models
from main import app, get_db


def _override_get_db():
    with Session(_TEST_ENGINE) as session:
        yield session


app.dependency_overrides[get_db] = _override_get_db
client = TestClient(app, raise_server_exceptions=True)


@pytest.fixture(autouse=True)
def fresh_db():
    SQLModel.metadata.create_all(_TEST_ENGINE)
    yield
    SQLModel.metadata.drop_all(_TEST_ENGINE)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


class TestCreatePomodoro:
    def test_create_minimal_payload(self):
        res = client.post("/pomodoro-sessions", json={
            "completed_at": _iso(datetime.now()),
            "duration_minutes": 25,
            "mode": "work",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["mode"] == "work"
        assert body["duration_minutes"] == 25
        assert body["id"] > 0

    def test_create_with_task_metadata(self):
        res = client.post("/pomodoro-sessions", json={
            "completed_at": _iso(datetime.now()),
            "duration_minutes": 50,
            "mode": "work",
            "task_id": 7,
            "task_note": "Finish migration",
            "round_num": 3,
        })
        assert res.status_code == 200
        body = res.json()
        assert body["task_id"] == 7
        assert body["task_note"] == "Finish migration"
        assert body["round_num"] == 3

    def test_persisted_row_visible_in_db(self):
        client.post("/pomodoro-sessions", json={
            "completed_at": _iso(datetime.now()),
            "duration_minutes": 25,
            "mode": "work",
        })
        with Session(_TEST_ENGINE) as s:
            rows = s.query(models.PomodoroSession).all()
            assert len(rows) == 1


class TestEnergyMap:
    def test_empty_returns_zero_grid(self):
        res = client.get("/pomodoro-sessions/energy-map")
        assert res.status_code == 200
        body = res.json()
        assert len(body["grid"]) == 7
        assert all(len(row) == 24 for row in body["grid"])
        assert body["total"] == 0
        # No events, no pomodoros — source falls back to its default "pomodoro".
        assert body["source"] == "pomodoro"

    def test_proxy_uses_events_when_few_pomodoros(self):
        # Seed an event one week ago at 14:00 on a Wednesday-ish slot.
        with Session(_TEST_ENGINE) as s:
            cal = models.Calendar(name="Test")
            s.add(cal); s.commit(); s.refresh(cal)
            past = datetime.now() - timedelta(days=3)
            past = past.replace(hour=14, minute=0, second=0, microsecond=0)
            ev = models.Event(
                title="Study",
                start_time=_iso(past),
                end_time=_iso(past + timedelta(hours=1)),
                calendar_id=cal.id,
            )
            s.add(ev); s.commit()

        res = client.get("/pomodoro-sessions/energy-map")
        body = res.json()
        assert body["source"] == "events_proxy"
        # The seeded event should land in the (weekday, 14) bucket.
        dow = past.weekday()
        assert body["grid"][dow][14] >= 1

    def test_real_pomodoros_drive_pomodoro_source(self):
        now = datetime.now()
        for i in range(6):
            client.post("/pomodoro-sessions", json={
                "completed_at": _iso(now - timedelta(hours=i)),
                "duration_minutes": 25,
                "mode": "work",
            })
        res = client.get("/pomodoro-sessions/energy-map")
        body = res.json()
        assert body["total"] == 6
        assert body["source"] == "pomodoro"
        flat = [v for row in body["grid"] for v in row]
        assert sum(flat) == 6

    def test_break_modes_excluded_from_grid(self):
        now = datetime.now()
        client.post("/pomodoro-sessions", json={
            "completed_at": _iso(now),
            "duration_minutes": 5,
            "mode": "short-break",
        })
        client.post("/pomodoro-sessions", json={
            "completed_at": _iso(now),
            "duration_minutes": 15,
            "mode": "long-break",
        })
        res = client.get("/pomodoro-sessions/energy-map")
        body = res.json()
        # No work pomodoros — total=0; grid should still be all-zero (no events seeded either).
        assert body["total"] == 0
        flat = [v for row in body["grid"] for v in row]
        assert sum(flat) == 0

    def test_proxy_disabled_keeps_grid_empty(self):
        with Session(_TEST_ENGINE) as s:
            cal = models.Calendar(name="Test")
            s.add(cal); s.commit(); s.refresh(cal)
            ev = models.Event(
                title="Class",
                start_time=_iso(datetime.now() - timedelta(days=1)),
                end_time=_iso(datetime.now()),
                calendar_id=cal.id,
            )
            s.add(ev); s.commit()

        res = client.get("/pomodoro-sessions/energy-map?proxy=false")
        body = res.json()
        assert body["source"] == "pomodoro"
        flat = [v for row in body["grid"] for v in row]
        assert sum(flat) == 0

    def test_actual_start_preferred_over_start_time(self):
        # When clock-in data exists, proxy should bin actual_start, not start_time.
        with Session(_TEST_ENGINE) as s:
            cal = models.Calendar(name="Test")
            s.add(cal); s.commit(); s.refresh(cal)
            yesterday = datetime.now() - timedelta(days=1)
            planned = yesterday.replace(hour=9, minute=0, second=0, microsecond=0)
            actual  = yesterday.replace(hour=15, minute=0, second=0, microsecond=0)
            ev = models.Event(
                title="Drift",
                start_time=_iso(planned),
                end_time=_iso(planned + timedelta(hours=1)),
                actual_start=_iso(actual),
                calendar_id=cal.id,
            )
            s.add(ev); s.commit()

        res = client.get("/pomodoro-sessions/energy-map")
        body = res.json()
        dow = yesterday.weekday()
        # 15:00 (actual_start) bucket should be hit; 09:00 (planned start_time) should not.
        assert body["grid"][dow][15] >= 1
        assert body["grid"][dow][9] == 0

    def test_old_pomodoros_excluded_by_window(self):
        # Outside the 12-week window — should not appear.
        old = datetime.now() - timedelta(weeks=20)
        client.post("/pomodoro-sessions", json={
            "completed_at": _iso(old),
            "duration_minutes": 25,
            "mode": "work",
        })
        res = client.get("/pomodoro-sessions/energy-map?weeks=12")
        body = res.json()
        assert body["total"] == 0
