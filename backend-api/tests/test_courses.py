"""
Phase 8 — Course Concept
Run in isolation:
    cd backend-api && pytest tests/test_courses.py -v
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


# ── Course CRUD ───────────────────────────────────────────────────────────────

def test_create_and_list_course():
    r = client.post("/courses", json={"name": "Data Structures", "code": "CS201", "grade_weights": "[]", "color": "#6366f1"})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Data Structures"
    assert data["code"] == "CS201"

    courses = client.get("/courses").json()
    assert any(c["id"] == data["id"] for c in courses)


def test_update_course():
    r = client.post("/courses", json={"name": "Calc I", "code": "MATH101", "grade_weights": "[]", "color": "#6366f1"})
    cid = r.json()["id"]
    r2 = client.put(f"/courses/{cid}", json={"name": "Calculus I", "code": "MATH101", "instructor": "Dr. Smith", "grade_weights": "[]", "color": "#6366f1"})
    assert r2.status_code == 200
    assert r2.json()["instructor"] == "Dr. Smith"


def test_delete_course():
    r = client.post("/courses", json={"name": "Phys I", "code": "PHY101", "grade_weights": "[]", "color": "#6366f1"})
    cid = r.json()["id"]
    client.delete(f"/courses/{cid}")
    courses = client.get("/courses").json()
    assert all(c["id"] != cid for c in courses)


# ── Assignment CRUD ───────────────────────────────────────────────────────────

def _make_course(name="CS101"):
    r = client.post("/courses", json={"name": name, "code": None, "grade_weights": "[]", "color": "#6366f1"})
    return r.json()["id"]


def test_create_and_list_assignments():
    cid = _make_course()
    r = client.post("/assignments", json={"course_id": cid, "title": "HW 1", "due_date": "2026-05-10"})
    assert r.status_code == 200
    asgns = client.get(f"/assignments?course_id={cid}").json()
    assert any(a["title"] == "HW 1" for a in asgns)


def test_update_assignment_score():
    cid = _make_course()
    r = client.post("/assignments", json={"course_id": cid, "title": "Midterm", "due_date": "2026-05-15", "max_score": 100.0})
    aid = r.json()["id"]
    r2 = client.put(f"/assignments/{aid}", json={"score": 85.0})
    assert r2.status_code == 200
    assert r2.json()["score"] == 85.0


def test_delete_assignment():
    cid = _make_course()
    r = client.post("/assignments", json={"course_id": cid, "title": "Quiz 1", "due_date": "2026-05-05"})
    aid = r.json()["id"]
    client.delete(f"/assignments/{aid}")
    asgns = client.get(f"/assignments?course_id={cid}").json()
    assert all(a["id"] != aid for a in asgns)


# ── Grade calculation ─────────────────────────────────────────────────────────

def test_grade_calculation_weighted():
    weights = '[{"name":"Midterm","weight":40},{"name":"Final","weight":60}]'
    cid = _make_course()
    client.put(f"/courses/{cid}", json={"name": "CS101", "code": None, "grade_weights": weights, "color": "#6366f1"})

    client.post("/assignments", json={"course_id": cid, "title": "Midterm", "due_date": "2026-05-10",
                                       "weight_category": "Midterm", "score": 80.0, "max_score": 100.0})
    client.post("/assignments", json={"course_id": cid, "title": "Final", "due_date": "2026-06-15",
                                       "weight_category": "Final", "score": 90.0, "max_score": 100.0})

    r = client.get(f"/courses/{cid}/grade")
    assert r.status_code == 200
    data = r.json()
    # 80*0.4 + 90*0.6 = 32 + 54 = 86.0
    assert data["grade"] == 86.0
    assert data["breakdown"]["Midterm"] == 80.0
    assert data["breakdown"]["Final"] == 90.0


def test_grade_no_scores_returns_none():
    cid = _make_course()
    r = client.get(f"/courses/{cid}/grade")
    assert r.status_code == 200
    assert r.json()["grade"] is None
