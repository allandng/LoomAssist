"""
Phase 6 — Local Semantic Search
Run in isolation:
    cd backend-api && pytest tests/test_semantic_search.py -v
"""
import sys
from unittest.mock import MagicMock, patch
import numpy as np
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

# Mock sentence-transformers so the test doesn't download a model
_mock_st = MagicMock()
def _fake_encode(text, convert_to_numpy=True, **kw):
    # Deterministic fake embedding: hash of first 4 chars → angle
    angle = sum(ord(c) for c in text[:4]) / 1000.0
    return np.array([np.cos(angle), np.sin(angle), 0.0], dtype=np.float32)
_mock_model_instance = MagicMock()
_mock_model_instance.encode.side_effect = _fake_encode
_mock_st.SentenceTransformer.return_value = _mock_model_instance
sys.modules["sentence_transformers"] = _mock_st

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


def _make_calendar():
    r = client.post("/calendars/", json={"name": "Test", "description": "", "color": "#6366f1"})
    return r.json()["id"]


def _make_event(cal_id, title, description=""):
    import ollama as _ollama_mod
    _ollama_mod.chat.return_value = {"message": {"content": '{"minutes":15,"rationale":"ok"}'}}
    r = client.post("/events/", json={
        "title": title, "description": description,
        "start_time": "2026-05-10T09:00:00", "end_time": "2026-05-10T10:00:00",
        "calendar_id": cal_id,
    })
    return r.json()["event"]["id"]


def test_semantic_search_returns_results():
    cal_id = _make_calendar()
    _make_event(cal_id, "Budget Review", "Q2 runway discussion")
    _make_event(cal_id, "Standup", "daily sync")
    _make_event(cal_id, "Dentist appointment")

    r = client.get("/search/semantic?q=budget+runway&k=10")
    assert r.status_code == 200
    data = r.json()
    assert "results" in data
    assert len(data["results"]) >= 1
    for item in data["results"]:
        assert "event" in item and "score" in item


def test_semantic_search_empty_db_returns_empty():
    r = client.get("/search/semantic?q=anything&k=5")
    assert r.status_code == 200
    assert r.json()["results"] == []


def test_reindex_endpoint():
    cal_id = _make_calendar()
    _make_event(cal_id, "Alpha")
    _make_event(cal_id, "Beta")

    r = client.post("/search/reindex")
    assert r.status_code == 200
    assert r.json()["reindexed"] >= 2


def test_delete_event_removes_embedding():
    cal_id = _make_calendar()
    event_id = _make_event(cal_id, "Temporary Event")

    # Embedding should exist after creation
    r = client.get("/search/semantic?q=temporary&k=5")
    ids = [item["event"]["id"] for item in r.json()["results"]]
    assert event_id in ids

    # Delete event
    client.delete(f"/events/{event_id}")

    # Embedding should be gone
    r2 = client.get("/search/semantic?q=temporary&k=5")
    ids2 = [item["event"]["id"] for item in r2.json()["results"]]
    assert event_id not in ids2
