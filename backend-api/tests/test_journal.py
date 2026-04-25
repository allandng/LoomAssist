"""
Phase 12 — Voice Journal
Run in isolation:
    cd backend-api && pytest tests/test_journal.py -v
"""
import sys, io
from unittest.mock import MagicMock, patch
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

# Stub Whisper model to return predictable transcription
_whisper_mock = MagicMock()
_whisper_mock.transcribe.return_value = ([MagicMock(text=" Today was productive.")], MagicMock())
sys.modules["faster_whisper"].WhisperModel.return_value = _whisper_mock

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


AUDIO_BYTES = b"\x00" * 100  # fake audio bytes


def _post_journal(date=None, mood=None):
    files = {"audio": ("journal.webm", io.BytesIO(AUDIO_BYTES), "audio/webm")}
    data  = {}
    if date: data["date"] = date
    if mood: data["mood"] = mood
    return client.post("/journal", files=files, data=data)


# ── CRUD ──────────────────────────────────────────────────────────────────────

def test_create_journal_entry_with_transcription():
    r = _post_journal(date="2026-05-10", mood="great")
    assert r.status_code == 200
    data = r.json()
    assert data["date"] == "2026-05-10"
    assert data["mood"] == "great"
    assert "productive" in data["transcript"].lower()


def test_list_journal_entries():
    _post_journal(date="2026-05-10")
    _post_journal(date="2026-05-11")
    r = client.get("/journal")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_list_journal_date_filter():
    _post_journal(date="2026-05-10")
    _post_journal(date="2026-05-12")
    r = client.get("/journal?from_date=2026-05-11&to_date=2026-05-13")
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) == 1
    assert entries[0]["date"] == "2026-05-12"


def test_delete_journal_entry():
    r = _post_journal(date="2026-05-10")
    eid = r.json()["id"]
    dr = client.delete(f"/journal/{eid}")
    assert dr.status_code == 200
    entries = client.get("/journal").json()
    assert all(e["id"] != eid for e in entries)


# ── Weekly review includes journal ───────────────────────────────────────────

def test_weekly_review_includes_journal_reflections():
    import ollama as _m
    _post_journal(date="2026-05-11", mood="ok")  # within May 11–17 week

    _m.chat.return_value = {"message": {"content": "Great week with reflections noted."}}
    r = client.post("/ai/weekly-review", json={"week_start": "2026-05-11T00:00:00"})
    assert r.status_code == 200
    # Check that the LLM was called with journal content in the prompt
    call_args = _m.chat.call_args
    prompt = call_args[1]["messages"][0]["content"] if call_args[1] else call_args[0][1][0]["content"]
    assert "reflections" in prompt.lower() or "journal" in prompt.lower()
