"""LAN sync exchange — payload building, applying, and the peer sync driver.

Two halves:

* Pure DB helpers used by the /sync/exchange and /sync/apply routes AND by
  the driver below, so syncing never has to HTTP-call *ourselves*:
    - build_exchange_payload(db, since)  -> {since, events, tasks}
    - apply_payload(db, payload)         -> number of rows written (LWW)

* The peer driver:
    - peer_base_url(peer)      -> "http://<host>:<port>" for a Peer row, using
                                  the address stored at pairing time or the
                                  one learned over mDNS (matched by fingerprint)
    - sync_with_peer(db, peer) -> bidirectional: PULL the peer's changes since
                                  our last_seen and apply them locally, then
                                  PUSH our changes since last_seen to the
                                  peer's /sync/apply.
    - _auto_sync_loop()        -> every 5 min (after a 30 s startup delay) run
                                  sync_with_peer for every paired peer.
                                  Started by main.py's lifespan.

Extracted from main.py in Stage 1 (substep 1A.5). No LLM dependency.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Optional

import httpx

from database.database import SessionLocal
from database import models
from loom_logger import get_logger
from services.lan.discovery import find_discovered_peer

logger = get_logger("lan.exchange")

DEFAULT_PEER_PORT = 8000
EPOCH = "1970-01-01T00:00:00"


class PeerUnreachable(Exception):
    """Raised when a Peer has no usable network address."""


# ── Payload helpers (no HTTP) ────────────────────────────────────────────────

def _row_dict(row) -> dict:
    """Plain JSON-safe dict for a SQLModel row (drops SQLAlchemy state)."""
    try:
        return row.model_dump()
    except Exception:
        return {k: v for k, v in row.__dict__.items() if k != "_sa_instance_state"}


def build_exchange_payload(db, since: str) -> dict:
    events = (
        db.query(models.Event)
        .filter(models.Event.last_modified != None, models.Event.last_modified > since)  # noqa: E711
        .all()
    )
    task_list = (
        db.query(models.Task)
        .filter(models.Task.last_modified != None, models.Task.last_modified > since)  # noqa: E711
        .all()
    )
    return {
        "since": since,
        "events": [_row_dict(e) for e in events],
        "tasks":  [_row_dict(t) for t in task_list],
    }


def _apply_rows(db, model, rows: list[dict]) -> int:
    applied = 0
    for data in rows:
        data = dict(data)
        data.pop("_sa_instance_state", None)
        row_id = data.get("id")
        existing = db.query(model).filter(model.id == row_id).first() if row_id else None
        if existing:
            remote_ts = data.get("last_modified") or ""
            local_ts  = existing.last_modified or ""
            if remote_ts > local_ts:
                for k, v in data.items():
                    if k != "id" and hasattr(existing, k):
                        setattr(existing, k, v)
                db.commit()
                applied += 1
        else:
            db.add(model(**{k: v for k, v in data.items() if hasattr(model, k)}))
            db.commit()
            applied += 1
    return applied


def apply_payload(db, payload: dict) -> int:
    """Apply an inbound sync payload with last-write-wins. Returns rows written."""
    applied = _apply_rows(db, models.Event, payload.get("events", []) or [])
    applied += _apply_rows(db, models.Task, payload.get("tasks", []) or [])
    return applied


# ── Peer addressing ──────────────────────────────────────────────────────────

def peer_address(peer: models.Peer) -> tuple[Optional[str], int]:
    """(host, port) for a peer: stored address first, then mDNS discovery."""
    host = (peer.host or "").strip() or None
    port = peer.port or None
    if not host:
        found = find_discovered_peer(peer.cert_fingerprint)
        if found:
            host = found.get("host") or None
            port = port or found.get("port") or None
    return host, int(port or DEFAULT_PEER_PORT)


def peer_base_url(peer: models.Peer) -> Optional[str]:
    host, port = peer_address(peer)
    if not host:
        return None
    if ":" in host and not host.startswith("["):  # bare IPv6
        host = f"[{host}]"
    return f"http://{host}:{port}"


# ── Driver ───────────────────────────────────────────────────────────────────

async def sync_with_peer(db, peer: models.Peer, *, timeout: float = 10.0) -> dict:
    """Pull-then-push with one paired peer. Commits `peer.last_seen`.

    Returns {peer_id, peer_url, pulled, pushed}. Raises PeerUnreachable when
    no address is known, httpx errors when the peer can't be reached.
    """
    base = peer_base_url(peer)
    if not base:
        raise PeerUnreachable(f"peer {peer.id} has no host/ip (pair again or wait for mDNS discovery)")

    since = peer.last_seen or EPOCH
    started = datetime.utcnow().isoformat()

    async with httpx.AsyncClient(timeout=timeout) as cli:
        # 1. Pull: what changed on the peer since we last spoke.
        resp = await cli.post(f"{base}/sync/exchange", json={"since": since})
        resp.raise_for_status()
        pulled = apply_payload(db, resp.json())

        # 2. Push: what changed here since we last spoke.
        outbound = build_exchange_payload(db, since)
        pushed = 0
        if outbound["events"] or outbound["tasks"]:
            resp2 = await cli.post(f"{base}/sync/apply", json=outbound)
            resp2.raise_for_status()
            try:
                pushed = int(resp2.json().get("applied", 0))
            except Exception:
                pushed = 0

    peer.last_seen = started
    db.commit()
    return {"peer_id": peer.id, "peer_url": base, "pulled": pulled, "pushed": pushed}


async def sync_all_peers(db) -> list[dict]:
    results: list[dict] = []
    for peer in db.query(models.Peer).all():
        try:
            results.append(await sync_with_peer(db, peer))
        except PeerUnreachable as e:
            logger.debug("auto-sync skipped: %s", e)
        except Exception as e:
            logger.debug("auto-sync with peer %s failed: %s", peer.id, str(e) or type(e).__name__)
    return results


async def _auto_sync_loop():
    await asyncio.sleep(30)  # brief startup delay
    while True:
        try:
            db = SessionLocal()
            try:
                await sync_all_peers(db)
            finally:
                db.close()
        except Exception as e:
            logger.debug("auto-sync loop error: %s", str(e) or type(e).__name__)
        await asyncio.sleep(300)  # 5 minutes
