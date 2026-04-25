"""Phase v3.0: Account / /auth/* route tests.

Verifies the local-side contract:
- /auth/me → 204 in local mode (no Account row).
- /auth/me → Account dict after a row is upserted.
- /auth/logout clears the Account row but does NOT touch any other table.
- PATCH /auth/me edits display_name; email is read-only.
- Sign-out is non-destructive: events / calendars / connections-table rows
  (whichever exist) are preserved.

Setup mirrors test_duration.py — patch the engine and stub heavy modules
BEFORE importing main, then override the DB dependency.
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

for _mod in ("faster_whisper", "ollama", "pypdf", "sentence_transformers", "zeroconf"):
    sys.modules.setdefault(_mod, MagicMock())
sys.modules["faster_whisper"].WhisperModel = MagicMock(return_value=MagicMock())
sys.modules["pypdf"].PdfReader = MagicMock()

import pytest
from fastapi.testclient import TestClient
from datetime import datetime

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


# ── /auth/me ──────────────────────────────────────────────────────────────────

def test_me_returns_204_in_local_mode():
    """No Account row → /auth/me returns 204 (local mode is a first-class state)."""
    r = client.get("/auth/me")
    assert r.status_code == 204
    assert r.content == b""


def test_me_returns_account_after_upsert():
    """When an Account row exists, /auth/me returns it as JSON."""
    with Session(_TEST_ENGINE) as db:
        db.add(models.Account(
            id="me",
            supabase_user_id="abc-123",
            email="alice@example.com",
            display_name="Alice",
            auth_provider="email",
            created_at=datetime.utcnow().isoformat(),
            last_login_at=datetime.utcnow().isoformat(),
        ))
        db.commit()

    r = client.get("/auth/me")
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == "alice@example.com"
    assert data["display_name"] == "Alice"
    assert data["auth_provider"] == "email"
    assert data["supabase_user_id"] == "abc-123"


# ── PATCH /auth/me ────────────────────────────────────────────────────────────

def test_patch_me_updates_display_name_only():
    with Session(_TEST_ENGINE) as db:
        db.add(models.Account(
            id="me",
            supabase_user_id="abc-123",
            email="alice@example.com",
            display_name="Alice",
            auth_provider="email",
            created_at=datetime.utcnow().isoformat(),
        ))
        db.commit()

    r = client.patch("/auth/me", json={"display_name": "Alice C."})
    assert r.status_code == 200
    assert r.json()["display_name"] == "Alice C."
    assert r.json()["email"] == "alice@example.com"  # unchanged


def test_patch_me_404_in_local_mode():
    r = client.patch("/auth/me", json={"display_name": "X"})
    assert r.status_code == 404
    assert r.json()["detail"]["error"]["code"] == "no_account"


# ── /auth/logout — non-destructive ────────────────────────────────────────────

def test_logout_clears_account_only():
    """Per design doc §11 R5 + §10 Q7: sign-out clears Account but leaves
    every other table untouched."""
    with Session(_TEST_ENGINE) as db:
        # Account row.
        db.add(models.Account(
            id="me",
            supabase_user_id="abc",
            email="alice@example.com",
            display_name="Alice",
            auth_provider="email",
            created_at=datetime.utcnow().isoformat(),
        ))
        # A timeline + an event — must survive sign-out.
        cal = models.Calendar(name="Work", color="#10B981")
        db.add(cal)
        db.commit()
        db.refresh(cal)

        ev = models.Event(
            title="Standup",
            start_time="2026-04-25T09:00:00",
            end_time="2026-04-25T09:30:00",
            calendar_id=cal.id,
        )
        db.add(ev)
        db.commit()

    r = client.post("/auth/logout")
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    # Account is gone.
    r2 = client.get("/auth/me")
    assert r2.status_code == 204

    # But the timeline and event still exist.
    with Session(_TEST_ENGINE) as db:
        cal_count = db.query(models.Calendar).count()
        ev_count  = db.query(models.Event).count()
        assert cal_count == 1
        assert ev_count == 1


def test_logout_idempotent_in_local_mode():
    """Calling /auth/logout when there's no Account row is a no-op (200 ok)."""
    r = client.post("/auth/logout")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


# ── /auth/oauth/* without Supabase configured ─────────────────────────────────

def test_oauth_start_503_when_supabase_unconfigured(monkeypatch):
    """Cloud-mode endpoints fail with a structured 503 (not a 500) when
    SUPABASE_URL/SUPABASE_ANON_KEY are unset, so the frontend can show a
    'cloud auth not configured' message gracefully."""
    from services.auth import supabase as sup
    monkeypatch.setattr(sup, "SUPABASE_URL", "")
    monkeypatch.setattr(sup, "SUPABASE_ANON_KEY", "")

    r = client.post("/auth/oauth/google/start")
    assert r.status_code == 503
    assert r.json()["detail"]["error"]["code"] == "supabase_not_configured"


def test_oauth_start_400_for_unknown_provider(monkeypatch):
    """Unsupported providers return 400, not 500."""
    from services.auth import supabase as sup
    monkeypatch.setattr(sup, "SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setattr(sup, "SUPABASE_ANON_KEY", "anon")

    r = client.post("/auth/oauth/facebook/start")
    assert r.status_code == 400
    assert r.json()["detail"]["error"]["code"] == "unsupported_provider"


def test_oauth_start_returns_url_when_configured(monkeypatch):
    from services.auth import supabase as sup
    monkeypatch.setattr(sup, "SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setattr(sup, "SUPABASE_ANON_KEY", "anon")

    r = client.post("/auth/oauth/google/start")
    assert r.status_code == 200
    assert r.json()["auth_url"].startswith("https://x.supabase.co/auth/v1/authorize?provider=google")
