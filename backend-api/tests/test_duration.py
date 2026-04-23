"""
Unit tests for Event Duration Analytics.

Tests PATCH /events/{id}/clock and GET /stats/duration.

Setup strategy: patch database.database engine + stub heavy C-extension imports
(faster_whisper, ollama, pypdf) *before* importing main so the module-level
WhisperModel() call and bare `import` statements don't fail in a test environment.
"""
import sys
from unittest.mock import MagicMock

# ── 1. Redirect DB to an in-memory SQLite before anything app-related imports ──
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

# ── 2. Stub heavy/optional imports that main.py pulls in at module level ──
for _mod in ("faster_whisper", "ollama", "pypdf", "pypdf.PdfReader"):
    sys.modules.setdefault(_mod, MagicMock())

# Make `from faster_whisper import WhisperModel` resolve to a callable mock
sys.modules["faster_whisper"].WhisperModel = MagicMock(return_value=MagicMock())
# Make `from pypdf import PdfReader` resolve to a callable mock
sys.modules["pypdf"].PdfReader = MagicMock()

# ── 3. Now it's safe to import the app ──
import pytest
from fastapi.testclient import TestClient

from database import models
from main import app, get_db

# ── 4. Override the DB dependency so every request uses our test session ──
def _override_get_db():
    with Session(_TEST_ENGINE) as session:
        yield session

app.dependency_overrides[get_db] = _override_get_db
client = TestClient(app, raise_server_exceptions=True)


# ── 5. Fixtures ──

@pytest.fixture(autouse=True)
def fresh_db():
    """Recreate all tables before each test, drop after."""
    SQLModel.metadata.create_all(_TEST_ENGINE)
    yield
    SQLModel.metadata.drop_all(_TEST_ENGINE)


def _seed(session: Session, *, start="2024-04-25T09:00:00", end="2024-04-25T10:30:00"):
    """Create a calendar + event and return the Event."""
    cal = models.Calendar(name="Test Cal", color="#ffffff")
    session.add(cal)
    session.commit()
    session.refresh(cal)
    ev = models.Event(
        title="Test Event",
        start_time=start,
        end_time=end,
        calendar_id=cal.id,
    )
    session.add(ev)
    session.commit()
    session.refresh(ev)
    return ev


# ── 6. PATCH /events/{id}/clock ──

class TestClockRoute:
    def test_clock_in_sets_actual_start(self):
        with Session(_TEST_ENGINE) as s:
            ev = _seed(s)
            event_id = ev.id

        res = client.patch(f"/events/{event_id}/clock", json={"action": "in"})
        assert res.status_code == 200
        data = res.json()
        assert data["actual_start"] is not None
        assert data["actual_end"] is None

    def test_clock_out_sets_actual_end(self):
        with Session(_TEST_ENGINE) as s:
            ev = _seed(s)
            event_id = ev.id

        client.patch(f"/events/{event_id}/clock", json={"action": "in"})
        res = client.patch(f"/events/{event_id}/clock", json={"action": "out"})
        assert res.status_code == 200
        data = res.json()
        assert data["actual_start"] is not None
        assert data["actual_end"] is not None

    def test_invalid_action_returns_400(self):
        with Session(_TEST_ENGINE) as s:
            ev = _seed(s)
            event_id = ev.id

        res = client.patch(f"/events/{event_id}/clock", json={"action": "pause"})
        assert res.status_code == 400

    def test_missing_event_returns_404(self):
        res = client.patch("/events/9999/clock", json={"action": "in"})
        assert res.status_code == 404

    def test_clock_in_timestamp_is_recent_iso(self):
        from datetime import datetime, timezone

        with Session(_TEST_ENGINE) as s:
            ev = _seed(s)
            event_id = ev.id

        res = client.patch(f"/events/{event_id}/clock", json={"action": "in"})
        assert res.status_code == 200
        ts = res.json()["actual_start"]
        # Should parse as a valid datetime
        parsed = datetime.fromisoformat(ts)
        now = datetime.now()
        assert abs((now - parsed).total_seconds()) < 5


# ── 7. GET /stats/duration ──

class TestDurationStats:
    def test_empty_returns_no_entries(self):
        res = client.get("/stats/duration")
        assert res.status_code == 200
        assert res.json() == {"entries": []}

    def test_uncompleted_event_excluded(self):
        """Clock-in only (no clock-out) must NOT appear in stats."""
        with Session(_TEST_ENGINE) as s:
            ev = _seed(s)
            event_id = ev.id

        client.patch(f"/events/{event_id}/clock", json={"action": "in"})
        res = client.get("/stats/duration")
        assert res.json()["entries"] == []

    def test_single_completed_event_appears(self):
        with Session(_TEST_ENGINE) as s:
            # planned 90 min (09:00–10:30)
            ev = _seed(s, start="2024-04-25T09:00:00", end="2024-04-25T10:30:00")
            event_id = ev.id
            # Inject known actual times directly so we control delta
            ev.actual_start = "2024-04-25T09:05:00"
            ev.actual_end   = "2024-04-25T10:50:00"  # 105 min actual
            s.add(ev)
            s.commit()

        res = client.get("/stats/duration")
        assert res.status_code == 200
        entries = res.json()["entries"]
        assert len(entries) == 1
        e = entries[0]
        assert e["planned_minutes"] == 90
        assert e["actual_minutes"] == 105
        assert e["delta_minutes"] == 15

    def test_delta_negative_when_under(self):
        with Session(_TEST_ENGINE) as s:
            # planned 60 min
            ev = _seed(s, start="2024-04-25T09:00:00", end="2024-04-25T10:00:00")
            ev.actual_start = "2024-04-25T09:00:00"
            ev.actual_end   = "2024-04-25T09:45:00"  # 45 min actual → delta −15
            s.add(ev)
            s.commit()

        entries = client.get("/stats/duration").json()["entries"]
        assert entries[0]["delta_minutes"] == -15

    def test_delta_zero_when_exact(self):
        with Session(_TEST_ENGINE) as s:
            ev = _seed(s, start="2024-04-25T09:00:00", end="2024-04-25T10:00:00")
            ev.actual_start = "2024-04-25T09:00:00"
            ev.actual_end   = "2024-04-25T10:00:00"
            s.add(ev)
            s.commit()

        entries = client.get("/stats/duration").json()["entries"]
        assert entries[0]["delta_minutes"] == 0

    def test_multiple_events_all_returned(self):
        with Session(_TEST_ENGINE) as s:
            cal = models.Calendar(name="Cal", color="#fff")
            s.add(cal); s.commit(); s.refresh(cal)

            for i, (st, en, ast, aen) in enumerate([
                ("2024-04-25T09:00:00", "2024-04-25T10:00:00",
                 "2024-04-25T09:00:00", "2024-04-25T10:10:00"),
                ("2024-04-25T11:00:00", "2024-04-25T12:00:00",
                 "2024-04-25T11:00:00", "2024-04-25T11:50:00"),
            ]):
                ev = models.Event(
                    title=f"Event {i}", start_time=st, end_time=en, calendar_id=cal.id,
                    actual_start=ast, actual_end=aen,
                )
                s.add(ev)
            s.commit()

        entries = client.get("/stats/duration").json()["entries"]
        assert len(entries) == 2

    def test_entry_fields_present(self):
        with Session(_TEST_ENGINE) as s:
            ev = _seed(s)
            ev.actual_start = "2024-04-25T09:00:00"
            ev.actual_end   = "2024-04-25T10:00:00"
            s.add(ev); s.commit()

        entry = client.get("/stats/duration").json()["entries"][0]
        for key in ("id", "title", "calendar_id", "planned_minutes", "actual_minutes", "delta_minutes"):
            assert key in entry, f"Missing key: {key}"


# ── 8. Pure math test (no DB, no HTTP) ──

def test_delta_math():
    """Mirrors the arithmetic in GET /stats/duration."""
    from datetime import datetime
    planned = (datetime.fromisoformat("2024-04-25T10:30:00") -
               datetime.fromisoformat("2024-04-25T09:00:00")).seconds / 60
    actual  = (datetime.fromisoformat("2024-04-25T10:50:00") -
               datetime.fromisoformat("2024-04-25T09:05:00")).seconds / 60
    assert round(planned) == 90
    assert round(actual) == 105
    assert round(actual - planned) == 15
