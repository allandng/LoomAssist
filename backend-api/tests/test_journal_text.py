"""
Class-Day Journal Prompt — text-mode journal endpoint
Run in isolation:
    cd backend-api && pytest tests/test_journal_text.py -v
"""
import sys
from unittest.mock import MagicMock
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


@pytest.fixture(autouse=True)
def reset_db():
    SQLModel.metadata.create_all(_TEST_ENGINE)
    yield
    SQLModel.metadata.drop_all(_TEST_ENGINE)


def test_create_journal_text_with_event_id():
    r = client.post(
        "/journal/text",
        json={"text": "Two key takeaways from class today.", "event_id": 42, "date": "2026-05-10"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["transcript"] == "Two key takeaways from class today."
    assert data["event_id"] == 42
    assert data["date"] == "2026-05-10"
    assert data["audio_path"] is None


def test_create_journal_text_defaults_date_to_today():
    r = client.post("/journal/text", json={"text": "Quick note"})
    assert r.status_code == 200
    data = r.json()
    assert data["date"]  # ISO date string
    assert data["event_id"] is None


def test_journal_text_rejects_empty_text():
    r = client.post("/journal/text", json={"text": "   "})
    assert r.status_code == 400
    assert r.json()["detail"]["error"]["code"] == "empty_text"


def test_journal_text_truncates_oversized_input():
    big = "x" * 1200
    r = client.post("/journal/text", json={"text": big})
    assert r.status_code == 200
    assert len(r.json()["transcript"]) <= 600


def test_list_journal_returns_event_id():
    client.post("/journal/text", json={"text": "Lecture takeaway", "event_id": 7, "date": "2026-05-10"})
    r = client.get("/journal")
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) == 1
    assert entries[0]["event_id"] == 7
