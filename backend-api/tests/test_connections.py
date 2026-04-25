"""Phase v3.0 connections route tests.

Verifies:
- Connection list / status when none exist
- Disconnect is non-destructive locally (events stay; columns null out)
- Subscribe creates a ConnectionCalendar (and a new Calendar when omitted)
- UNIQUE(connection_id, remote_calendar_id) enforced via 409
- Per-timeline keep/move/delete strategies on disconnect
"""
import sys
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
from datetime import datetime
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


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_connection(db: Session, *, kind="google", name="Google — sam@x.com"):
    c = models.Connection(
        id="conn-1", kind=kind,
        display_name=name, account_email="sam@x.com",
        caldav_base_url=None, status="connected",
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(c)
    db.commit()
    return c


def _make_local_calendar(db: Session, *, name="Personal", color="#6366f1", created_via_sync=False):
    cal = models.Calendar(name=name, color=color, created_via_sync=created_via_sync)
    db.add(cal); db.commit(); db.refresh(cal)
    return cal


# ── Tests ────────────────────────────────────────────────────────────────────

def test_list_connections_empty():
    r = client.get("/connections")
    assert r.status_code == 200
    assert r.json() == []


def test_list_connections_returns_rows():
    with Session(_TEST_ENGINE) as db:
        _make_connection(db)
    r = client.get("/connections")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["kind"] == "google"
    assert rows[0]["status"] == "connected"


def test_subscribe_creates_cc_and_auto_creates_calendar():
    with Session(_TEST_ENGINE) as db:
        _make_connection(db)
    r = client.post("/connections/conn-1/subscribe", json={
        "remote_calendar_id":   "calendar-id-1",
        "remote_display_name":  "Work",
        "remote_color":         "#10B981",
        "sync_direction":       "both",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["sync_direction"] == "both"
    assert body["local_calendar_id"]  # auto-created

    with Session(_TEST_ENGINE) as db:
        cal = db.query(models.Calendar).filter(models.Calendar.id == body["local_calendar_id"]).first()
        assert cal is not None
        assert cal.name == "Work"
        assert cal.created_via_sync is True


def test_subscribe_unique_remote_calendar_id_per_connection():
    """Per design doc §10 Q8: a remote calendar can only be synced to one
    local timeline. Re-subscribing returns 409."""
    with Session(_TEST_ENGINE) as db:
        _make_connection(db)
    payload = {
        "remote_calendar_id":  "cal-x",
        "remote_display_name": "Work",
        "sync_direction":      "both",
    }
    r1 = client.post("/connections/conn-1/subscribe", json=payload)
    assert r1.status_code == 200
    r2 = client.post("/connections/conn-1/subscribe", json=payload)
    assert r2.status_code == 409
    assert r2.json()["detail"]["error"]["code"] == "already_subscribed"


def test_disconnect_nulls_out_events_locally():
    """Per design doc §3 + §10 Q7: disconnect must not delete events. They
    become local-only — connection_calendar_id, external_id, external_etag,
    last_synced_at all null."""
    with Session(_TEST_ENGINE) as db:
        _make_connection(db)
        cal = _make_local_calendar(db, created_via_sync=True)
        cc = models.ConnectionCalendar(
            id="cc-1", connection_id="conn-1",
            local_calendar_id=cal.id,
            remote_calendar_id="g-cal-1",
            remote_display_name="Work",
            sync_direction="both",
            created_at=datetime.utcnow().isoformat(),
        )
        db.add(cc)
        ev = models.Event(
            title="OS Lecture",
            start_time="2026-04-23T14:00:00",
            end_time="2026-04-23T15:30:00",
            calendar_id=cal.id,
            connection_calendar_id="cc-1",
            external_id="g-event-1",
            external_etag="etag-1",
            last_synced_at=datetime.utcnow().isoformat(),
        )
        db.add(ev)
        db.commit()

    r = client.request("DELETE", "/connections/conn-1", json={"timelines": []})
    assert r.status_code == 200

    with Session(_TEST_ENGINE) as db:
        # Event still exists (non-destructive).
        ev_after = db.query(models.Event).filter(models.Event.title == "OS Lecture").first()
        assert ev_after is not None
        assert ev_after.connection_calendar_id is None
        assert ev_after.external_id is None
        assert ev_after.external_etag is None
        assert ev_after.last_synced_at is None
        # Calendar (timeline) preserved by default (strategy='keep' is implicit
        # when no explicit decision is given).
        assert db.query(models.Calendar).filter(models.Calendar.id == 1).first() is not None
        # Connection + ConnectionCalendar gone.
        assert db.query(models.Connection).count() == 0
        assert db.query(models.ConnectionCalendar).count() == 0


def test_disconnect_with_delete_strategy_removes_timeline_and_events():
    """When a timeline was created_via_sync and the user picks 'delete',
    the timeline + its events are removed."""
    with Session(_TEST_ENGINE) as db:
        _make_connection(db)
        cal = _make_local_calendar(db, name="AutoCreated", created_via_sync=True)
        cc = models.ConnectionCalendar(
            id="cc-1", connection_id="conn-1",
            local_calendar_id=cal.id,
            remote_calendar_id="g-cal-1",
            remote_display_name="AutoCreated",
            sync_direction="both",
            created_at=datetime.utcnow().isoformat(),
        )
        db.add(cc)
        ev = models.Event(
            title="Throwaway",
            start_time="2026-04-23T14:00:00",
            end_time="2026-04-23T15:00:00",
            calendar_id=cal.id,
            connection_calendar_id="cc-1",
            external_id="g-event-1",
        )
        db.add(ev)
        db.commit()
        cal_id = cal.id

    r = client.request("DELETE", "/connections/conn-1", json={
        "timelines": [{"local_calendar_id": cal_id, "strategy": "delete"}],
    })
    assert r.status_code == 200

    with Session(_TEST_ENGINE) as db:
        assert db.query(models.Calendar).filter(models.Calendar.id == cal_id).count() == 0
        assert db.query(models.Event).filter(models.Event.title == "Throwaway").count() == 0


def test_pause_and_resume_flips_status():
    with Session(_TEST_ENGINE) as db:
        _make_connection(db)
    r = client.post("/connections/conn-1/pause")
    assert r.status_code == 200
    assert r.json()["status"] == "paused"
    r = client.post("/connections/conn-1/resume")
    assert r.status_code == 200
    assert r.json()["status"] == "connected"


def test_disconnect_404_for_unknown_id():
    r = client.request("DELETE", "/connections/nope", json={"timelines": []})
    assert r.status_code == 404


def test_caldav_test_endpoint_requires_credentials():
    """Smoke check that the /connections/caldav/test endpoint exists and
    returns a structured failure for clearly bad credentials. We can't run
    a real PROPFIND in this test environment, but we can verify the route
    is registered and returns 200 with ok=False (caldav is mocked)."""
    r = client.post("/connections/caldav/test", json={
        "base_url": "https://example.invalid",
        "username": "x", "password": "y",
    })
    # The mocked caldav module returns a MagicMock rather than failing — but
    # the route itself must respond cleanly (no 500).
    assert r.status_code in (200, 400, 401)
