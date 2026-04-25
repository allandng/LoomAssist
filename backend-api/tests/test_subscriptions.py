"""
Phase 9 — iCal Subscription URLs
Run in isolation:
    cd backend-api && pytest tests/test_subscriptions.py -v
"""
import sys
from unittest.mock import MagicMock, AsyncMock, patch
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

SAMPLE_ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:test-event-1@example.com
SUMMARY:Holiday
DTSTART:20260510T090000Z
DTEND:20260510T100000Z
END:VEVENT
END:VCALENDAR"""


@pytest.fixture(autouse=True)
def reset_db():
    SQLModel.metadata.create_all(_TEST_ENGINE)
    yield
    SQLModel.metadata.drop_all(_TEST_ENGINE)


def _make_calendar():
    r = client.post("/calendars/", json={"name": "Test", "description": "", "color": "#6366f1"})
    return r.json()["id"]


# ── CRUD ──────────────────────────────────────────────────────────────────────

def test_create_and_list_subscription():
    cal_id = _make_calendar()
    r = client.post("/subscriptions", json={"name": "Holidays", "url": "https://example.com/cal.ics", "timeline_id": cal_id, "refresh_minutes": 360, "enabled": True})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Holidays"
    assert data["last_synced"] is None

    subs = client.get("/subscriptions").json()
    assert any(s["id"] == data["id"] for s in subs)


def test_delete_subscription_removes_events():
    cal_id = _make_calendar()
    r = client.post("/subscriptions", json={"name": "Test", "url": "https://example.com/test.ics", "timeline_id": cal_id, "refresh_minutes": 360, "enabled": True})
    sub_id = r.json()["id"]

    # Manually create a subscription event with the matching external_uid prefix
    import hashlib
    url_hash = hashlib.md5(b"https://example.com/test.ics").hexdigest()[:8]
    import ollama as _m
    _m.chat.return_value = {"message": {"content": '{"minutes":15,"rationale":"ok"}'}}
    client.post("/events/", json={
        "title": "Sub Event", "start_time": "2026-05-10T09:00:00", "end_time": "2026-05-10T10:00:00",
        "calendar_id": cal_id, "external_uid": f"sub-{url_hash}-abc123",
    })

    events_before = client.get("/events/").json()
    assert any(e["external_uid"].startswith(f"sub-{url_hash}-") for e in events_before)

    client.delete(f"/subscriptions/{sub_id}")

    events_after = client.get("/events/").json()
    assert not any(e["external_uid"].startswith(f"sub-{url_hash}-") for e in events_after)


# ── Refresh ───────────────────────────────────────────────────────────────────

def test_refresh_subscription_upserts_events():
    cal_id = _make_calendar()
    r = client.post("/subscriptions", json={"name": "Test", "url": "https://example.com/cal.ics", "timeline_id": cal_id, "refresh_minutes": 360, "enabled": True})
    sub_id = r.json()["id"]

    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.content = SAMPLE_ICS
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_response)

    with patch("httpx.AsyncClient", return_value=mock_client):
        r2 = client.post(f"/subscriptions/{sub_id}/refresh")

    assert r2.status_code == 200
    assert r2.json()["last_synced"] is not None
    assert r2.json()["last_error"] is None

    events = client.get("/events/").json()
    assert any(e["title"] == "Holiday" for e in events)


def test_refresh_bad_url_records_error():
    cal_id = _make_calendar()
    r = client.post("/subscriptions", json={"name": "Bad", "url": "https://bad.invalid/cal.ics", "timeline_id": cal_id, "refresh_minutes": 360, "enabled": True})
    sub_id = r.json()["id"]

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=Exception("connection refused"))

    with patch("httpx.AsyncClient", return_value=mock_client):
        r2 = client.post(f"/subscriptions/{sub_id}/refresh")

    assert r2.status_code == 200
    assert r2.json()["last_error"] is not None


def test_refresh_twice_upserts_not_duplicates():
    """Refreshing the same feed twice should update, not duplicate events."""
    cal_id = _make_calendar()
    r = client.post("/subscriptions", json={"name": "Test2", "url": "https://example.com/cal2.ics", "timeline_id": cal_id, "refresh_minutes": 360, "enabled": True})
    sub_id = r.json()["id"]

    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.content = SAMPLE_ICS
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_response)

    with patch("httpx.AsyncClient", return_value=mock_client):
        client.post(f"/subscriptions/{sub_id}/refresh")
        client.post(f"/subscriptions/{sub_id}/refresh")

    events = client.get("/events/").json()
    holiday_events = [e for e in events if e["title"] == "Holiday"]
    assert len(holiday_events) == 1
