"""
Unit tests for Time Block Template routes.

Tests GET/POST /templates/time-blocks and DELETE + apply endpoints.

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


# ── Helpers ──────────────────────────────────────────────────────────────────

def _seed_calendar(session: Session, name: str = "Test Cal") -> models.Calendar:
    cal = models.Calendar(name=name, color="#aabbcc")
    session.add(cal)
    session.commit()
    session.refresh(cal)
    return cal


def _make_payload(cal_id: int) -> dict:
    return {
        "name": "Deep Work Week",
        "description": "Focus sessions",
        "blocks": [
            {
                "title": "Deep Work",
                "day_of_week": 1,
                "start_time": "09:00",
                "end_time": "11:00",
                "calendar_id": cal_id,
            },
            {
                "title": "Review",
                "day_of_week": 5,
                "start_time": "16:00",
                "end_time": "17:00",
                "calendar_id": cal_id,
            },
        ],
    }


# ── GET /templates/time-blocks ────────────────────────────────────────────────

class TestListTimeBlockTemplates:
    def test_empty_list(self):
        res = client.get("/templates/time-blocks")
        assert res.status_code == 200
        assert res.json() == []

    def test_returns_created_templates(self):
        with Session(_TEST_ENGINE) as s:
            cal = _seed_calendar(s)
        client.post("/templates/time-blocks", json=_make_payload(cal.id))
        res = client.get("/templates/time-blocks")
        assert res.status_code == 200
        assert len(res.json()) == 1
        assert res.json()[0]["name"] == "Deep Work Week"

    def test_returns_multiple_templates(self):
        with Session(_TEST_ENGINE) as s:
            cal = _seed_calendar(s)
        client.post("/templates/time-blocks", json=_make_payload(cal.id))
        client.post("/templates/time-blocks", json={**_make_payload(cal.id), "name": "Recovery Week"})
        res = client.get("/templates/time-blocks")
        assert len(res.json()) == 2


# ── POST /templates/time-blocks ───────────────────────────────────────────────

class TestCreateTimeBlockTemplate:
    def test_create_returns_template(self):
        with Session(_TEST_ENGINE) as s:
            cal = _seed_calendar(s)
        res = client.post("/templates/time-blocks", json=_make_payload(cal.id))
        assert res.status_code == 200
        data = res.json()
        assert data["name"] == "Deep Work Week"
        assert data["description"] == "Focus sessions"
        assert data["id"] is not None

    def test_blocks_json_stored_correctly(self):
        import json
        with Session(_TEST_ENGINE) as s:
            cal = _seed_calendar(s)
        res = client.post("/templates/time-blocks", json=_make_payload(cal.id))
        blocks = json.loads(res.json()["blocks_json"])
        assert len(blocks) == 2
        assert blocks[0]["day_of_week"] == 1
        assert blocks[0]["start_time"] == "09:00"
        assert blocks[0]["end_time"] == "11:00"
        assert blocks[1]["day_of_week"] == 5

    def test_created_at_is_set(self):
        with Session(_TEST_ENGINE) as s:
            cal = _seed_calendar(s)
        res = client.post("/templates/time-blocks", json=_make_payload(cal.id))
        assert res.json()["created_at"] != ""

    def test_empty_blocks_allowed(self):
        res = client.post("/templates/time-blocks", json={"name": "Empty", "blocks": []})
        assert res.status_code == 200
        assert res.json()["name"] == "Empty"

    def test_description_defaults_to_empty_string(self):
        res = client.post("/templates/time-blocks", json={"name": "No Desc", "blocks": []})
        assert res.json()["description"] == ""


# ── DELETE /templates/time-blocks/{id} ───────────────────────────────────────

class TestDeleteTimeBlockTemplate:
    def test_delete_existing_returns_204(self):
        with Session(_TEST_ENGINE) as s:
            cal = _seed_calendar(s)
        tpl_id = client.post("/templates/time-blocks", json=_make_payload(cal.id)).json()["id"]
        res = client.delete(f"/templates/time-blocks/{tpl_id}")
        assert res.status_code == 204

    def test_delete_removes_from_list(self):
        with Session(_TEST_ENGINE) as s:
            cal = _seed_calendar(s)
        tpl_id = client.post("/templates/time-blocks", json=_make_payload(cal.id)).json()["id"]
        client.delete(f"/templates/time-blocks/{tpl_id}")
        assert client.get("/templates/time-blocks").json() == []

    def test_delete_nonexistent_returns_404(self):
        res = client.delete("/templates/time-blocks/9999")
        assert res.status_code == 404

    def test_delete_only_removes_target(self):
        with Session(_TEST_ENGINE) as s:
            cal = _seed_calendar(s)
        id1 = client.post("/templates/time-blocks", json=_make_payload(cal.id)).json()["id"]
        client.post("/templates/time-blocks", json={**_make_payload(cal.id), "name": "Other"})
        client.delete(f"/templates/time-blocks/{id1}")
        remaining = client.get("/templates/time-blocks").json()
        assert len(remaining) == 1
        assert remaining[0]["name"] == "Other"


# ── POST /templates/time-blocks/{id}/apply ───────────────────────────────────

class TestApplyTimeBlockTemplate:
    def test_apply_creates_events(self):
        with Session(_TEST_ENGINE) as s:
            cal = _seed_calendar(s)
        tpl_id = client.post("/templates/time-blocks", json=_make_payload(cal.id)).json()["id"]
        res = client.post(
            f"/templates/time-blocks/{tpl_id}/apply",
            json={"week_monday_date": "2026-04-27"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["applied_count"] == 2
        assert len(data["events"]) == 2

    def test_apply_correct_dates(self):
        """dow=1 maps to Monday 2026-04-27, dow=5 maps to Friday 2026-05-01."""
        with Session(_TEST_ENGINE) as s:
            cal = _seed_calendar(s)
        tpl_id = client.post("/templates/time-blocks", json=_make_payload(cal.id)).json()["id"]
        events = client.post(
            f"/templates/time-blocks/{tpl_id}/apply",
            json={"week_monday_date": "2026-04-27"},
        ).json()["events"]
        dates = {e["title"]: e["start_time"][:10] for e in events}
        assert dates["Deep Work"] == "2026-04-27"   # Monday
        assert dates["Review"] == "2026-05-01"      # Friday

    def test_apply_correct_times(self):
        with Session(_TEST_ENGINE) as s:
            cal = _seed_calendar(s)
        tpl_id = client.post("/templates/time-blocks", json=_make_payload(cal.id)).json()["id"]
        events = client.post(
            f"/templates/time-blocks/{tpl_id}/apply",
            json={"week_monday_date": "2026-04-27"},
        ).json()["events"]
        deep = next(e for e in events if e["title"] == "Deep Work")
        assert "09:00" in deep["start_time"]
        assert "11:00" in deep["end_time"]

    def test_apply_nonexistent_template_returns_404(self):
        res = client.post(
            "/templates/time-blocks/9999/apply",
            json={"week_monday_date": "2026-04-27"},
        )
        assert res.status_code == 404

    def test_apply_invalid_date_returns_422(self):
        with Session(_TEST_ENGINE) as s:
            cal = _seed_calendar(s)
        tpl_id = client.post("/templates/time-blocks", json=_make_payload(cal.id)).json()["id"]
        res = client.post(
            f"/templates/time-blocks/{tpl_id}/apply",
            json={"week_monday_date": "not-a-date"},
        )
        assert res.status_code == 422

    def test_apply_empty_template_returns_zero(self):
        tpl_id = client.post(
            "/templates/time-blocks", json={"name": "Empty", "blocks": []}
        ).json()["id"]
        res = client.post(
            f"/templates/time-blocks/{tpl_id}/apply",
            json={"week_monday_date": "2026-04-27"},
        )
        assert res.status_code == 200
        assert res.json()["applied_count"] == 0
        assert res.json()["events"] == []

    def test_apply_does_not_delete_template(self):
        """Applying is non-destructive — template still exists after apply."""
        with Session(_TEST_ENGINE) as s:
            cal = _seed_calendar(s)
        tpl_id = client.post("/templates/time-blocks", json=_make_payload(cal.id)).json()["id"]
        client.post(
            f"/templates/time-blocks/{tpl_id}/apply",
            json={"week_monday_date": "2026-04-27"},
        )
        templates = client.get("/templates/time-blocks").json()
        assert len(templates) == 1
        assert templates[0]["id"] == tpl_id

    def test_apply_twice_creates_double_events(self):
        """Applying the same template twice stamps blocks for both weeks."""
        with Session(_TEST_ENGINE) as s:
            cal = _seed_calendar(s)
        tpl_id = client.post("/templates/time-blocks", json=_make_payload(cal.id)).json()["id"]
        client.post(f"/templates/time-blocks/{tpl_id}/apply", json={"week_monday_date": "2026-04-27"})
        res2 = client.post(f"/templates/time-blocks/{tpl_id}/apply", json={"week_monday_date": "2026-05-04"})
        assert res2.json()["applied_count"] == 2
        # Second apply targets week of May 4 — Deep Work on 2026-05-04
        dates = {e["title"]: e["start_time"][:10] for e in res2.json()["events"]}
        assert dates["Deep Work"] == "2026-05-04"
