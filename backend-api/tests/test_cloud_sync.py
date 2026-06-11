"""Engine tests for AWS cloud sync (protocol schema_version 2) against a fake
in-memory server.

Unlike most backend test files this one does NOT import main — it tests
services/cloudsync/engine.py directly, so it needs no module stubbing and is
safe to run alongside others (still run it in isolation per project policy):

    cd backend-api && pytest tests/test_cloud_sync.py -v
"""

import base64
import json

import pytest
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

from database import models
from services.cloudsync.aws_client import VersionConflict
from services.cloudsync.engine import run_sync
from services.crypto import vault

DEK = vault.generate_dek()


class FakeServer:
    """In-memory stand-in for the Lambda — same version/tombstone semantics."""

    def __init__(self):
        self.records = {}
        self._clock = 0

    def _tick(self):
        self._clock += 1
        return self._clock

    # CloudApiClient interface ------------------------------------------------
    def records_since(self, since_ms, limit=200):
        rows = [r for r in self.records.values() if r["last_modified"] > since_ms]
        yield from sorted(rows, key=lambda r: r["last_modified"])

    def get_record(self, record_id):
        return self.records.get(record_id)

    def put_record(self, record_id, *, ciphertext, nonce, record_type,
                   expected_version, device_id):
        current = self.records.get(record_id)
        current_version = current["version"] if current else 0
        if expected_version != current_version:
            raise VersionConflict(record_id, current_version or None)
        rec = {
            "record_id": record_id,
            "record_type": record_type,
            "version": current_version + 1,
            "last_modified": self._tick(),
            "device_id": device_id,
            "tombstone": False,
            "ciphertext": ciphertext,
            "nonce": nonce,
        }
        self.records[record_id] = rec
        return {"record_id": record_id, "version": rec["version"],
                "last_modified": rec["last_modified"]}

    def delete_record(self, record_id):
        current = self.records.get(record_id)
        version = (current["version"] if current else 0) + 1
        self.records[record_id] = {
            "record_id": record_id,
            "record_type": current["record_type"] if current else "event",
            "version": version,
            "last_modified": self._tick(),
            "tombstone": True,
        }
        return {"record_id": record_id, "version": version, "tombstone": True}

    # test helpers --------------------------------------------------------------
    def decrypt(self, record_id):
        rec = self.records[record_id]
        plaintext = vault.decrypt_record(
            base64.b64decode(rec["ciphertext"]), base64.b64decode(rec["nonce"]), DEK
        )
        return json.loads(plaintext)

    def of_type(self, record_type):
        return [r for r in self.records.values() if r["record_type"] == record_type]


def make_clone():
    eng = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(eng)
    return sessionmaker(autocommit=False, autoflush=False, bind=eng)()


def add_calendar(db, name, lm):
    c = models.Calendar(name=name, last_modified=lm)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def add_event(db, title, lm, calendar_id=None, **kw):
    if calendar_id is None:
        # Event.calendar_id is NOT NULL — give each clone a default calendar
        cal = db.query(models.Calendar).filter(models.Calendar.name == "Default").first()
        if cal is None:
            cal = add_calendar(db, "Default", "2026-06-11T00:00:00")
        calendar_id = cal.id
    e = models.Event(
        title=title, start_time="2026-06-12T09:00:00",
        end_time="2026-06-12T10:00:00", last_modified=lm,
        calendar_id=calendar_id, **kw
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


def titles(db):
    return {
        e.title for e in db.query(models.Event).filter(models.Event.deleted_at.is_(None))
    }


@pytest.fixture()
def server():
    return FakeServer()


# --- payload shape -------------------------------------------------------------

def test_payload_has_refs_not_local_ids(server):
    a = make_clone()
    cal = add_calendar(a, "School", "2026-06-11T07:00:00")
    add_event(a, "Standup", "2026-06-11T08:00:00", calendar_id=cal.id)
    run_sync(a, server, DEK, "mac_a")

    (evt_rec,) = server.of_type("event")
    payload = server.decrypt(evt_rec["record_id"])
    assert payload["schema_version"] == 2
    assert "id" not in payload["data"]
    assert "calendar_id" not in payload["data"]
    assert payload["data"]["calendar_id__ref"].startswith("cal_")


def test_second_run_is_clean(server):
    a = make_clone()
    add_event(a, "Standup", "2026-06-11T08:00:00")
    run_sync(a, server, DEK, "mac_a")
    summary = run_sync(a, server, DEK, "mac_a")
    assert summary["push"]["pushed"] == 0
    assert summary["pull"]["updated"] == 0
    assert summary["pull"]["created"] == 0


# --- FK translation across devices ----------------------------------------------

def test_fk_remap_across_different_local_ids(server):
    a, b = make_clone(), make_clone()
    # clone B has pre-existing local rows so incoming ids CANNOT line up
    add_calendar(b, "B-local junk", "2026-06-11T06:00:00")
    add_event(b, "B-local event", "2026-06-11T06:30:00")

    cal_a = add_calendar(a, "School", "2026-06-11T07:00:00")
    evt_a = add_event(a, "Standup", "2026-06-11T08:00:00", calendar_id=cal_a.id)
    task = models.Task(event_id=evt_a.id, note="bring slides",
                       last_modified="2026-06-11T08:10:00")
    a.add(task)
    a.commit()

    run_sync(a, server, DEK, "mac_a")
    run_sync(b, server, DEK, "mac_b")

    cal_b = b.query(models.Calendar).filter(models.Calendar.name == "School").one()
    evt_b = b.query(models.Event).filter(models.Event.title == "Standup").one()
    task_b = b.query(models.Task).filter(models.Task.note == "bring slides").one()

    assert cal_b.id != cal_a.id           # ids diverge by construction...
    assert evt_b.calendar_id == cal_b.id  # ...but refs land on the right rows
    assert task_b.event_id == evt_b.id


def test_both_clones_create_offline_no_collision(server):
    a, b = make_clone(), make_clone()
    add_event(a, "From A", "2026-06-11T08:00:00")   # id 1 in A
    add_event(b, "From B", "2026-06-11T08:30:00")   # id 1 in B
    run_sync(a, server, DEK, "mac_a")
    run_sync(b, server, DEK, "mac_b")
    run_sync(a, server, DEK, "mac_a")

    assert titles(a) == {"From A", "From B"}
    assert titles(b) == {"From A", "From B"}
    assert len(server.of_type("event")) == 2


def test_out_of_order_arrival_defers_and_resolves(server):
    a, b = make_clone(), make_clone()
    cal = add_calendar(a, "School", "2026-06-11T07:00:00")
    add_event(a, "Standup", "2026-06-11T08:00:00", calendar_id=cal.id)
    run_sync(a, server, DEK, "mac_a")

    # force the event to arrive BEFORE the calendar it references
    (cal_rec,) = server.of_type("calendar")
    (evt_rec,) = server.of_type("event")
    cal_rec["last_modified"], evt_rec["last_modified"] = (
        evt_rec["last_modified"], cal_rec["last_modified"]
    )

    summary = run_sync(b, server, DEK, "mac_b")
    assert summary["pull"]["unresolved_refs"] == 0
    evt_b = b.query(models.Event).filter(models.Event.title == "Standup").one()
    cal_b = b.query(models.Calendar).filter(models.Calendar.name == "School").one()
    assert evt_b.calendar_id == cal_b.id


def test_unresolvable_calendar_falls_back(server):
    a, b = make_clone(), make_clone()
    cal = add_calendar(a, "School", "2026-06-11T07:00:00")
    add_event(a, "Standup", "2026-06-11T08:00:00", calendar_id=cal.id)
    run_sync(a, server, DEK, "mac_a")

    # simulate the referenced calendar never reaching clone B
    (cal_rec,) = server.of_type("calendar")
    del server.records[cal_rec["record_id"]]

    summary = run_sync(b, server, DEK, "mac_b")
    assert summary["pull"]["unresolved_refs"] == 1
    # calendar_id is NOT NULL — the event lands on an auto-created fallback
    evt_b = b.query(models.Event).filter(models.Event.title == "Standup").one()
    fallback = b.query(models.Calendar).one()
    assert fallback.name == "Synced"
    assert evt_b.calendar_id == fallback.id


def test_task_with_unknown_event_is_dropped(server):
    a, b = make_clone(), make_clone()
    evt = add_event(a, "Standup", "2026-06-11T08:00:00")
    task = models.Task(event_id=evt.id, note="bring slides",
                       last_modified="2026-06-11T08:10:00")
    a.add(task)
    a.commit()
    run_sync(a, server, DEK, "mac_a")

    # simulate the referenced event never reaching clone B
    (evt_rec,) = server.of_type("event")
    del server.records[evt_rec["record_id"]]

    run_sync(b, server, DEK, "mac_b")
    # task.event_id is NOT NULL and its event is unknown — task is dropped
    assert b.query(models.Task).count() == 0


# --- propagation behaviors -------------------------------------------------------

def test_edit_propagates_back(server):
    a, b = make_clone(), make_clone()
    add_event(a, "Standup", "2026-06-11T08:00:00")
    run_sync(a, server, DEK, "mac_a")
    run_sync(b, server, DEK, "mac_b")

    evt_b = b.query(models.Event).first()
    evt_b.title = "Standup (moved)"
    evt_b.last_modified = "2026-06-11T09:00:00"
    b.commit()
    run_sync(b, server, DEK, "mac_b")
    summary = run_sync(a, server, DEK, "mac_a")
    assert summary["pull"]["updated"] == 1
    assert titles(a) == {"Standup (moved)"}


def test_calendar_rename_propagates(server):
    a, b = make_clone(), make_clone()
    cal = add_calendar(a, "School", "2026-06-11T07:00:00")
    run_sync(a, server, DEK, "mac_a")
    run_sync(b, server, DEK, "mac_b")

    cal.name = "University"
    cal.last_modified = "2026-06-11T09:00:00"
    a.commit()
    run_sync(a, server, DEK, "mac_a")
    run_sync(b, server, DEK, "mac_b")
    assert b.query(models.Calendar).one().name == "University"


def test_delete_tombstones_across_clones(server):
    a, b = make_clone(), make_clone()
    add_event(a, "Standup", "2026-06-11T08:00:00")
    run_sync(a, server, DEK, "mac_a")
    run_sync(b, server, DEK, "mac_b")

    evt_a = a.query(models.Event).first()
    evt_a.deleted_at = "2026-06-11T10:00:00"
    a.commit()
    run_sync(a, server, DEK, "mac_a")
    summary = run_sync(b, server, DEK, "mac_b")
    assert summary["pull"]["deleted"] == 1
    assert titles(b) == set()
    # tombstone push is idempotent
    summary = run_sync(a, server, DEK, "mac_a")
    assert summary["push"]["deleted"] == 0


def test_hard_deleted_calendar_orphan_tombstones(server):
    a, b = make_clone(), make_clone()
    cal = add_calendar(a, "School", "2026-06-11T07:00:00")
    run_sync(a, server, DEK, "mac_a")
    run_sync(b, server, DEK, "mac_b")

    # the calendars router hard-DELETEs — no deleted_at marker left behind
    a.delete(cal)
    a.commit()
    summary = run_sync(a, server, DEK, "mac_a")
    assert summary["push"]["orphan_tombstoned"] == 1

    run_sync(b, server, DEK, "mac_b")
    assert b.query(models.Calendar).one().deleted_at is not None


# --- conflicts --------------------------------------------------------------------

def test_lww_conflict_newest_wins(server):
    a, b = make_clone(), make_clone()
    add_event(a, "Standup", "2026-06-11T08:00:00")
    run_sync(a, server, DEK, "mac_a")
    run_sync(b, server, DEK, "mac_b")

    # both edit offline; B's edit is newer
    evt_a = a.query(models.Event).first()
    evt_a.title = "A's edit"
    evt_a.last_modified = "2026-06-11T09:00:00"
    a.commit()
    evt_b = b.query(models.Event).first()
    evt_b.title = "B's edit"
    evt_b.last_modified = "2026-06-11T09:30:00"
    b.commit()

    run_sync(a, server, DEK, "mac_a")          # A pushes v2
    summary_b = run_sync(b, server, DEK, "mac_b")  # B pulls v2, keeps newer local, pushes v3
    assert summary_b["pull"]["kept_local"] == 1
    run_sync(a, server, DEK, "mac_a")          # A pulls B's v3

    assert titles(a) == {"B's edit"}
    assert titles(b) == {"B's edit"}


def test_lww_conflict_older_local_loses(server):
    a, b = make_clone(), make_clone()
    add_event(a, "Standup", "2026-06-11T08:00:00")
    run_sync(a, server, DEK, "mac_a")
    run_sync(b, server, DEK, "mac_b")

    # A's offline edit is OLDER than B's already-pushed edit
    evt_b = b.query(models.Event).first()
    evt_b.title = "B wins"
    evt_b.last_modified = "2026-06-11T10:00:00"
    b.commit()
    run_sync(b, server, DEK, "mac_b")

    evt_a = a.query(models.Event).first()
    evt_a.title = "A loses"
    evt_a.last_modified = "2026-06-11T09:00:00"
    a.commit()
    run_sync(a, server, DEK, "mac_a")
    assert titles(a) == {"B wins"}


# --- schema version gate -----------------------------------------------------------

def test_unknown_schema_version_is_skipped(server):
    a = make_clone()
    payload = json.dumps(
        {"type": "event", "data": {"title": "old"}, "schema_version": 1}
    ).encode()
    ciphertext, nonce = vault.encrypt_record(payload, DEK)
    server.put_record(
        "evt_legacy", ciphertext=base64.b64encode(ciphertext).decode(),
        nonce=base64.b64encode(nonce).decode(), record_type="event",
        expected_version=0, device_id="mac_old",
    )
    summary = run_sync(a, server, DEK, "mac_a")
    assert summary["pull"]["skipped_schema"] == 1
    assert a.query(models.Event).count() == 0
