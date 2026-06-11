"""Cloud sync engine — encrypt-push / pull-decrypt-apply against the AWS API.

Conflict policy is whole-record last-write-wins by the row's `last_modified`
(same semantics as LAN sync, roadmap §4). Optimistic concurrency on the server
(version + 409) keeps two simultaneous writers from silently clobbering;
the loser refetches and LWW decides.

Local primary keys ride inside the encrypted payload so FK references
(task.event_id, event.calendar_id) stay valid across the same user's devices.
If a pull hits an id already taken by a *different* record (both devices
created rows offline before first sync), the incoming row is inserted under a
fresh id — FKs to remapped rows are a known v0 limitation, flagged for the
post-Stage-2 reassessment.
"""

import base64
import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from database import models
from services.crypto import vault
from services.cloudsync.aws_client import CloudApiClient, VersionConflict

SCHEMA_VERSION = 1

SYNCED_TYPES = {
    "event": (models.Event, "evt"),
    "task": (models.Task, "tsk"),
}

_b64 = lambda b: base64.b64encode(b).decode()
_unb64 = base64.b64decode


def _now_iso() -> str:
    return datetime.now().isoformat()


def _serialize(record_type: str, row) -> bytes:
    data = {c.name: getattr(row, c.name) for c in row.__table__.columns}
    return json.dumps(
        {"type": record_type, "data": data, "schema_version": SCHEMA_VERSION}
    ).encode()


def _encrypt(record_type: str, row, dek: bytes) -> tuple[str, str]:
    ciphertext, nonce = vault.encrypt_record(_serialize(record_type, row), dek)
    return _b64(ciphertext), _b64(nonce)


def _decrypt(record: dict, dek: bytes) -> dict:
    plaintext = vault.decrypt_record(
        _unb64(record["ciphertext"]), _unb64(record["nonce"]), dek
    )
    return json.loads(plaintext)


def _lm(value) -> str:
    """Sortable last-modified key; missing timestamps lose every LWW race."""
    return value or ""


def _get_state(db: Session, record_id: str):
    return (
        db.query(models.CloudSyncState)
        .filter(models.CloudSyncState.record_id == record_id)
        .first()
    )


def _get_state_for_row(db: Session, record_type: str, local_id: int):
    return (
        db.query(models.CloudSyncState)
        .filter(
            models.CloudSyncState.record_type == record_type,
            models.CloudSyncState.local_id == local_id,
        )
        .first()
    )


def _apply_payload(row, data: dict):
    for col in row.__table__.columns:
        if col.name == "id":
            continue
        if col.name in data:
            setattr(row, col.name, data[col.name])


# --- pull ---------------------------------------------------------------------

def _pull(db: Session, client: CloudApiClient, dek: bytes, config) -> dict:
    counts = {"created": 0, "updated": 0, "deleted": 0, "kept_local": 0, "skipped": 0}
    max_seen = config.pull_cursor

    for record in client.records_since(config.pull_cursor):
        max_seen = max(max_seen, int(record["last_modified"]))
        record_type = record.get("record_type")
        if record_type not in SYNCED_TYPES:
            counts["skipped"] += 1
            continue
        model, _prefix = SYNCED_TYPES[record_type]
        state = _get_state(db, record["record_id"])
        version = int(record["version"])

        # Our own write echoing back, or anything we've already processed.
        if state and version <= state.server_version:
            counts["skipped"] += 1
            continue

        if record.get("tombstone"):
            if state:
                row = db.get(model, state.local_id)
                if row is not None and row.deleted_at is None:
                    row.deleted_at = _now_iso()
                    counts["deleted"] += 1
                state.server_version = version
                state.deleted = True
            else:
                counts["skipped"] += 1  # delete of a record we never had
            continue

        data = _decrypt(record, dek)["data"]

        if state is None:
            row = model(**{k: v for k, v in data.items() if k != "id"})
            wanted_id = data.get("id")
            if wanted_id is not None and db.get(model, wanted_id) is None:
                row.id = wanted_id  # preserve PK so FKs hold across devices
            db.add(row)
            db.flush()  # assigns id (fresh one on collision)
            db.add(models.CloudSyncState(
                record_type=record_type,
                local_id=row.id,
                record_id=record["record_id"],
                server_version=version,
                synced_local_modified=row.last_modified,
            ))
            # Sessions run with autoflush=False — flush so the push phase's
            # state queries see this row and don't re-push it as a new record.
            db.flush()
            counts["created"] += 1
        else:
            row = db.get(model, state.local_id)
            if row is None:
                state.server_version = version
                counts["skipped"] += 1
                continue
            local_dirty = row.last_modified != state.synced_local_modified
            if local_dirty and _lm(row.last_modified) > _lm(data.get("last_modified")):
                # Local unpushed edit is newer — keep it; bumping
                # server_version lets the push phase win the version check.
                state.server_version = version
                counts["kept_local"] += 1
            else:
                _apply_payload(row, data)
                state.server_version = version
                state.synced_local_modified = row.last_modified
                state.deleted = False
                counts["updated"] += 1

    config.pull_cursor = max_seen
    return counts


# --- push ---------------------------------------------------------------------

def _push_row(db: Session, client: CloudApiClient, dek: bytes, device_id: str,
              record_type: str, prefix: str, row, state) -> str:
    """Returns 'pushed' | 'deleted' | 'conflict_lost'."""
    if row.deleted_at is not None:
        if state is None or state.deleted:
            return ""  # never synced, or tombstone already on server
        result = client.delete_record(state.record_id)
        state.server_version = int(result["version"])
        state.deleted = True
        state.synced_local_modified = row.last_modified
        return "deleted"

    if state is None:
        state = models.CloudSyncState(
            record_type=record_type,
            local_id=row.id,
            record_id=f"{prefix}_{uuid.uuid4().hex}",
            server_version=0,
        )
        db.add(state)
        db.flush()  # autoflush is off — make the new state queryable
    elif row.last_modified == state.synced_local_modified and not state.deleted:
        return ""  # clean — nothing to push

    ciphertext, nonce = _encrypt(record_type, row, dek)
    try:
        result = client.put_record(
            state.record_id, ciphertext=ciphertext, nonce=nonce,
            record_type=record_type, expected_version=state.server_version,
            device_id=device_id,
        )
    except VersionConflict as vc:
        current = client.get_record(state.record_id)
        if current and not current.get("tombstone"):
            data = _decrypt(current, dek)["data"]
            if _lm(data.get("last_modified")) >= _lm(row.last_modified):
                # Server is newer — take it (LWW), stop pushing ours.
                _apply_payload(row, data)
                state.server_version = int(current["version"])
                state.synced_local_modified = row.last_modified
                return "conflict_lost"
        # Ours is newer (or server tombstoned a record we just edited):
        # retry once at the current version.
        result = client.put_record(
            state.record_id, ciphertext=ciphertext, nonce=nonce,
            record_type=record_type,
            expected_version=vc.current_version or 0,
            device_id=device_id,
        )
    state.server_version = int(result["version"])
    state.synced_local_modified = row.last_modified
    state.deleted = False
    return "pushed"


def _push(db: Session, client: CloudApiClient, dek: bytes, device_id: str) -> dict:
    counts = {"pushed": 0, "deleted": 0, "conflict_lost": 0}
    for record_type, (model, prefix) in SYNCED_TYPES.items():
        for row in db.query(model).all():
            state = _get_state_for_row(db, record_type, row.id)
            outcome = _push_row(
                db, client, dek, device_id, record_type, prefix, row, state
            )
            if outcome:
                counts[outcome] += 1
    return counts


# --- entry point ----------------------------------------------------------------

def run_sync(db: Session, client: CloudApiClient, dek: bytes, device_id: str) -> dict:
    """One full cycle: pull (LWW apply) then push. Commits on success."""
    config = db.get(models.CloudSyncConfig, "me")
    if config is None:
        config = models.CloudSyncConfig(id="me")
        db.add(config)
        db.flush()

    pulled = _pull(db, client, dek, config)
    pushed = _push(db, client, dek, device_id)
    config.last_synced_at = _now_iso()
    db.commit()

    summary = {"pull": pulled, "push": pushed, "cursor": config.pull_cursor}
    logging.info(f"Cloud sync cycle: {summary}")
    return summary
