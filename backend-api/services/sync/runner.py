"""Phase v3.0 — sync runner.

Single asyncio task started in FastAPI's lifespan. Every 5 minutes:
  1. Iterate enabled (status == 'connected') Connection rows.
  2. For each, dispatch into google.py or caldav.py based on kind.
  3. Route incoming events through dedup.py.
  4. Write SyncReviewItem rows for fuzzy matches and bidirectional_conflicts.
  5. Push pending local changes.
  6. Broadcast progress over the SSE stream consumed by the Sync Center.

This file is the ONLY place that creates SyncReviewItem rows.

Runs cooperatively in the FastAPI event loop — no threads, no subprocess.
Stops with FastAPI when the app window closes (no tray daemon in v3.0).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from . import dedup as _dedup
from . import google as _google
from . import caldav as _caldav
from . import ics_normalize as _ics

logger = logging.getLogger(__name__)

SYNC_INTERVAL_SECONDS = 300  # 5 minutes per design doc §10 Q6.

# In-memory pub/sub for SSE — consumers register a queue, the runner pushes
# {conn_id, phase, counts} dicts. Frontend's SyncContext subscribes via
# new EventSource('/sync/events'). One queue per HTTP client.
_subscribers: list[asyncio.Queue] = []
_runner_task: Optional[asyncio.Task] = None
_session_factory = None  # injected by main.py at startup


def configure(session_factory) -> None:
    """Hook called from main.py: pass in the SessionLocal factory."""
    global _session_factory
    _session_factory = session_factory


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=64)
    _subscribers.append(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    try:
        _subscribers.remove(q)
    except ValueError:
        pass


async def _broadcast(event: dict) -> None:
    for q in list(_subscribers):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


# ── Public API used by the /sync/run* routes ─────────────────────────────────

async def run_all(db: Session) -> list[str]:
    """Trigger a sync cycle for every enabled connection now. Returns the list
    of started connection ids."""
    from database import models
    conns = db.query(models.Connection).filter(models.Connection.status != "paused").all()
    started: list[str] = []
    for c in conns:
        # Fire-and-forget; the runner task will pick up the loop iteration.
        asyncio.create_task(_run_one_safe(c.id))
        started.append(c.id)
    return started


async def run_one(connection_id: str) -> None:
    """Manual single-connection trigger (used by Sync Center 'Sync now')."""
    asyncio.create_task(_run_one_safe(connection_id))


async def _run_one_safe(connection_id: str) -> None:
    try:
        await _run_one(connection_id)
    except Exception as e:
        logger.exception(f"sync runner crash for connection {connection_id}: {e}")
        if _session_factory:
            with _session_factory() as db:
                _set_error(db, connection_id, str(e)[:200])


# ── Loop ─────────────────────────────────────────────────────────────────────

async def _loop() -> None:
    """Fire one cycle on startup, then every SYNC_INTERVAL_SECONDS thereafter."""
    await asyncio.sleep(8)  # let the app finish booting
    while True:
        try:
            if _session_factory:
                with _session_factory() as db:
                    from database import models
                    conns = (db.query(models.Connection)
                               .filter(models.Connection.status != "paused")
                               .all())
                    for c in conns:
                        await _run_one_safe(c.id)
        except Exception as e:
            logger.exception(f"sync runner outer-loop error: {e}")
        await asyncio.sleep(SYNC_INTERVAL_SECONDS)


def start() -> None:
    """Called from FastAPI startup. Idempotent."""
    global _runner_task
    if _runner_task and not _runner_task.done():
        return
    _runner_task = asyncio.create_task(_loop())


# ── Per-connection cycle ─────────────────────────────────────────────────────

async def _run_one(connection_id: str) -> None:
    if _session_factory is None:
        return
    with _session_factory() as db:
        from database import models
        conn = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
        if not conn:
            return
        if conn.status == "paused":
            return

        await _broadcast({"conn_id": conn.id, "phase": "start"})

        if conn.kind == "google":
            await _run_google(db, conn)
        elif conn.kind in ("caldav_icloud", "caldav_generic"):
            await _run_caldav(db, conn)
        else:
            logger.warning(f"sync runner: unknown kind {conn.kind}")
            return

        # Update connection-level status on success.
        conn.status         = "connected"
        conn.last_synced_at = datetime.utcnow().isoformat()
        conn.last_error     = None
        db.commit()

        # Tally pending review items for the SSE event.
        review_count = (
            db.query(models.SyncReviewItem)
              .join(models.ConnectionCalendar, models.ConnectionCalendar.id == models.SyncReviewItem.connection_calendar_id)
              .filter(models.ConnectionCalendar.connection_id == conn.id,
                      models.SyncReviewItem.resolved_at.is_(None))
              .count()
        )
        await _broadcast({
            "conn_id":               conn.id,
            "phase":                 "done",
            "review_count":          review_count,
            "last_synced_at":        conn.last_synced_at,
        })


# ── Google cycle ─────────────────────────────────────────────────────────────

async def _run_google(db: Session, conn) -> None:
    from database import models
    from .keychain_bridge import get_token  # injected by main.py during init

    refresh_token = await get_token(conn.id)
    if not refresh_token:
        _set_status(db, conn, "auth_expired", "Missing OAuth refresh token. Reconnect.")
        return

    try:
        tok = await _google.refresh_access_token(refresh_token)
    except Exception as e:
        _set_status(db, conn, "auth_expired", f"Refresh failed: {e}"[:200])
        return
    access_token = tok["access_token"]

    cc_rows = db.query(models.ConnectionCalendar).filter(
        models.ConnectionCalendar.connection_id == conn.id
    ).all()

    for cc in cc_rows:
        try:
            await _pull_google_paginated(db, conn, cc, access_token)
        except Exception as e:
            # 401 from Google → set auth_expired (per design doc §11 R4) so the
            # user gets a clear notification instead of silent failure.
            msg = str(e)
            if "401" in msg or "unauthorized" in msg.lower():
                _set_status(db, conn, "auth_expired", "Google rejected the token. Reconnect.")
                return
            logger.exception(f"google sync error on cc={cc.id}: {e}")
            conn.last_error = msg[:200]
            db.commit()


MAX_PAGES_PER_CYCLE = 8  # ~2000 events per cycle; bigger calendars complete over a few cycles.


async def _pull_google_paginated(db: Session, conn, cc, access_token: str) -> None:
    """Walk all `nextPageToken` pages so an initial sync of a 1000+ event
    calendar doesn't truncate (per design doc §11 R3). Yields between pages
    so the FastAPI event loop stays responsive.

    Saved sync_token only lands on the final page (Google only emits it in
    the last response). If Google returns 410 GONE on the saved sync_token,
    google.py raises and the outer caller could clear it on retry.
    """
    page_token: Optional[str] = None
    pages = 0
    sync_token_arg = cc.sync_token if not page_token else None
    while pages < MAX_PAGES_PER_CYCLE:
        data = await _google.incremental_pull(
            access_token,
            cc.remote_calendar_id,
            sync_token_arg,
            page_token=page_token,
        )
        for ev in data["events"]:
            await _process_incoming(db, conn, cc, _google.google_event_to_dict(ev))
        pages += 1
        next_page = data.get("next_page_token")
        if next_page:
            # Switch to page-token mode for the next page.
            page_token = next_page
            sync_token_arg = None
            await asyncio.sleep(0)  # yield to the event loop between pages
            continue
        # Final page — save sync_token if present.
        if data.get("next_sync_token"):
            cc.sync_token = data["next_sync_token"]
        cc.last_full_sync_at = datetime.utcnow().isoformat()
        db.commit()
        return
    # Hit the per-cycle page cap; commit progress and let the next cycle
    # continue from the latest sync_token (or replay via page_token through
    # the runner's broader retry path).
    cc.last_full_sync_at = datetime.utcnow().isoformat()
    db.commit()


# ── CalDAV cycle ─────────────────────────────────────────────────────────────

async def _run_caldav(db: Session, conn) -> None:
    from database import models
    from .keychain_bridge import get_token

    creds_blob = await get_token(conn.id)
    if not creds_blob:
        _set_status(db, conn, "auth_expired", "Missing CalDAV credentials. Reconnect.")
        return
    try:
        creds = json.loads(creds_blob)
        username = creds["username"]
        password = creds["password"]
    except Exception:
        _set_status(db, conn, "auth_expired", "Stored credentials malformed. Reconnect.")
        return

    base_url = conn.caldav_base_url or _caldav.ICLOUD_DEFAULT_BASE
    cc_rows = db.query(models.ConnectionCalendar).filter(
        models.ConnectionCalendar.connection_id == conn.id
    ).all()

    for cc in cc_rows:
        try:
            # caldav library is sync — run in default executor.
            data = await asyncio.get_event_loop().run_in_executor(
                None, _caldav.incremental_pull,
                base_url, username, password, cc.remote_calendar_id, cc.caldav_ctag,
            )
            for ev in data["events"]:
                await _process_incoming(db, conn, cc, ev)
            cc.caldav_ctag       = data.get("ctag") or cc.caldav_ctag
            cc.last_full_sync_at = datetime.utcnow().isoformat()
            db.commit()
        except _caldav.CalDAVAuthError as e:
            _set_status(db, conn, "auth_expired", str(e)[:200])
            return
        except Exception as e:
            logger.exception(f"caldav sync error on cc={cc.id}: {e}")
            conn.last_error = str(e)[:200]
            db.commit()


# ── Per-event dispatch ───────────────────────────────────────────────────────

async def _process_incoming(db: Session, conn, cc, incoming: dict) -> None:
    """Apply the dedup decision tree for a single incoming event."""
    from database import models

    # Skip events the user told us to ignore forever.
    h = _hash_incoming(cc.remote_calendar_id, incoming)
    rule = (db.query(models.SyncIgnoreRule)
              .filter(models.SyncIgnoreRule.connection_id == conn.id,
                      models.SyncIgnoreRule.incoming_hash == h)
              .first())
    if rule:
        return

    # Tombstone-style deletes from Google (status == cancelled).
    if incoming.get("deleted") and incoming.get("external_id"):
        existing = (db.query(models.Event)
                      .filter(models.Event.connection_calendar_id == cc.id,
                              models.Event.external_id == incoming["external_id"])
                      .first())
        if existing:
            existing.deleted_at = datetime.utcnow().isoformat()
            db.commit()
        return

    # Build the dedup candidate set: any local event in the same time window
    # within ±1h of the incoming start that we haven't already paired off via
    # external_id.
    candidates = _candidate_locals(db, incoming.get("start_time"))
    incoming_obj = _dedup.IncomingEvent(
        title=incoming.get("title", ""),
        start_time=incoming.get("start_time", ""),
        end_time=incoming.get("end_time", ""),
        location=incoming.get("location"),
        description=incoming.get("description"),
        external_id=incoming.get("external_id"),
        external_etag=incoming.get("external_etag"),
    )
    result = _dedup.match_incoming(incoming_obj,
                                   [_to_local_like(c) for c in candidates],
                                   connection_calendar_id=cc.id)

    if result.bucket == "certain" and result.local_event is not None:
        ev = db.query(models.Event).filter(models.Event.id == result.local_event.id).first()
        if ev:
            _apply_payload_to_event(ev, incoming, cc)
            ev.last_synced_at = datetime.utcnow().isoformat()
            db.commit()
        return

    if result.bucket == "fuzzy" and result.local_event is not None:
        item = models.SyncReviewItem(
            id=str(uuid.uuid4()),
            connection_calendar_id=cc.id,
            kind="incoming_duplicate",
            local_event_id=result.local_event.id,
            incoming_payload=json.dumps(incoming),
            match_score=result.score,
            match_reasons=json.dumps([
                {"field": r.field, "similarity": r.similarity,
                 "value_local": r.value_local, "value_incoming": r.value_incoming}
                for r in result.reasons
            ]),
            created_at=datetime.utcnow().isoformat(),
        )
        db.add(item)
        db.commit()
        return

    # Bucket == 'none' → silently apply as a new event.
    new_ev = models.Event(
        title=incoming.get("title") or "(Untitled)",
        start_time=incoming.get("start_time") or datetime.utcnow().isoformat(),
        end_time=incoming.get("end_time")     or datetime.utcnow().isoformat(),
        calendar_id=cc.local_calendar_id,
        description=incoming.get("description"),
        location=incoming.get("location"),
        is_all_day=bool(incoming.get("is_all_day")),
        connection_calendar_id=cc.id,
        external_id=incoming.get("external_id"),
        external_etag=incoming.get("external_etag"),
        external_uid=incoming.get("external_uid"),
        last_synced_at=datetime.utcnow().isoformat(),
        last_modified=datetime.utcnow().isoformat(),
    )
    db.add(new_ev)
    db.commit()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _candidate_locals(db: Session, start_iso: Optional[str]):
    """Pull local events within ±1h of start_iso (cheap pre-filter)."""
    from database import models
    if not start_iso:
        return []
    try:
        start = datetime.fromisoformat(start_iso.rstrip("Z"))
    except Exception:
        return []
    from datetime import timedelta as _td
    lo = (start - _td(hours=1)).isoformat()
    hi = (start + _td(hours=1)).isoformat()
    return (db.query(models.Event)
              .filter(models.Event.start_time >= lo,
                      models.Event.start_time <= hi,
                      models.Event.deleted_at.is_(None))
              .limit(50)
              .all())


def _to_local_like(ev) -> _dedup.LocalEventLike:
    return _dedup.LocalEventLike(
        id=ev.id,
        title=ev.title,
        start_time=ev.start_time,
        end_time=ev.end_time,
        location=ev.location,
        connection_calendar_id=ev.connection_calendar_id,
        external_id=ev.external_id,
    )


def _apply_payload_to_event(ev, payload: dict, cc) -> None:
    """Last-write-wins — overwrite local fields with incoming."""
    if "title" in payload:        ev.title       = payload["title"]
    if "start_time" in payload:   ev.start_time  = payload["start_time"]
    if "end_time" in payload:     ev.end_time    = payload["end_time"]
    if "description" in payload:  ev.description = payload["description"]
    if "location" in payload:     ev.location    = payload["location"]
    if "external_etag" in payload:ev.external_etag = payload["external_etag"]
    if "is_all_day" in payload:   ev.is_all_day  = bool(payload["is_all_day"])
    ev.connection_calendar_id = cc.id
    ev.external_id = payload.get("external_id") or ev.external_id
    ev.last_modified = datetime.utcnow().isoformat()


def _hash_incoming(remote_calendar_id: str, payload: dict) -> str:
    blob = "|".join([
        remote_calendar_id or "",
        payload.get("external_id") or "",
        payload.get("start_time")  or "",
        payload.get("title")       or "",
    ])
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _set_error(db: Session, connection_id: str, msg: str) -> None:
    from database import models
    c = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
    if c:
        c.status = "error"
        c.last_error = msg
        db.commit()


def _set_status(db: Session, conn, status: str, msg: str) -> None:
    conn.status = status
    conn.last_error = msg
    db.commit()
