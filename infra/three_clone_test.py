"""Stage 3 exit gate (roadmap §5/§7): desktop ↔ AWS ↔ iOS, three clones.

The desktop phases run here against fresh in-memory SQLite clones (same
mechanics as two_clone_test.py); the iOS phases run the LoomAssist app's
LiveSyncProbe in the simulator. Orchestration:

    set -a; source ../backend-api/.env; set +a
    VENV=../backend-api/venv/bin/python

    # 1. Desktop clone D1 creates an event and pushes it.
    $VENV three_clone_test.py phase1 --title "3clone desktop $(date +%s)"

    # 2. iOS clones A+B pull (must see D1's event), create their own, keep it.
    SIMCTL_CHILD_LOOM_LIVE_SYNC=1 \
    SIMCTL_CHILD_LOOM_EXPECT_TITLE="<phase1 title>" \
    SIMCTL_CHILD_LOOM_KEEP_EVENT=1 \
        xcrun simctl launch --console booted com.loomassist.ios
    # → prints created_title=<iOS title>

    # 3. Desktop clone D2 pulls, must see BOTH events, then tombstones them.
    $VENV three_clone_test.py phase2 --expect "<phase1 title>" --expect "<iOS title>"

    # 4. Fresh iOS clone pulls; neither event may materialize.
    SIMCTL_CHILD_LOOM_LIVE_SYNC=1 \
    SIMCTL_CHILD_LOOM_EXPECT_ABSENT_TITLE="<iOS title>" \
        xcrun simctl launch --console booted com.loomassist.ios
"""

import argparse
import base64
import sys
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


def check(name, cond, detail=""):
    if not cond:
        print(f"  FAIL  {name}  {detail}")
        sys.exit(1)
    print(f"  ok    {name}")


def make_clone():
    eng = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(eng)
    return sessionmaker(autocommit=False, autoflush=False, bind=eng)()


def unlock():
    cog = Cognito(USER_POOL_ID, CLIENT_ID, username=TEST_EMAIL)
    cog.authenticate(password=TEST_PASSWORD)
    client = CloudApiClient(API, lambda: (cog.check_token(), cog.id_token)[1])
    info = client.vault_info()
    check("vault info fetched", info is not None)
    kek = vault.derive_kek(TEST_PASSWORD, base64.b64decode(info["salt"]))
    blob = base64.b64decode(info["wrapped_dek"])
    dek = vault.unwrap_dek(blob[12:], blob[:12], kek)
    return client, dek


def now():
    return datetime.now().isoformat()


def phase1(title: str):
    client, dek = unlock()
    db = make_clone()
    summary = run_sync(db, client, dek, "mac_3clone_d1")
    print(f"  note  D1 first cycle: {summary}")

    cal = (
        db.query(models.Calendar)
        .filter(models.Calendar.deleted_at.is_(None))
        .order_by(models.Calendar.id)
        .first()
    )
    if cal is None:
        cal = models.Calendar(name="3clone timeline", last_modified=now())
        db.add(cal)
        db.flush()
    db.add(models.Event(
        title=title,
        start_time="2026-06-20T09:00:00", end_time="2026-06-20T10:00:00",
        calendar_id=cal.id, last_modified=now(),
    ))
    db.commit()

    summary = run_sync(db, client, dek, "mac_3clone_d1")
    check("D1 pushed its event", summary["push"]["pushed"] >= 1, str(summary))
    print(f"PHASE1_TITLE={title}")


def phase2(expected: list[str]):
    client, dek = unlock()
    db = make_clone()
    summary = run_sync(db, client, dek, "mac_3clone_d2")
    print(f"  note  D2 pull: {summary}")

    live = {
        e.title for e in db.query(models.Event)
        .filter(models.Event.deleted_at.is_(None))
    }
    for title in expected:
        check(f"D2 sees “{title}”", title in live)

    # Cleanup: tombstone the gate's probe events so the vault stays tidy.
    for title in expected:
        row = (
            db.query(models.Event)
            .filter(models.Event.title == title, models.Event.deleted_at.is_(None))
            .first()
        )
        row.deleted_at = now()
        row.last_modified = now()
    db.commit()
    summary = run_sync(db, client, dek, "mac_3clone_d2")
    check("D2 tombstoned both probe events", summary["push"]["deleted"] >= 2, str(summary))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="phase", required=True)
    p1 = sub.add_parser("phase1")
    p1.add_argument("--title", required=True)
    p2 = sub.add_parser("phase2")
    p2.add_argument("--expect", action="append", required=True)
    args = parser.parse_args()

    if args.phase == "phase1":
        phase1(args.title)
    else:
        phase2(args.expect)
    print("THREE_CLONE_PHASE_OK")
