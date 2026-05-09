"""Unit tests for the Missed feature (Step 1: backend).

Covers:
  - run_migrations adds the `missed_at` column and is idempotent
  - GET /events/missed honors every clause of the filter
  - Truncation flag flips correctly at 20+ items
  - missed_at round-trips through PUT /events/{id} (set, clear, set again)

Setup mirrors test_duration.py — engine swapped to in-memory SQLite, heavy
optional imports stubbed before main is imported.
"""
import sys
from unittest.mock import MagicMock

# 1. Redirect DB to an in-memory SQLite before any app import
from sqlmodel import create_engine, SQLModel, Session
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

import database.database as _db

_TEST_ENGINE = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_db.engine = _TEST_ENGINE
_db.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_TEST_ENGINE)

# 2. Stub heavy/optional imports
for _mod in ("faster_whisper", "ollama", "pypdf", "pypdf.PdfReader"):
    sys.modules.setdefault(_mod, MagicMock())
sys.modules["faster_whisper"].WhisperModel = MagicMock(return_value=MagicMock())
sys.modules["pypdf"].PdfReader = MagicMock()

# 3. Import the app
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


def _seed_calendar(s: Session) -> int:
    cal = models.Calendar(name="Cal", color="#fff")
    s.add(cal); s.commit(); s.refresh(cal)
    return cal.id


def _seed_event(s: Session, cal_id: int, **overrides) -> int:
    payload = dict(
        title="Lunch",
        start_time="2024-04-25T12:00:00",
        end_time="2024-04-25T13:00:00",
        calendar_id=cal_id,
    )
    payload.update(overrides)
    ev = models.Event(**payload)
    s.add(ev); s.commit(); s.refresh(ev)
    return ev.id


def _put_event(event_id: int, **fields):
    """PUT a full-payload edit using only the fields the test cares about
    (everything else carries default values from EventBase)."""
    base = dict(
        title="Lunch",
        start_time="2024-04-25T12:00:00",
        end_time="2024-04-25T13:00:00",
        calendar_id=fields.pop("calendar_id"),
    )
    base.update(fields)
    return client.put(f"/events/{event_id}", json=base)


# Migration ─────────────────────────────────────────────────────────────────

class TestMigration:
    def test_adds_missed_at_column_and_is_idempotent(self):
        """Pre-create an event table without `missed_at`, run migrations, verify
        the column was added, then run migrations again to confirm idempotency."""
        fresh = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        saved = _db.engine
        _db.engine = fresh
        try:
            with fresh.begin() as conn:
                conn.execute(text("""
                    CREATE TABLE event (
                        id INTEGER PRIMARY KEY,
                        title TEXT NOT NULL,
                        start_time TEXT NOT NULL,
                        end_time TEXT NOT NULL,
                        calendar_id INTEGER NOT NULL
                    )
                """))
            _db.run_migrations()
            with fresh.connect() as conn:
                cols = [row[1] for row in conn.execute(text("PRAGMA table_info(event)")).fetchall()]
                assert "missed_at" in cols, f"missed_at not added; cols={cols}"
            _db.run_migrations()
            with fresh.connect() as conn:
                cols2 = [row[1] for row in conn.execute(text("PRAGMA table_info(event)")).fetchall()]
                assert cols == cols2, "Re-running migrations changed schema"
        finally:
            _db.engine = saved


# GET /events/missed filter ─────────────────────────────────────────────────

class TestMissedFilter:
    def test_empty_db_returns_empty_list(self):
        res = client.get("/events/missed")
        assert res.status_code == 200
        assert res.json() == {"items": [], "truncated": False}

    def test_marked_event_appears(self):
        with Session(_TEST_ENGINE) as s:
            cal_id = _seed_calendar(s)
            _seed_event(s, cal_id, missed_at="2024-04-26T10:00:00")
        res = client.get("/events/missed")
        assert res.status_code == 200
        items = res.json()["items"]
        assert len(items) == 1
        assert items[0]["missed_at"] == "2024-04-26T10:00:00"

    def test_unmarked_event_excluded(self):
        with Session(_TEST_ENGINE) as s:
            cal_id = _seed_calendar(s)
            _seed_event(s, cal_id, missed_at=None)  # explicit
            _seed_event(s, cal_id)  # implicit default None
        res = client.get("/events/missed")
        assert res.json()["items"] == []

    def test_deleted_event_excluded(self):
        with Session(_TEST_ENGINE) as s:
            cal_id = _seed_calendar(s)
            _seed_event(s, cal_id, missed_at="2024-04-26T10:00:00",
                        deleted_at="2024-04-27T00:00:00")
        assert client.get("/events/missed").json()["items"] == []

    def test_synced_event_excluded(self):
        with Session(_TEST_ENGINE) as s:
            cal_id = _seed_calendar(s)
            _seed_event(s, cal_id, missed_at="2024-04-26T10:00:00",
                        connection_calendar_id="cc-uuid-123")
        assert client.get("/events/missed").json()["items"] == []

    def test_recurring_event_excluded(self):
        with Session(_TEST_ENGINE) as s:
            cal_id = _seed_calendar(s)
            _seed_event(s, cal_id, missed_at="2024-04-26T10:00:00",
                        is_recurring=True, recurrence_days="1,3")
        assert client.get("/events/missed").json()["items"] == []

    def test_all_day_event_excluded(self):
        with Session(_TEST_ENGINE) as s:
            cal_id = _seed_calendar(s)
            _seed_event(s, cal_id, missed_at="2024-04-26T10:00:00",
                        is_all_day=True)
        assert client.get("/events/missed").json()["items"] == []

    def test_legacy_null_recurring_and_all_day_included(self):
        """Legacy rows pre-dating the booleans store NULL — must still appear
        when missed_at is set. Verifies `!= True` semantics over `== False`."""
        with Session(_TEST_ENGINE) as s:
            cal_id = _seed_calendar(s)
            ev_id = _seed_event(s, cal_id, missed_at="2024-04-26T10:00:00")
            # Force the booleans to NULL like a legacy row
            s.execute(text(
                "UPDATE event SET is_recurring = NULL, is_all_day = NULL WHERE id = :id"
            ), {"id": ev_id})
            s.commit()
        items = client.get("/events/missed").json()["items"]
        assert len(items) == 1

    def test_sorted_by_start_time_ascending(self):
        with Session(_TEST_ENGINE) as s:
            cal_id = _seed_calendar(s)
            _seed_event(s, cal_id, title="C",
                        start_time="2024-04-25T15:00:00",
                        end_time="2024-04-25T16:00:00",
                        missed_at="2024-04-26T10:00:00")
            _seed_event(s, cal_id, title="A",
                        start_time="2024-04-25T09:00:00",
                        end_time="2024-04-25T10:00:00",
                        missed_at="2024-04-26T10:00:00")
            _seed_event(s, cal_id, title="B",
                        start_time="2024-04-25T12:00:00",
                        end_time="2024-04-25T13:00:00",
                        missed_at="2024-04-26T10:00:00")
        titles = [e["title"] for e in client.get("/events/missed").json()["items"]]
        assert titles == ["A", "B", "C"]


# Truncation ────────────────────────────────────────────────────────────────

class TestTruncation:
    def _seed_n_marked(self, n: int):
        with Session(_TEST_ENGINE) as s:
            cal_id = _seed_calendar(s)
            for i in range(n):
                _seed_event(
                    s, cal_id,
                    title=f"E{i:02d}",
                    start_time=f"2024-04-25T{(9 + i // 60):02d}:{i % 60:02d}:00",
                    end_time=f"2024-04-25T{(10 + i // 60):02d}:{i % 60:02d}:00",
                    missed_at="2024-04-26T10:00:00",
                )

    def test_exactly_20_returns_not_truncated(self):
        self._seed_n_marked(20)
        body = client.get("/events/missed").json()
        assert len(body["items"]) == 20
        assert body["truncated"] is False

    def test_21_returns_truncated(self):
        self._seed_n_marked(21)
        body = client.get("/events/missed").json()
        assert len(body["items"]) == 20
        assert body["truncated"] is True

    def test_50_returns_truncated_and_caps_at_20(self):
        self._seed_n_marked(50)
        body = client.get("/events/missed").json()
        assert len(body["items"]) == 20
        assert body["truncated"] is True


# missed_at round-trip via PUT ──────────────────────────────────────────────

class TestMissedAtRoundTrip:
    def test_put_sets_missed_at(self):
        with Session(_TEST_ENGINE) as s:
            cal_id = _seed_calendar(s)
            ev_id = _seed_event(s, cal_id)

        res = _put_event(ev_id, calendar_id=cal_id,
                         missed_at="2024-04-26T10:00:00")
        assert res.status_code == 200
        assert res.json()["event"]["missed_at"] == "2024-04-26T10:00:00"

        # Now appears in the list
        items = client.get("/events/missed").json()["items"]
        assert len(items) == 1 and items[0]["id"] == ev_id

    def test_put_clears_missed_at(self):
        with Session(_TEST_ENGINE) as s:
            cal_id = _seed_calendar(s)
            ev_id = _seed_event(s, cal_id, missed_at="2024-04-26T10:00:00")

        # Clear by PUTting full payload with missed_at=None
        res = _put_event(ev_id, calendar_id=cal_id, missed_at=None)
        assert res.status_code == 200
        assert res.json()["event"]["missed_at"] is None

        assert client.get("/events/missed").json()["items"] == []

    def test_put_set_clear_set_again(self):
        with Session(_TEST_ENGINE) as s:
            cal_id = _seed_calendar(s)
            ev_id = _seed_event(s, cal_id)

        # Set
        _put_event(ev_id, calendar_id=cal_id, missed_at="2024-04-26T10:00:00")
        assert len(client.get("/events/missed").json()["items"]) == 1
        # Clear
        _put_event(ev_id, calendar_id=cal_id, missed_at=None)
        assert client.get("/events/missed").json()["items"] == []
        # Set again with a different timestamp
        _put_event(ev_id, calendar_id=cal_id, missed_at="2024-04-27T11:30:00")
        items = client.get("/events/missed").json()["items"]
        assert len(items) == 1
        assert items[0]["missed_at"] == "2024-04-27T11:30:00"

    def test_put_with_omitted_missed_at_clears_it(self):
        """Auto-clear-on-save semantic: when the editor sends a payload that
        omits missed_at, Pydantic defaults it to None and the row clears.
        Documented client-side contract — verifying server-side behavior here."""
        with Session(_TEST_ENGINE) as s:
            cal_id = _seed_calendar(s)
            ev_id = _seed_event(s, cal_id, missed_at="2024-04-26T10:00:00")
        # Don't pass missed_at at all
        res = _put_event(ev_id, calendar_id=cal_id)
        assert res.status_code == 200
        assert res.json()["event"]["missed_at"] is None
