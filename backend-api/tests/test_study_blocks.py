"""
Unit tests for Study Block Auto-Generator.

Tests POST /study/generate-preview and POST /study/confirm-blocks.

Setup strategy: patch database.database engine + stub heavy C-extension imports
(faster_whisper, ollama, pypdf) *before* importing main so the module-level
WhisperModel() call and bare `import` statements don't fail in a test environment.
"""
import sys
from datetime import datetime, timedelta
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

sys.modules["faster_whisper"].WhisperModel = MagicMock(return_value=MagicMock())
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


def _make_calendar(session: Session, name: str = "Test Cal") -> models.Calendar:
    cal = models.Calendar(name=name, color="#6366f1")
    session.add(cal)
    session.commit()
    session.refresh(cal)
    return cal


def _future_date(days: int) -> str:
    """Return an ISO date string N days from now."""
    return (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")


def _past_date(days: int) -> str:
    return (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")


# ── 6. POST /study/generate-preview ──

class TestGeneratePreview:

    def _base_payload(self, calendar_id: int, **overrides) -> dict:
        return {
            "subject": "COMP3001",
            "deadline_date": _future_date(90),
            "calendar_id": calendar_id,
            "num_sessions": 5,
            "session_duration_minutes": 90,
            "preferred_hour": 18,
            "skip_weekends": True,
            **overrides,
        }

    def test_returns_correct_count(self):
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        res = client.post("/study/generate-preview", json=self._base_payload(cal.id))
        assert res.status_code == 200
        assert len(res.json()) == 5

    def test_past_deadline_returns_400(self):
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        payload = self._base_payload(cal.id, deadline_date=_past_date(1))
        res = client.post("/study/generate-preview", json=payload)
        assert res.status_code == 400

    def test_titles_include_subject(self):
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        res = client.post("/study/generate-preview", json=self._base_payload(cal.id))
        blocks = res.json()
        for block in blocks:
            assert "COMP3001" in block["title"]

    def test_last_session_is_final_review(self):
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        blocks = client.post("/study/generate-preview", json=self._base_payload(cal.id)).json()
        assert "Final Review" in blocks[-1]["title"]

    def test_non_last_sessions_are_numbered(self):
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        blocks = client.post("/study/generate-preview", json=self._base_payload(cal.id)).json()
        for block in blocks[:-1]:
            assert "Study Session" in block["title"]

    def test_skip_weekends_no_saturday_sunday(self):
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        blocks = client.post("/study/generate-preview", json=self._base_payload(cal.id)).json()
        for block in blocks:
            dt = datetime.fromisoformat(block["start_time"])
            assert dt.weekday() < 5, f"Weekend block found: {block['start_time']}"

    def test_skip_weekends_false_does_not_filter(self):
        """With skip_weekends=False and enough sessions over a short window,
        at least one weekend date may be scheduled. We simply assert no 400 and
        that the session count matches num_sessions."""
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        # 14 days, 7 sessions — interval=2 so all 7 land
        payload = self._base_payload(
            cal.id,
            deadline_date=_future_date(14),
            num_sessions=7,
            skip_weekends=False,
        )
        res = client.post("/study/generate-preview", json=payload)
        assert res.status_code == 200
        # All 7 should be scheduled within 14 days with 2-day intervals
        assert len(res.json()) == 7

    def test_preferred_hour_in_start_time(self):
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        payload = self._base_payload(cal.id, preferred_hour=9)
        blocks = client.post("/study/generate-preview", json=payload).json()
        for block in blocks:
            dt = datetime.fromisoformat(block["start_time"])
            assert dt.hour == 9

    def test_session_duration_respected(self):
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        payload = self._base_payload(cal.id, session_duration_minutes=60)
        blocks = client.post("/study/generate-preview", json=payload).json()
        for block in blocks:
            start = datetime.fromisoformat(block["start_time"])
            end   = datetime.fromisoformat(block["end_time"])
            assert (end - start).seconds // 60 == 60

    def test_fewer_blocks_when_deadline_tight(self):
        """Deadline in 2 days with 5 sessions requested — should return fewer than 5."""
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        payload = self._base_payload(
            cal.id,
            deadline_date=_future_date(2),
            num_sessions=5,
            skip_weekends=False,
        )
        res = client.post("/study/generate-preview", json=payload)
        assert res.status_code == 200
        assert len(res.json()) < 5

    def test_description_contains_deadline(self):
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        deadline = _future_date(90)
        payload = self._base_payload(cal.id, deadline_date=deadline)
        blocks = client.post("/study/generate-preview", json=payload).json()
        for block in blocks:
            assert deadline in block["description"]

    def test_calendar_id_set_on_blocks(self):
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        blocks = client.post("/study/generate-preview", json=self._base_payload(cal.id)).json()
        for block in blocks:
            assert block["calendar_id"] == cal.id


# ── 7. POST /study/confirm-blocks ──

class TestConfirmBlocks:

    def _make_preview_blocks(self, calendar_id: int, count: int = 3) -> list[dict]:
        base = datetime.now() + timedelta(days=1)
        blocks = []
        for i in range(count):
            start = (base + timedelta(days=i * 7)).replace(minute=0, second=0, microsecond=0)
            end   = start + timedelta(minutes=90)
            blocks.append({
                "title": f"COMP3001 — Study Session {i + 1}",
                "start_time": start.isoformat(),
                "end_time": end.isoformat(),
                "description": f"Auto-generated. Deadline: {_future_date(60)}",
                "calendar_id": calendar_id,
            })
        return blocks

    def test_creates_events_in_db(self):
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        blocks = self._make_preview_blocks(cal.id, count=3)
        res = client.post("/study/confirm-blocks", json=blocks)
        assert res.status_code == 200

        with Session(_TEST_ENGINE) as s:
            events = s.query(models.Event).all()
        assert len(events) == 3

    def test_returns_created_count(self):
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        blocks = self._make_preview_blocks(cal.id, count=4)
        data = client.post("/study/confirm-blocks", json=blocks).json()
        assert data["created_count"] == 4

    def test_created_events_have_correct_fields(self):
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        blocks = self._make_preview_blocks(cal.id, count=1)
        res = client.post("/study/confirm-blocks", json=blocks)
        assert res.status_code == 200

        with Session(_TEST_ENGINE) as s:
            ev = s.query(models.Event).first()
        assert ev is not None
        assert ev.title == blocks[0]["title"]
        assert ev.calendar_id == cal.id
        assert ev.start_time == blocks[0]["start_time"]
        assert ev.end_time == blocks[0]["end_time"]

    def test_empty_list_returns_zero(self):
        res = client.post("/study/confirm-blocks", json=[])
        assert res.status_code == 200
        assert res.json()["created_count"] == 0

    def test_events_list_in_response(self):
        with Session(_TEST_ENGINE) as s:
            cal = _make_calendar(s)

        blocks = self._make_preview_blocks(cal.id, count=2)
        data = client.post("/study/confirm-blocks", json=blocks).json()
        assert "events" in data
        assert len(data["events"]) == 2
