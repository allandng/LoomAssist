"""
Schema-foundation tests for Feature 10 (Group Project Tracker) — PR1.

Verifies:
  1. Migration runs cleanly and is idempotent (boot-twice safe).
  2. New tables exist: project, person, projectmember.
  3. New columns exist on course, assignment, availabilityrequest.
  4. SQLModel classes round-trip via direct session inserts.
  5. Existing tables remain untouched (no regression on Course / Assignment shape).

No HTTP routes are exercised — those land in PR2. Run with:
    pytest tests/test_projects_schema.py -v
"""
import sys
from unittest.mock import MagicMock

# ── 1. Redirect DB to an in-memory SQLite before anything app-related imports ──
from sqlmodel import create_engine, SQLModel, Session
from sqlalchemy import text
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
for _mod in ("faster_whisper", "ollama", "pypdf", "sentence_transformers", "zeroconf", "caldav"):
    sys.modules.setdefault(_mod, MagicMock())
sys.modules["faster_whisper"].WhisperModel = MagicMock(return_value=MagicMock())
sys.modules["pypdf"].PdfReader = MagicMock()

# ── 3. Now it's safe to import app + models ──
import pytest
from database import models
from database.database import run_migrations


# ── 4. Fixtures ──

@pytest.fixture
def fresh_schema():
    """Create all tables from SQLModel metadata + run migrations once.

    Returns the test engine. Tables are dropped after the test so each test
    starts from a clean slate (independent of pytest order).
    """
    SQLModel.metadata.create_all(_TEST_ENGINE)
    run_migrations()
    yield _TEST_ENGINE
    SQLModel.metadata.drop_all(_TEST_ENGINE)


# ── 5. Schema presence ──

def _columns(engine, table: str) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return {row[1] for row in rows}


def _table_exists(engine, table: str) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
            {"n": table},
        ).fetchone()
    return row is not None


class TestNewTables:
    def test_project_table_exists(self, fresh_schema):
        assert _table_exists(fresh_schema, "project")

    def test_person_table_exists(self, fresh_schema):
        assert _table_exists(fresh_schema, "person")

    def test_projectmember_table_exists(self, fresh_schema):
        assert _table_exists(fresh_schema, "projectmember")

    def test_project_columns(self, fresh_schema):
        cols = _columns(fresh_schema, "project")
        assert {"id", "course_id", "name", "description", "color", "archived_at", "created_at"} <= cols

    def test_person_columns(self, fresh_schema):
        cols = _columns(fresh_schema, "person")
        assert {"id", "name", "email", "phone", "notes", "archived_at", "is_self", "created_at"} <= cols

    def test_projectmember_columns(self, fresh_schema):
        cols = _columns(fresh_schema, "projectmember")
        assert {"id", "project_id", "person_id", "role", "created_at"} <= cols


class TestExistingTablesGainNewColumns:
    def test_course_kind_column(self, fresh_schema):
        assert "kind" in _columns(fresh_schema, "course")

    def test_assignment_project_id_column(self, fresh_schema):
        assert "project_id" in _columns(fresh_schema, "assignment")

    def test_assignment_assignee_person_id_column(self, fresh_schema):
        assert "assignee_person_id" in _columns(fresh_schema, "assignment")

    def test_availabilityrequest_recipients_json_column(self, fresh_schema):
        assert "recipients_json" in _columns(fresh_schema, "availabilityrequest")

    def test_existing_assignment_columns_still_present(self, fresh_schema):
        """Regression guard — additive change must not drop existing columns."""
        cols = _columns(fresh_schema, "assignment")
        assert {"id", "course_id", "title", "due_date", "weight_category", "score", "max_score", "event_id"} <= cols


# ── 6. Idempotence ──

class TestMigrationIdempotence:
    def test_run_twice_no_error(self, fresh_schema):
        """Booting the app twice must not raise — every migration step is guarded."""
        run_migrations()
        run_migrations()  # second invocation, post-fixture
        # Sanity: still queryable after re-running
        assert _table_exists(fresh_schema, "project")
        assert "kind" in _columns(fresh_schema, "course")

    def test_run_twice_no_duplicate_columns(self, fresh_schema):
        """ALTER TABLE ADD COLUMN is not idempotent in SQLite by default — the
        PRAGMA-checked guard must prevent a second add."""
        run_migrations()
        cols = _columns(fresh_schema, "course")
        assert sum(1 for c in cols if c == "kind") == 1


# ── 7. Round-trip via SQLModel ──

class TestRoundTrip:
    def test_insert_and_read_project(self, fresh_schema):
        with Session(fresh_schema) as s:
            course = models.Course(name="CS 3500", code="CS3500", color="#6366f1", grade_weights="[]")
            s.add(course)
            s.commit()
            s.refresh(course)
            proj = models.Project(
                course_id=course.id,
                name="Group Project Alpha",
                description="The capstone",
                color="#6366f1",
                created_at="2026-05-08T10:00:00",
            )
            s.add(proj)
            s.commit()
            s.refresh(proj)
            assert proj.id is not None
            assert proj.archived_at is None

            fetched = s.get(models.Project, proj.id)
            assert fetched.name == "Group Project Alpha"
            assert fetched.course_id == course.id

    def test_insert_and_read_person(self, fresh_schema):
        with Session(fresh_schema) as s:
            p = models.Person(name="Sam Kowalski", email="sam@example.com", created_at="2026-05-08T10:00:00")
            s.add(p)
            s.commit()
            s.refresh(p)
            assert p.id is not None
            assert p.is_self is False
            assert p.email == "sam@example.com"

    def test_insert_and_read_projectmember(self, fresh_schema):
        with Session(fresh_schema) as s:
            course = models.Course(name="CS 3500", grade_weights="[]")
            s.add(course); s.commit(); s.refresh(course)
            proj = models.Project(course_id=course.id, name="P", created_at="2026-05-08T10:00:00")
            person = models.Person(name="Sam", created_at="2026-05-08T10:00:00")
            s.add(proj); s.add(person); s.commit(); s.refresh(proj); s.refresh(person)

            pm = models.ProjectMember(
                project_id=proj.id, person_id=person.id, role="lead",
                created_at="2026-05-08T10:00:00",
            )
            s.add(pm)
            s.commit()
            s.refresh(pm)
            assert pm.id is not None
            assert pm.role == "lead"

    def test_assignment_with_project_and_assignee(self, fresh_schema):
        """Existing Assignment writes still work; new fields populate cleanly."""
        with Session(fresh_schema) as s:
            course = models.Course(name="CS 3500", grade_weights="[]")
            s.add(course); s.commit(); s.refresh(course)
            proj = models.Project(course_id=course.id, name="P", created_at="2026-05-08T10:00:00")
            person = models.Person(name="Sam", created_at="2026-05-08T10:00:00")
            s.add(proj); s.add(person); s.commit(); s.refresh(proj); s.refresh(person)

            asg = models.Assignment(
                course_id=course.id, title="Draft section 1", due_date="2026-05-15",
                project_id=proj.id, assignee_person_id=person.id,
            )
            s.add(asg)
            s.commit()
            s.refresh(asg)
            assert asg.project_id == proj.id
            assert asg.assignee_person_id == person.id

    def test_assignment_without_project_still_works(self, fresh_schema):
        """Backwards compatibility: existing personal-only assignments leave new fields NULL."""
        with Session(fresh_schema) as s:
            course = models.Course(name="CS 3500", grade_weights="[]")
            s.add(course); s.commit(); s.refresh(course)
            asg = models.Assignment(course_id=course.id, title="Solo PSet", due_date="2026-05-15")
            s.add(asg)
            s.commit()
            s.refresh(asg)
            assert asg.project_id is None
            assert asg.assignee_person_id is None

    def test_availabilityrequest_recipients_json_roundtrip(self, fresh_schema):
        """Additive column accepts JSON metadata; existing writes still work."""
        with Session(fresh_schema) as s:
            ar = models.AvailabilityRequest(
                token="abc123", sender_name="Allan",
                slots='[{"date":"2026-05-09","start":"10:00","end":"12:00"}]',
                created_at="2026-05-08T10:00:00", expires_at="2026-05-15T10:00:00",
                recipients_json='[{"person_id":1,"name":"Sam","email":"sam@example.com"}]',
            )
            s.add(ar); s.commit(); s.refresh(ar)
            assert ar.recipients_json is not None
            assert "Sam" in ar.recipients_json

    def test_availabilityrequest_without_recipients(self, fresh_schema):
        """Pre-Feature-10 callers leave recipients_json NULL."""
        with Session(fresh_schema) as s:
            ar = models.AvailabilityRequest(
                token="def456", sender_name="Allan", slots="[]",
                created_at="2026-05-08T10:00:00", expires_at="2026-05-15T10:00:00",
            )
            s.add(ar); s.commit(); s.refresh(ar)
            assert ar.recipients_json is None

    def test_course_kind_default(self, fresh_schema):
        """A Course created without an explicit kind defaults to 'course'."""
        with Session(fresh_schema) as s:
            c = models.Course(name="CS 3500", grade_weights="[]")
            s.add(c); s.commit(); s.refresh(c)
            assert c.kind == "course"

    def test_course_kind_independent(self, fresh_schema):
        """The Independent pseudo-course is just a Course with kind='independent'."""
        with Session(fresh_schema) as s:
            c = models.Course(name="Independent", grade_weights="[]", kind="independent")
            s.add(c); s.commit(); s.refresh(c)
            assert c.kind == "independent"


# ── 8. is_self note ──
# Exclusivity (only one Person row may have is_self=True) is enforced at the
# route layer in PR2 — POST /people/{id}/set-self runs in a transaction that
# clears all other rows. The DB schema deliberately allows multiple True rows
# so the route can transition safely. No DB-level test for exclusivity here.
