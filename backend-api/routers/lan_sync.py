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

from typing import Optional

from core.deps import get_db
from database import models
from services.lan import certs as _certs
from services.lan import exchange as _exchange
from services.lan.discovery import _discovered_peers, find_discovered_peer, get_lan_ip
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
    # Advertise the address the *other* device should connect to. Falls back
    # to the historical 0.0.0.0 placeholder when we're offline.
    return {
        "host": get_lan_ip() or "0.0.0.0",
        "port": 8000,
        "cert_fingerprint": fingerprint,
        "code": code,
        "expires": expires,
    }


class PairCompleteRequest(BaseModel):
    code: str
    peer_name: str
    peer_cert_fingerprint: str
    # Optional network address of the peer's backend. When omitted we fall
    # back to whatever mDNS has discovered for that fingerprint.
    peer_host: Optional[str] = None
    peer_port: Optional[int] = None


@router.post("/pair/complete", response_model=models.PeerRead)
def pair_complete(req: PairCompleteRequest, db: Session = Depends(get_db)):
    entry = _pairing_codes.get(req.code)
    if not entry:
        raise HTTPException(status_code=400, detail={"error": {"code": "invalid_code"}})
    if datetime.utcnow().isoformat() > entry["expires"]:
        del _pairing_codes[req.code]
        raise HTTPException(status_code=400, detail={"error": {"code": "code_expired"}})
    del _pairing_codes[req.code]

    host = (req.peer_host or "").strip() or None
    port = req.peer_port
    if not host:
        found = find_discovered_peer(req.peer_cert_fingerprint)
        if found:
            host = found.get("host") or None
            port = port or found.get("port")

    peer = models.Peer(
        name=req.peer_name,
        cert_fingerprint=req.peer_cert_fingerprint,
        created_at=datetime.utcnow().isoformat(),
        host=host,
        port=port,
    )
    db.add(peer)
    db.commit()
    db.refresh(peer)
    return peer


class PeerAddressPatch(BaseModel):
    host: Optional[str] = None
    port: Optional[int] = None


@router.patch("/pair/peers/{peer_id}", response_model=models.PeerRead)
def patch_peer(peer_id: int, body: PeerAddressPatch, db: Session = Depends(get_db)):
    """Set / correct a paired peer's network address (e.g. after its DHCP
    lease changed and mDNS isn't available)."""
    peer = db.query(models.Peer).filter(models.Peer.id == peer_id).first()
    if not peer:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    if body.host is not None:
        peer.host = body.host.strip() or None
    if body.port is not None:
        if not (0 < body.port < 65536):
            raise HTTPException(status_code=400, detail={"error": {"code": "bad_port"}})
        peer.port = body.port
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
    """Return every event/task modified after `since` (a peer calls this to PULL)."""
    return _exchange.build_exchange_payload(db, req.since)


@router.post("/sync/apply")
def sync_apply(payload: dict, db: Session = Depends(get_db)):
    """Accept inbound sync payload from a peer and apply last-write-wins."""
    return {"applied": _exchange.apply_payload(db, payload)}


@router.post("/sync/now/{peer_id}")
async def sync_now(peer_id: int, db: Session = Depends(get_db)):
    """Manually trigger a bidirectional sync (pull, then push) with a peer.

    Targets the peer's stored host/port (or its mDNS address); the cert
    fingerprint is only an identity. Response:
    {ok, peer_id, peer_url, pulled, pushed}.
    """
    peer = db.query(models.Peer).filter(models.Peer.id == peer_id).first()
    if not peer:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    try:
        result = await _exchange.sync_with_peer(db, peer)
    except _exchange.PeerUnreachable as e:
        raise HTTPException(status_code=503, detail={"error": {"code": "peer_address_unknown", "detail": str(e)}})
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail={"error": {"code": "sync_failed", "detail": str(e) or type(e).__name__}})
    except Exception as e:
        raise HTTPException(status_code=503, detail={"error": {"code": "sync_failed", "detail": str(e)}})
    return {"ok": True, **result}
