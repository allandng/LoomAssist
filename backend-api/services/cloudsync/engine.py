"""Cloud sync engine — encrypt-push / pull-decrypt-apply against the AWS API.

Conflict policy is whole-record last-write-wins by the row's `last_modified`
(same semantics as LAN sync, roadmap §4). Optimistic concurrency on the server
(version + 409) keeps two simultaneous writers from silently clobbering;
the loser refetches and LWW decides.

Protocol schema_version 2 (hardened pre-Stage 3 so the Swift client copies a
stable dialect):
- Payloads carry NO local primary keys. Cross-record references travel as
  `<column>__ref` keys holding the target's record_id (e.g. a task payload has
  `event_id__ref: "evt_ab12…"`), translated to/from local ids at the edges.
  Devices keep independent autoincrement ids; nothing collides.
- `calendar` is a synced type. SYNCED_TYPES insertion order is the push order:
  referenced types push before referrers so refs always resolve server-side.
- Pulls that reference a not-yet-seen record defer and retry within the run;
  refs that still can't resolve apply as NULL and are counted.
- States whose local row was hard-deleted (e.g. calendars) push a tombstone.
- Records with a different schema_version are skipped, not guessed at.
"""

import base64
import json
import logging
import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from database import models
from services.crypto import vault
from services.cloudsync.aws_client import CloudApiClient, VersionConflict

SCHEMA_VERSION = 2

# Insertion order = push order: referenced types before referrers.
SYNCED_TYPES = {
    "calendar": (models.Calendar, "cal"),
    "event": (models.Event, "evt"),
    "task": (models.Task, "tsk"),
}

# Local FK columns that must travel as record_id references.
FK_REFS = {
    "event": {"calendar_id": "calendar", "depends_on_event_id": "event"},
    "task": {"event_id": "event"},
}

_b64 = lambda b: base64.b64encode(b).decode()
_unb64 = base64.b64decode


class _UnresolvedRef(Exception):
    """A __ref points at a record_id we don't know yet — defer this record."""


def _now_iso() -> str:
    return datetime.now().isoformat()


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


# --- serialization -------------------------------------------------------------

def _serialize(db: Session, record_type: str, row) -> bytes:
    data = {
        c.name: getattr(row, c.name) for c in row.__table__.columns if c.name != "id"
    }
    for col, ref_type in FK_REFS.get(record_type, {}).items():
        local_id = data.pop(col, None)
        ref = None
        if local_id is not None:
            target_state = _get_state_for_row(db, ref_type, local_id)
            ref = target_state.record_id if target_state else None  # dangling FK -> None
        data[f"{col}__ref"] = ref
    return json.dumps(
        {"type": record_type, "data": data, "schema_version": SCHEMA_VERSION}
    ).encode()


def _encrypt(db: Session, record_type: str, row, dek: bytes) -> tuple[str, str]:
    ciphertext, nonce = vault.encrypt_record(_serialize(db, record_type, row), dek)
    return _b64(ciphertext), _b64(nonce)


def _decrypt(record: dict, dek: bytes) -> dict:
    plaintext = vault.decrypt_record(
        _unb64(record["ciphertext"]), _unb64(record["nonce"]), dek
    )
    return json.loads(plaintext)


def _resolve_refs(db: Session, data: dict, *, force: bool) -> tuple[dict, list]:
    """Map __ref keys to local ids. Returns (resolved {col: local_id|None},
    unresolved [col,...]). Raises _UnresolvedRef unless force."""
    resolved, unresolved = {}, []
    for key, value in data.items():
        if not key.endswith("__ref"):
            continue
        col = key[: -len("__ref")]
        if value is None:
            resolved[col] = None
            continue
        target_state = _get_state(db, value)
        if target_state is None:
            if not force:
                raise _UnresolvedRef(value)
            resolved[col] = None
            unresolved.append(col)
        else:
            resolved[col] = target_state.local_id
    return resolved, unresolved


def _set_columns(row, data: dict, resolved: dict):
    for col in row.__table__.columns:
        if col.name == "id" or col.name not in data:
            continue
        setattr(row, col.name, data[col.name])
    for col, local_id in resolved.items():
        setattr(row, col, local_id)


def _apply_payload(db: Session, row, data: dict, *, force_refs: bool):
    """Update path: set plain columns, resolve refs. Unresolvable refs under
    force keep the row's current value rather than nulling a live FK."""
    resolved, unresolved = _resolve_refs(db, data, force=force_refs)
    for col in unresolved:
        resolved.pop(col, None)
    _set_columns(row, data, resolved)


def _fallback_calendar_id(db: Session) -> int:
    """Event.calendar_id is NOT NULL — events whose calendar can't be resolved
    land on the first live calendar, or a 'Synced' one we create (which then
    syncs out like any other row)."""
    cal = (
        db.query(models.Calendar)
        .filter(models.Calendar.deleted_at.is_(None))
        .order_by(models.Calendar.id)
        .first()
    )
    if cal is None:
        cal = models.Calendar(name="Synced", last_modified=_now_iso())
        db.add(cal)
        db.flush()
    return cal.id


# --- pull ---------------------------------------------------------------------

def _apply_one(db: Session, record: dict, dek: bytes, counts: dict, *,
               force_refs: bool) -> bool:
    """Apply one pulled record. Returns False if deferred on an unresolved ref."""
    record_type = record.get("record_type")
    if record_type not in SYNCED_TYPES:
        counts["skipped"] += 1
        return True
    model, _prefix = SYNCED_TYPES[record_type]
    state = _get_state(db, record["record_id"])
    version = int(record["version"])

    # Our own write echoing back, or anything we've already processed.
    if state and version <= state.server_version:
        counts["skipped"] += 1
        return True

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
        return True

    envelope = _decrypt(record, dek)
    if envelope.get("schema_version") != SCHEMA_VERSION:
        logging.warning(
            f"Cloud sync: skipping {record['record_id']} with "
            f"schema_version={envelope.get('schema_version')}"
        )
        counts["skipped_schema"] += 1
        return True
    data = envelope["data"]

    if state is None:
        try:
            resolved, unresolved = _resolve_refs(db, data, force=force_refs)
        except _UnresolvedRef:
            return False
        # NOT NULL FK integrity on create:
        if record_type == "task" and resolved.get("event_id") is None:
            # a task without its event is meaningless — drop it
            counts["skipped"] += 1
            return True
        if record_type == "event" and resolved.get("calendar_id") is None:
            resolved["calendar_id"] = _fallback_calendar_id(db)
        plain = {
            k: v for k, v in data.items()
            if k != "id" and not k.endswith("__ref")
        }
        row = model(**plain)
        _set_columns(row, data, resolved)
        db.add(row)
        db.flush()  # autoflush is off — assign id, make state queryable
        db.add(models.CloudSyncState(
            record_type=record_type,
            local_id=row.id,
            record_id=record["record_id"],
            server_version=version,
            synced_local_modified=row.last_modified,
        ))
        db.flush()
        counts["created"] += 1
    else:
        row = db.get(model, state.local_id)
        if row is None:
            state.server_version = version
            counts["skipped"] += 1
            return True
        local_dirty = row.last_modified != state.synced_local_modified
        if local_dirty and _lm(row.last_modified) > _lm(data.get("last_modified")):
            # Local unpushed edit is newer — keep it; bumping
            # server_version lets the push phase win the version check.
            state.server_version = version
            counts["kept_local"] += 1
        else:
            try:
                _apply_payload(db, row, data, force_refs=force_refs)
            except _UnresolvedRef:
                return False
            state.server_version = version
            state.synced_local_modified = row.last_modified
            state.deleted = False
            counts["updated"] += 1
    return True


def _pull(db: Session, client: CloudApiClient, dek: bytes, config) -> dict:
    counts = {"created": 0, "updated": 0, "deleted": 0, "kept_local": 0,
              "skipped": 0, "skipped_schema": 0, "unresolved_refs": 0}
    max_seen = config.pull_cursor

    deferred = []
    for record in client.records_since(config.pull_cursor):
        max_seen = max(max_seen, int(record["last_modified"]))
        if not _apply_one(db, record, dek, counts, force_refs=False):
            deferred.append(record)

    # Referenced records may have arrived later in the same pull — retry until
    # a full pass makes no progress, then force the stragglers with NULL refs.
    while deferred:
        still = [r for r in deferred
                 if not _apply_one(db, r, dek, counts, force_refs=False)]
        if len(still) == len(deferred):
            for record in still:
                _apply_one(db, record, dek, counts, force_refs=True)
                counts["unresolved_refs"] += 1
                logging.warning(
                    f"Cloud sync: {record['record_id']} applied with NULL ref(s) "
                    "— referenced record unknown to this device"
                )
            break
        deferred = still

    config.pull_cursor = max_seen
    return counts


# --- push ---------------------------------------------------------------------

def _push_row(db: Session, client: CloudApiClient, dek: bytes, device_id: str,
              record_type: str, row, state) -> str:
    """Returns 'pushed' | 'deleted' | 'conflict_lost' | ''."""
    if row.deleted_at is not None:
        if state is None or state.deleted:
            return ""  # never synced, or tombstone already on server
        result = client.delete_record(state.record_id)
        state.server_version = int(result["version"])
        state.deleted = True
        state.synced_local_modified = row.last_modified
        return "deleted"

    if row.last_modified == state.synced_local_modified and not state.deleted:
        return ""  # clean — nothing to push

    ciphertext, nonce = _encrypt(db, record_type, row, dek)
    try:
        result = client.put_record(
            state.record_id, ciphertext=ciphertext, nonce=nonce,
            record_type=record_type, expected_version=state.server_version,
            device_id=device_id,
        )
    except VersionConflict as vc:
        current = client.get_record(state.record_id)
        if current and not current.get("tombstone"):
            envelope = _decrypt(current, dek)
            data = envelope.get("data", {})
            if (envelope.get("schema_version") == SCHEMA_VERSION
                    and _lm(data.get("last_modified")) >= _lm(row.last_modified)):
                # Server is newer — take it (LWW), stop pushing ours.
                _apply_payload(db, row, data, force_refs=True)
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
    counts = {"pushed": 0, "deleted": 0, "conflict_lost": 0, "orphan_tombstoned": 0}

    # Pass 0: assign record_ids to every live unsynced row first, so __ref
    # serialization resolves regardless of within-type ordering (e.g. an event
    # depending on an event created later).
    for record_type, (model, prefix) in SYNCED_TYPES.items():
        for row in db.query(model).all():
            if row.deleted_at is None and _get_state_for_row(db, record_type, row.id) is None:
                db.add(models.CloudSyncState(
                    record_type=record_type,
                    local_id=row.id,
                    record_id=f"{prefix}_{uuid.uuid4().hex}",
                    server_version=0,
                ))
    db.flush()  # autoflush is off — make pass-0 states queryable

    # Pass 1: push dirty rows in dependency order (dict order).
    for record_type, (model, _prefix) in SYNCED_TYPES.items():
        for row in db.query(model).all():
            state = _get_state_for_row(db, record_type, row.id)
            if state is None:
                continue  # deleted_at row that was never synced
            outcome = _push_row(db, client, dek, device_id, record_type, row, state)
            if outcome:
                counts[outcome] += 1

    # Pass 2: states whose local row was hard-deleted (calendar deletes, manual
    # DB surgery) — tombstone server-side so other devices learn.
    for state in (
        db.query(models.CloudSyncState)
        .filter(models.CloudSyncState.deleted == False)  # noqa: E712
        .all()
    ):
        entry = SYNCED_TYPES.get(state.record_type)
        if entry is None:
            continue
        model, _ = entry
        if db.get(model, state.local_id) is None:
            result = client.delete_record(state.record_id)
            state.server_version = int(result["version"])
            state.deleted = True
            counts["orphan_tombstoned"] += 1

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
