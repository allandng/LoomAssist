"""Phase v3.0 sync review queue tests.

Verifies the SyncReviewItem lifecycle:
- Pending list (resolved_at IS NULL) returned by GET /sync/review.
- Approve writes a NEW local event and marks the item resolved.
- Merge writes the user-merged payload onto the candidate local event.
- Replace-local overwrites the candidate.
- Reject (with `remember=true`) adds a SyncIgnoreRule.
- Resolved items are excluded from subsequent list calls.
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

import json
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


# ── Builders ─────────────────────────────────────────────────────────────────

def _seed_review_item(*, kind="incoming_duplicate", incoming=None, local_event_id=None):
    """Create a Connection, ConnectionCalendar, Calendar, optional local Event,
    and a pending SyncReviewItem. Returns (item_id, local_event_id, cc_id)."""
    incoming = incoming or {
        "title":         "CS 161 Lecture 12",
        "start_time":    "2026-04-23T14:00:00",
        "end_time":      "2026-04-23T15:30:00",
        "description":   "Topic: B-trees",
        "location":      "Soda 306",
        "external_id":   "g-event-1",
        "external_etag": "etag-1",
    }
    with Session(_TEST_ENGINE) as db:
        cal = models.Calendar(name="Coursework", color="#6366f1")
        db.add(cal); db.commit(); db.refresh(cal)

        conn = models.Connection(
            id="conn-1", kind="google",
            display_name="Google — sam@x.com",
            account_email="sam@x.com", caldav_base_url=None,
            status="connected",
            created_at=datetime.utcnow().isoformat(),
        )
        db.add(conn)

        cc = models.ConnectionCalendar(
            id="cc-1", connection_id="conn-1",
            local_calendar_id=cal.id,
            remote_calendar_id="g-cal-1",
            remote_display_name="Coursework",
            sync_direction="both",
            created_at=datetime.utcnow().isoformat(),
        )
        db.add(cc)

        loc_id = local_event_id
        if loc_id is None:
            ev = models.Event(
                title="CS161 lecture",
                start_time="2026-04-23T14:00:00",
                end_time="2026-04-23T15:30:00",
                calendar_id=cal.id,
            )
            db.add(ev); db.commit(); db.refresh(ev)
            loc_id = ev.id

        item = models.SyncReviewItem(
            id="rev-1",
            connection_calendar_id="cc-1",
            kind=kind,
            local_event_id=loc_id,
            incoming_payload=json.dumps(incoming),
            match_score=0.91,
            match_reasons=json.dumps([{"field": "title", "similarity": 0.91, "value_local": "x", "value_incoming": "y"}]),
            created_at=datetime.utcnow().isoformat(),
        )
        db.add(item); db.commit()
        return item.id, loc_id, cc.id


# ── List ─────────────────────────────────────────────────────────────────────

def test_list_returns_pending_items_only():
    iid, _, _ = _seed_review_item()
    r = client.get("/sync/review")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["id"] == iid
    assert rows[0]["kind"] == "incoming_duplicate"
    assert rows[0]["incoming_payload"]["title"] == "CS 161 Lecture 12"


def test_list_excludes_resolved_items():
    iid, _, _ = _seed_review_item()
    # Resolve via reject endpoint.
    r = client.post(f"/sync/review/{iid}/reject", json={"remember": False})
    assert r.status_code == 200
    r2 = client.get("/sync/review")
    assert r2.json() == []


# ── Approve ──────────────────────────────────────────────────────────────────

def test_approve_creates_new_event_and_resolves_item():
    iid, local_id, cc_id = _seed_review_item()
    r = client.post(f"/sync/review/{iid}/approve")
    assert r.status_code == 200
    new_id = r.json()["event_id"]
    assert new_id != local_id  # genuinely new event

    with Session(_TEST_ENGINE) as db:
        new_ev = db.query(models.Event).filter(models.Event.id == new_id).first()
        assert new_ev is not None
        assert new_ev.connection_calendar_id == cc_id
        assert new_ev.external_id == "g-event-1"
        assert new_ev.title == "CS 161 Lecture 12"

        item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == iid).first()
        assert item.resolved_at is not None
        assert item.resolution == "approved_new"


# ── Merge ────────────────────────────────────────────────────────────────────

def test_merge_writes_user_payload_onto_local_event():
    iid, local_id, cc_id = _seed_review_item()
    merged = {
        "title":       "CS 161 Lecture 12",  # accepted from incoming
        "location":    "Soda 306",            # accepted from incoming
        "start_time":  "2026-04-23T14:00:00",
        "end_time":    "2026-04-23T15:30:00",
        "external_id": "g-event-1",
    }
    r = client.post(f"/sync/review/{iid}/merge", json={"merged_payload": merged})
    assert r.status_code == 200
    assert r.json()["event_id"] == local_id

    with Session(_TEST_ENGINE) as db:
        ev = db.query(models.Event).filter(models.Event.id == local_id).first()
        assert ev.title    == "CS 161 Lecture 12"
        assert ev.location == "Soda 306"
        assert ev.connection_calendar_id == cc_id
        assert ev.external_id == "g-event-1"
        assert ev.last_synced_at  # set on merge

        item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == iid).first()
        assert item.resolution == "merged"


# ── Replace-local ────────────────────────────────────────────────────────────

def test_replace_local_overwrites_candidate():
    iid, local_id, cc_id = _seed_review_item()
    r = client.post(f"/sync/review/{iid}/replace-local")
    assert r.status_code == 200
    assert r.json()["event_id"] == local_id

    with Session(_TEST_ENGINE) as db:
        ev = db.query(models.Event).filter(models.Event.id == local_id).first()
        assert ev.title == "CS 161 Lecture 12"  # incoming title
        assert ev.location == "Soda 306"
        item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == iid).first()
        assert item.resolution == "replaced_local"


# ── Reject (+remember) ───────────────────────────────────────────────────────

def test_reject_with_remember_writes_ignore_rule():
    iid, _, cc_id = _seed_review_item()
    r = client.post(f"/sync/review/{iid}/reject", json={"remember": True})
    assert r.status_code == 200

    with Session(_TEST_ENGINE) as db:
        rule_count = db.query(models.SyncIgnoreRule).count()
        assert rule_count == 1
        item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == iid).first()
        assert item.resolution == "ignored_forever"


def test_reject_without_remember_skips_ignore_rule():
    iid, _, _ = _seed_review_item()
    r = client.post(f"/sync/review/{iid}/reject", json={"remember": False})
    assert r.status_code == 200
    with Session(_TEST_ENGINE) as db:
        assert db.query(models.SyncIgnoreRule).count() == 0
        item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == iid).first()
        assert item.resolution == "rejected"


# ── 404 paths ────────────────────────────────────────────────────────────────

def test_get_unknown_review_404():
    r = client.get("/sync/review/nope")
    assert r.status_code == 404


def test_actions_on_resolved_404():
    iid, _, _ = _seed_review_item()
    client.post(f"/sync/review/{iid}/reject", json={"remember": False})
    # Second call on a resolved item is a 404 (per the route's contract).
    r = client.post(f"/sync/review/{iid}/reject", json={"remember": False})
    assert r.status_code == 404
