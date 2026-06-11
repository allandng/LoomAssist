"""Stage 2 exit gate (roadmap §6), protocol schema_version 2: a Mac syncing to
itself across two clones via the AWS server.

Two fresh local SQLite databases ("clone A" / "clone B") run the real sync
engine against the real deployed API with real Cognito SRP auth and real
vault crypto. Clone B is pre-seeded with junk rows so local autoincrement ids
CANNOT line up — proving the record_id-based FK translation, not id luck.

Run from infra/ with backend venv + AWS env loaded:
    set -a; source ../backend-api/.env; set +a
    ../backend-api/venv/bin/python two_clone_test.py
"""

import base64
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend-api"))

from pycognito import Cognito
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

from database import models
from services.cloudsync.aws_client import CloudApiClient
from services.cloudsync.engine import run_sync
from services.crypto import vault

API = "https://03ouv0xgzb.execute-api.us-east-1.amazonaws.com"
USER_POOL_ID = "us-east-1_aZaXEizfw"
CLIENT_ID = "582l8iu4gp700j37p166eihjqb"
TEST_EMAIL = "allanthedab+loomsync-smoke@gmail.com"
TEST_PASSWORD = "smoke-test-passw0rd-2026"

passed = 0

def check(name, cond, detail=""):
    global passed
    if not cond:
        print(f"  FAIL  {name}  {detail}")
        sys.exit(1)
    passed += 1
    print(f"  ok    {name}")


def make_clone():
    eng = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(eng)
    return sessionmaker(autocommit=False, autoflush=False, bind=eng)()


def now():
    return datetime.now().isoformat()


def live_titles(db, marker):
    return {
        e.title
        for e in db.query(models.Event)
        .filter(models.Event.deleted_at.is_(None), models.Event.title.contains(marker))
    }


# --- auth + vault unlock (same flow as POST /cloud/unlock) --------------------
cog = Cognito(USER_POOL_ID, CLIENT_ID, username=TEST_EMAIL)
cog.authenticate(password=TEST_PASSWORD)
client = CloudApiClient(API, lambda: (cog.check_token(), cog.id_token)[1])

info = client.vault_info()
check("vault info fetched", info is not None)
kek = vault.derive_kek(TEST_PASSWORD, base64.b64decode(info["salt"]))
blob = base64.b64decode(info["wrapped_dek"])
dek = vault.unwrap_dek(blob[12:], blob[:12], kek)
check("DEK unwrapped from live vault", len(dek) == 32)

# --- the two clones ------------------------------------------------------------
a, b = make_clone(), make_clone()
marker = f"2clone-{int(time.time())}"  # unique per run; user has leftover records

# clone B gets junk local rows so autoincrement ids diverge from A's
junk_cal = models.Calendar(name="B junk cal", last_modified=now())
b.add(junk_cal)
b.flush()
b.add(models.Event(title="B junk evt", start_time="2026-01-01T09:00:00",
                   end_time="2026-01-01T10:00:00", calendar_id=junk_cal.id,
                   last_modified=now()))
b.commit()

# 1. calendar + event + task created on A -> appear on B with remapped FKs
cal_a = models.Calendar(name=f"{marker} School", last_modified=now())
a.add(cal_a)
a.flush()
evt_a = models.Event(
    title=f"{marker} standup", start_time="2026-06-12T09:00:00",
    end_time="2026-06-12T10:00:00", calendar_id=cal_a.id, last_modified=now(),
)
a.add(evt_a)
a.flush()
a.add(models.Task(event_id=evt_a.id, note=f"{marker} bring slides",
                  last_modified=now()))
a.commit()

run_sync(a, client, dek, "mac_cloneA")
run_sync(b, client, dek, "mac_cloneB")

cal_b = b.query(models.Calendar).filter(
    models.Calendar.name == f"{marker} School").first()
evt_b = b.query(models.Event).filter(
    models.Event.title == f"{marker} standup").first()
task_b = b.query(models.Task).filter(
    models.Task.note == f"{marker} bring slides").first()
check("calendar propagates A -> B", cal_b is not None)
check("event propagates A -> B", evt_b is not None)
check("task propagates A -> B", task_b is not None)
check("local ids diverged (real remap, not luck)", cal_b.id != cal_a.id)
check("event.calendar_id remapped to B's local id", evt_b.calendar_id == cal_b.id)
check("task.event_id remapped to B's local id", task_b.event_id == evt_b.id)

# 2. edit on B -> appears on A
evt_b.title = f"{marker} standup (moved)"
evt_b.last_modified = now()
b.commit()
run_sync(b, client, dek, "mac_cloneB")
run_sync(a, client, dek, "mac_cloneA")
check("edit propagates B -> A", live_titles(a, marker) == {f"{marker} standup (moved)"})

# 3. conflicting offline edits -> LWW converges both clones
evt_a = a.query(models.Event).filter(models.Event.title.contains(marker)).first()
evt_a.title = f"{marker} older edit"
evt_a.last_modified = now()
a.commit()
time.sleep(0.05)
evt_b.title = f"{marker} newer edit"
evt_b.last_modified = now()
b.commit()
run_sync(a, client, dek, "mac_cloneA")   # A pushes its (older) edit
run_sync(b, client, dek, "mac_cloneB")   # B pulls, keeps newer local, pushes
run_sync(a, client, dek, "mac_cloneA")   # A pulls B's winner
check("conflict converges to newest (A)", live_titles(a, marker) == {f"{marker} newer edit"})
check("conflict converges to newest (B)", live_titles(b, marker) == {f"{marker} newer edit"})

# 4. hard-delete the calendar on A (router semantics) -> tombstones on B
evt_a = a.query(models.Event).filter(models.Event.title.contains(marker)).first()
a.delete(evt_a)
cal_a_row = a.query(models.Calendar).filter(
    models.Calendar.name == f"{marker} School").first()
a.delete(cal_a_row)
a.commit()
summary = run_sync(a, client, dek, "mac_cloneA")
check("hard deletes push orphan tombstones",
      summary["push"]["orphan_tombstoned"] == 2, str(summary["push"]))
run_sync(b, client, dek, "mac_cloneB")
check("delete propagates A -> B", live_titles(b, marker) == set())
cal_b = b.query(models.Calendar).filter(
    models.Calendar.name == f"{marker} School").first()
check("calendar tombstoned on B", cal_b.deleted_at is not None)

# cleanup: tombstone the test task so reruns stay tidy
task_a = a.query(models.Task).filter(models.Task.note.contains(marker)).first()
if task_a is not None:
    task_a.deleted_at = now()
    a.commit()
    run_sync(a, client, dek, "mac_cloneA")

print(f"\nAll {passed} two-clone checks passed against {API}")
print("Protocol v2 exit gate: FK remap, calendar sync, LWW, tombstones — all live.")
