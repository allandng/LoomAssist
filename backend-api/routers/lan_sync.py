"""LAN-only multi-device sync routes (Phase 14).

Imports for the cert helpers use module-qualified access
(`_certs._generate_self_signed_cert(...)`) rather than `from X import Y`
followed by direct calls. This keeps `unittest.mock.patch` targeting the
canonical location (`services.lan.certs.*`) effective — patches resolve
at call time via the module attribute, not via a local binding captured
at import time.
"""
import random
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models
from services.lan import certs as _certs
from services.lan.discovery import _discovered_peers
from services.lan.pairing import _pairing_codes

router = APIRouter()


# ── 14a: Pairing ─────────────────────────────────────────────────────────────

@router.post("/pair/start")
def pair_start(db: Session = Depends(get_db)):
    cert_pem, _ = _certs._generate_self_signed_cert()
    fingerprint  = _certs._cert_fingerprint(cert_pem)
    code = f"{random.randint(0, 999999):06d}"
    expires = (datetime.utcnow() + timedelta(minutes=5)).isoformat()
    _pairing_codes[code] = {"fingerprint": fingerprint, "expires": expires}
    return {
        "host": "0.0.0.0",
        "port": 8000,
        "cert_fingerprint": fingerprint,
        "code": code,
        "expires": expires,
    }


class PairCompleteRequest(BaseModel):
    code: str
    peer_name: str
    peer_cert_fingerprint: str


@router.post("/pair/complete", response_model=models.PeerRead)
def pair_complete(req: PairCompleteRequest, db: Session = Depends(get_db)):
    entry = _pairing_codes.get(req.code)
    if not entry:
        raise HTTPException(status_code=400, detail={"error": {"code": "invalid_code"}})
    if datetime.utcnow().isoformat() > entry["expires"]:
        del _pairing_codes[req.code]
        raise HTTPException(status_code=400, detail={"error": {"code": "code_expired"}})
    del _pairing_codes[req.code]
    peer = models.Peer(
        name=req.peer_name,
        cert_fingerprint=req.peer_cert_fingerprint,
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(peer)
    db.commit()
    db.refresh(peer)
    return peer


@router.get("/pair/peers", response_model=list[models.PeerRead])
def list_peers(db: Session = Depends(get_db)):
    return db.query(models.Peer).all()


@router.delete("/pair/peers/{peer_id}")
def delete_peer(peer_id: int, db: Session = Depends(get_db)):
    peer = db.query(models.Peer).filter(models.Peer.id == peer_id).first()
    if not peer:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    db.delete(peer)
    db.commit()
    return {"ok": True}


# ── 14b: mDNS Discovery ───────────────────────────────────────────────────────

@router.get("/discovery/peers")
def get_discovery_peers():
    return {"peers": _discovered_peers}


# ── 14c: Sync Engine ──────────────────────────────────────────────────────────

class SyncExchangeRequest(BaseModel):
    since: str   # ISO datetime — return records modified after this


@router.post("/sync/exchange")
def sync_exchange(req: SyncExchangeRequest, db: Session = Depends(get_db)):
    events = (
        db.query(models.Event)
        .filter(models.Event.last_modified != None, models.Event.last_modified > req.since)  # noqa: E711
        .all()
    )
    task_list = (
        db.query(models.Task)
        .filter(models.Task.last_modified != None, models.Task.last_modified > req.since)  # noqa: E711
        .all()
    )
    return {
        "since": req.since,
        "events": [e.__dict__ for e in events],
        "tasks":  [t.__dict__ for t in task_list],
    }


@router.post("/sync/apply")
def sync_apply(payload: dict, db: Session = Depends(get_db)):
    """Accept inbound sync payload from a peer and apply last-write-wins."""
    applied = 0
    for ev_data in payload.get("events", []):
        ev_data.pop("_sa_instance_state", None)
        ev_id = ev_data.get("id")
        existing = db.query(models.Event).filter(models.Event.id == ev_id).first() if ev_id else None
        if existing:
            remote_ts  = ev_data.get("last_modified", "")
            local_ts   = existing.last_modified or ""
            if remote_ts > local_ts:
                for k, v in ev_data.items():
                    if k != "id" and hasattr(existing, k):
                        setattr(existing, k, v)
                db.commit()
                applied += 1
        else:
            new_ev = models.Event(**{k: v for k, v in ev_data.items() if hasattr(models.Event, k)})
            db.add(new_ev)
            db.commit()
            applied += 1
    for t_data in payload.get("tasks", []):
        t_data.pop("_sa_instance_state", None)
        t_id = t_data.get("id")
        existing = db.query(models.Task).filter(models.Task.id == t_id).first() if t_id else None
        if existing:
            remote_ts = t_data.get("last_modified", "")
            local_ts  = existing.last_modified or ""
            if remote_ts > local_ts:
                for k, v in t_data.items():
                    if k != "id" and hasattr(existing, k):
                        setattr(existing, k, v)
                db.commit()
                applied += 1
        else:
            new_t = models.Task(**{k: v for k, v in t_data.items() if hasattr(models.Task, k)})
            db.add(new_t)
            db.commit()
            applied += 1
    return {"applied": applied}


@router.post("/sync/now/{peer_id}")
async def sync_now(peer_id: int, db: Session = Depends(get_db)):
    """Manually trigger a sync with a specific peer."""
    peer = db.query(models.Peer).filter(models.Peer.id == peer_id).first()
    if not peer:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    last_sync = peer.last_seen or "1970-01-01T00:00:00"
    try:
        async with httpx.AsyncClient(timeout=10) as cli:
            # 1. Pull from peer
            resp = await cli.post(
                f"http://{peer.cert_fingerprint}:8000/sync/exchange",
                json={"since": last_sync},
            )
            if resp.status_code == 200:
                await cli.post("http://localhost:8000/sync/apply", json=resp.json())

        peer.last_seen = datetime.utcnow().isoformat()
        db.commit()
        return {"ok": True, "peer_id": peer_id}
    except Exception as e:
        raise HTTPException(status_code=503, detail={"error": {"code": "sync_failed", "detail": str(e)}})
