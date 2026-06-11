"""Engine tests for AWS cloud sync (Stage 2) against a fake in-memory server.

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

    # test helper --------------------------------------------------------------
    def decrypt(self, record_id):
        rec = self.records[record_id]
        plaintext = vault.decrypt_record(
            base64.b64decode(rec["ciphertext"]), base64.b64decode(rec["nonce"]), DEK
        )
        return json.loads(plaintext)


def make_clone():
    eng = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(eng)
    return sessionmaker(autocommit=False, autoflush=False, bind=eng)()


def add_event(db, title, lm, **kw):
    e = models.Event(
        title=title, start_time="2026-06-12T09:00:00",
        end_time="2026-06-12T10:00:00", calendar_id=1, last_modified=lm, **kw
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


def test_push_new_event_encrypts(server):
    a = make_clone()
    add_event(a, "Standup", "2026-06-11T08:00:00")
    summary = run_sync(a, server, DEK, "mac_a")
    assert summary["push"]["pushed"] == 1
    (record_id,) = server.records.keys()
    payload = server.decrypt(record_id)
    assert payload["type"] == "event"
    assert payload["data"]["title"] == "Standup"
    assert payload["schema_version"] == 1


def test_second_run_is_clean(server):
    a = make_clone()
    add_event(a, "Standup", "2026-06-11T08:00:00")
    run_sync(a, server, DEK, "mac_a")
    summary = run_sync(a, server, DEK, "mac_a")
    assert summary["push"]["pushed"] == 0
    assert summary["pull"]["updated"] == 0
    assert summary["pull"]["created"] == 0


def test_two_clone_propagation(server):
    a, b = make_clone(), make_clone()
    add_event(a, "Standup", "2026-06-11T08:00:00")
    run_sync(a, server, DEK, "mac_a")
    summary = run_sync(b, server, DEK, "mac_b")
    assert summary["pull"]["created"] == 1
    assert titles(b) == {"Standup"}
    # local PK preserved so FKs hold across devices
    assert b.query(models.Event).first().id == a.query(models.Event).first().id


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
    assert server.decrypt(next(iter(server.records)))["data"]["title"] == "B's edit"


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


def test_id_collision_remaps(server):
    a, b = make_clone(), make_clone()
    add_event(a, "From A", "2026-06-11T08:00:00")   # id 1 in A
    add_event(b, "From B", "2026-06-11T08:30:00")   # id 1 in B
    run_sync(a, server, DEK, "mac_a")
    run_sync(b, server, DEK, "mac_b")  # pulls A's; id 1 taken -> remap
    run_sync(a, server, DEK, "mac_a")  # pulls B's; id 1 taken -> remap

    assert titles(a) == {"From A", "From B"}
    assert titles(b) == {"From A", "From B"}
    assert len(server.records) == 2


def test_tasks_sync_too(server):
    a, b = make_clone(), make_clone()
    t = models.Task(event_id=1, note="bring slides", last_modified="2026-06-11T08:00:00")
    a.add(t)
    a.commit()
    run_sync(a, server, DEK, "mac_a")
    run_sync(b, server, DEK, "mac_b")
    assert b.query(models.Task).first().note == "bring slides"
