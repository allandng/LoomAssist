"""
Unit tests for the Weekly Review route: POST /ai/weekly-review.

Tests event date filtering, correct counts, Ollama integration (mocked),
and error handling when the LLM is unavailable.

Setup follows the same pre-import patching pattern as test_duration.py.
"""
import sys
from unittest.mock import MagicMock, patch

# ── 1. Redirect DB to in-memory SQLite before any app import ──
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

# ── 2. Stub heavy imports that main.py pulls in at module level ──
for _mod in ("faster_whisper", "ollama", "pypdf"):
    sys.modules.setdefault(_mod, MagicMock())
sys.modules["faster_whisper"].WhisperModel = MagicMock(return_value=MagicMock())
sys.modules["pypdf"].PdfReader = MagicMock()

# ── 3. Import app after patches are in place ──
import pytest
from fastapi.testclient import TestClient
from database import models
from main import app, get_db

# ── 4. Override DB dependency ──
app.dependency_overrides[get_db] = lambda: (yield Session(_TEST_ENGINE))
client = TestClient(app, raise_server_exceptions=True)

# ── 5. Fixtures ──

@pytest.fixture(autouse=True)
def fresh_db():
    SQLModel.metadata.create_all(_TEST_ENGINE)
    yield
    SQLModel.metadata.drop_all(_TEST_ENGINE)


def _make_calendar(session: Session, name: str = "Test Cal") -> models.Calendar:
    cal = models.Calendar(name=name, color="#ffffff")
    session.add(cal)
    session.commit()
    session.refresh(cal)
    return cal


def _make_event(session: Session, calendar_id: int, title: str, start: str, end: str) -> models.Event:
    ev = models.Event(title=title, start_time=start, end_time=end, calendar_id=calendar_id)
    session.add(ev)
    session.commit()
    session.refresh(ev)
    return ev


# ── 6. Tests ──

FAKE_SUMMARY = "Last week was productive with lots of study sessions. This week looks lighter — great time to review notes."


class TestWeeklyReviewRoute:

    def test_returns_summary_and_counts(self):
        """Happy path: past + upcoming events → summary + correct counts."""
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)
            # 2 events last week (2024-04-15 = Monday)
            _make_event(s, cal.id, "Lecture",    "2024-04-15T09:00:00", "2024-04-15T10:00:00")
            _make_event(s, cal.id, "Lab Session","2024-04-17T14:00:00", "2024-04-17T16:00:00")
            # 1 event this/upcoming week
            _make_event(s, cal.id, "Exam Prep",  "2024-04-22T10:00:00", "2024-04-22T12:00:00")

        with patch("ollama.chat", return_value={"message": {"content": FAKE_SUMMARY}}):
            res = client.post("/ai/weekly-review", json={"week_start": "2024-04-15T00:00:00"})

        assert res.status_code == 200
        data = res.json()
        assert data["summary"] == FAKE_SUMMARY
        assert data["past_count"] == 2
        assert data["upcoming_count"] == 1

    def test_empty_calendar_returns_zero_counts(self):
        """No events at all → counts are 0, LLM still called, summary returned."""
        with patch("ollama.chat", return_value={"message": {"content": "Quiet week!"}}):
            res = client.post("/ai/weekly-review", json={"week_start": "2024-04-15T00:00:00"})

        assert res.status_code == 200
        assert res.json()["past_count"] == 0
        assert res.json()["upcoming_count"] == 0
        assert res.json()["summary"] == "Quiet week!"

    def test_past_events_boundary_inclusive(self):
        """Events exactly at week_start are included in past_count."""
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)
            _make_event(s, cal.id, "Kickoff", "2024-04-15T00:00:00", "2024-04-15T01:00:00")

        with patch("ollama.chat", return_value={"message": {"content": FAKE_SUMMARY}}):
            res = client.post("/ai/weekly-review", json={"week_start": "2024-04-15T00:00:00"})

        assert res.json()["past_count"] == 1

    def test_past_events_boundary_exclusive(self):
        """Event at week_start + 7 days is NOT in past, it's upcoming."""
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)
            # Exactly at week_end = week_start + 7 days
            _make_event(s, cal.id, "Next Mon", "2024-04-22T00:00:00", "2024-04-22T01:00:00")

        with patch("ollama.chat", return_value={"message": {"content": FAKE_SUMMARY}}):
            res = client.post("/ai/weekly-review", json={"week_start": "2024-04-15T00:00:00"})

        data = res.json()
        assert data["past_count"] == 0
        assert data["upcoming_count"] == 1

    def test_upcoming_events_boundary_exclusive(self):
        """Events 14+ days out are NOT in upcoming_count."""
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)
            # 14 days out = outside the upcoming window (week_end to next_end)
            _make_event(s, cal.id, "Far Future", "2024-04-29T09:00:00", "2024-04-29T10:00:00")

        with patch("ollama.chat", return_value={"message": {"content": FAKE_SUMMARY}}):
            res = client.post("/ai/weekly-review", json={"week_start": "2024-04-15T00:00:00"})

        assert res.json()["upcoming_count"] == 0

    def test_events_outside_window_not_counted(self):
        """Events from two weeks ago are not included in either count."""
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)
            _make_event(s, cal.id, "Old Event", "2024-04-01T09:00:00", "2024-04-01T10:00:00")

        with patch("ollama.chat", return_value={"message": {"content": FAKE_SUMMARY}}):
            res = client.post("/ai/weekly-review", json={"week_start": "2024-04-15T00:00:00"})

        data = res.json()
        assert data["past_count"] == 0
        assert data["upcoming_count"] == 0

    def test_llm_unavailable_returns_503(self):
        """When ollama.chat raises, the route returns 503."""
        with patch("ollama.chat", side_effect=Exception("connection refused")):
            res = client.post("/ai/weekly-review", json={"week_start": "2024-04-15T00:00:00"})

        assert res.status_code == 503
        assert res.json()["detail"]["error"]["code"] == "llm_unavailable"

    def test_multiple_past_events_all_counted(self):
        """All events within the 7-day past window are counted."""
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)
            for day in range(7):
                dt = f"2024-04-{15 + day:02d}T10:00:00"
                _make_event(s, cal.id, f"Day {day}", dt, dt.replace("10:00", "11:00"))

        with patch("ollama.chat", return_value={"message": {"content": FAKE_SUMMARY}}):
            res = client.post("/ai/weekly-review", json={"week_start": "2024-04-15T00:00:00"})

        assert res.json()["past_count"] == 7


# ── 7. Pure date-math tests (no DB, no HTTP) ──
# These mirror the window arithmetic used inside POST /ai/weekly-review.

class TestWeeklyReviewDateMath:
    """Verify the week_start → week_end → next_end window logic directly."""

    def _windows(self, week_start_iso: str):
        from datetime import datetime, timedelta
        ws = datetime.fromisoformat(week_start_iso)
        we = ws + timedelta(days=7)
        ne = we + timedelta(days=7)
        return ws, we, ne

    def test_week_end_is_seven_days_after_start(self):
        from datetime import datetime, timedelta
        _, we, _ = self._windows("2024-04-15T00:00:00")
        assert we == datetime(2024, 4, 22, 0, 0, 0)

    def test_next_end_is_fourteen_days_after_start(self):
        from datetime import datetime
        _, _, ne = self._windows("2024-04-15T00:00:00")
        assert ne == datetime(2024, 4, 29, 0, 0, 0)

    def test_event_at_week_start_is_past(self):
        ws, we, _ = self._windows("2024-04-15T00:00:00")
        event_start = "2024-04-15T00:00:00"
        assert ws.isoformat() <= event_start < we.isoformat()

    def test_event_at_week_end_is_upcoming(self):
        _, we, ne = self._windows("2024-04-15T00:00:00")
        event_start = "2024-04-22T00:00:00"
        assert we.isoformat() <= event_start < ne.isoformat()

    def test_event_before_week_start_in_neither_window(self):
        ws, we, ne = self._windows("2024-04-15T00:00:00")
        event_start = "2024-04-14T23:59:59"
        in_past     = ws.isoformat() <= event_start < we.isoformat()
        in_upcoming = we.isoformat() <= event_start < ne.isoformat()
        assert not in_past and not in_upcoming

    def test_event_at_next_end_in_neither_window(self):
        ws, we, ne = self._windows("2024-04-15T00:00:00")
        event_start = "2024-04-29T00:00:00"
        in_past     = ws.isoformat() <= event_start < we.isoformat()
        in_upcoming = we.isoformat() <= event_start < ne.isoformat()
        assert not in_past and not in_upcoming
