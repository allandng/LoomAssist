"""Cloud-sync connection routes — Google + CalDAV provider setup.

Per design doc §3 / §11 / Guardrail §6:
  - Calendar/event data syncs DIRECTLY device ↔ provider; never traverses a
    LoomAssist server.
  - OAuth tokens / CalDAV passwords live in macOS Keychain — never SQLite.
  - external_uid stays ICS-only; sync uses the new external_id column (R7).
  - Disconnect is non-destructive locally AND remotely (Q7).
"""
import asyncio
import json
import uuid
from datetime import datetime
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models
from services.sync import caldav, google, keychain_bridge, runner

router = APIRouter(prefix="/connections")


# ── Pydantic models ──────────────────────────────────────────────────────────

class ConnectionRead(BaseModel):
    id: str
    kind: str
    display_name: str
    account_email: str
    caldav_base_url: Optional[str]
    status: str
    last_synced_at: Optional[str]
    last_error: Optional[str]
    created_at: str


class CalDAVCreateRequest(BaseModel):
    kind: str = "caldav_generic"      # caldav_icloud | caldav_generic
    base_url: str
    username: str
    password: str
    display_name: Optional[str] = None


class CalDAVTestRequest(BaseModel):
    base_url: str
    username: str
    password: str


class GoogleCompleteRequest(BaseModel):
    code: str


class TokenPushRequest(BaseModel):
    """Frontend pushes a token (OAuth refresh_token for Google, JSON for
    CalDAV creds) into the in-memory keychain bridge so the runner can use it
    without making a roundtrip through Tauri. Never persisted server-side."""
    token: str


class RemoteCalendarRead(BaseModel):
    id: str                # remote calendar id (Google) or href (CalDAV)
    display_name: str
    color: Optional[str] = None


class SubscribeRequest(BaseModel):
    remote_calendar_id: str
    remote_display_name: str
    remote_color: Optional[str] = None
    local_calendar_id: Optional[int] = None    # null → create a new timeline
    sync_direction: str = "both"               # both | pull | push


class ConnectionCalendarRead(BaseModel):
    id: str
    connection_id: str
    local_calendar_id: int
    remote_calendar_id: str
    remote_display_name: str
    sync_direction: str
    sync_token: Optional[str]
    caldav_ctag: Optional[str]
    last_full_sync_at: Optional[str]
    created_at: str


class CCPatchRequest(BaseModel):
    sync_direction: Optional[str] = None
    local_calendar_id: Optional[int] = None


class TimelineDecision(BaseModel):
    """Per-timeline strategy on full disconnect."""
    local_calendar_id: int
    strategy: str  # keep | move | delete
    move_target_id: Optional[int] = None


class DisconnectRequest(BaseModel):
    timelines: List[TimelineDecision] = []


# ── Helpers ──────────────────────────────────────────────────────────────────

def _connection_dict(c: models.Connection) -> dict:
    return {
        "id": c.id, "kind": c.kind, "display_name": c.display_name,
        "account_email": c.account_email, "caldav_base_url": c.caldav_base_url,
        "status": c.status, "last_synced_at": c.last_synced_at,
        "last_error": c.last_error, "created_at": c.created_at,
    }


def _cc_dict(cc: models.ConnectionCalendar) -> dict:
    return {
        "id": cc.id, "connection_id": cc.connection_id,
        "local_calendar_id": cc.local_calendar_id,
        "remote_calendar_id": cc.remote_calendar_id,
        "remote_display_name": cc.remote_display_name,
        "sync_direction": cc.sync_direction,
        "sync_token": cc.sync_token, "caldav_ctag": cc.caldav_ctag,
        "last_full_sync_at": cc.last_full_sync_at, "created_at": cc.created_at,
    }


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("", response_model=List[ConnectionRead])
def connections_list(db: Session = Depends(get_db)):
    rows = db.query(models.Connection).order_by(models.Connection.created_at).all()
    return [_connection_dict(c) for c in rows]


@router.post("/google/start")
def connections_google_start():
    if not google.is_configured():
        raise HTTPException(
            status_code=503,
            detail={"error": {"code": "google_not_configured",
                              "detail": "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to enable Google sync."}},
        )
    state = uuid.uuid4().hex
    return {"auth_url": google.build_authorize_url(state)}


@router.post("/google/complete", response_model=ConnectionRead)
async def connections_google_complete(payload: GoogleCompleteRequest, db: Session = Depends(get_db)):
    """Complete the Google OAuth flow with the authorization code. The
    frontend extracts the code from the redirect URL and POSTs it here."""
    if not google.is_configured():
        raise HTTPException(status_code=503, detail={"error": {"code": "google_not_configured"}})
    try:
        tok = await google.exchange_code(payload.code)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=401,
                            detail={"error": {"code": "google_token_exchange_failed", "detail": e.response.text}})
    refresh_token = tok.get("refresh_token")
    access_token  = tok.get("access_token")
    if not refresh_token or not access_token:
        raise HTTPException(status_code=502,
                            detail={"error": {"code": "google_no_refresh_token",
                                              "detail": "Google did not return a refresh_token. Re-consent required."}})

    info = await google.fetch_userinfo(access_token)
    cid = str(uuid.uuid4())
    conn = models.Connection(
        id=cid, kind="google",
        display_name=f"Google — {info.get('email','')}",
        account_email=info.get("email", ""),
        caldav_base_url=None,
        status="connected",
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    keychain_bridge.set_token(cid, refresh_token)
    return _connection_dict(conn)


@router.post("/caldav/test")
def connections_caldav_test(payload: CalDAVTestRequest):
    return caldav.discover_principal(payload.base_url, payload.username, payload.password)


@router.post("/caldav", response_model=ConnectionRead)
def connections_caldav_create(payload: CalDAVCreateRequest, db: Session = Depends(get_db)):
    test = caldav.discover_principal(payload.base_url, payload.username, payload.password)
    if not test.get("ok"):
        raise HTTPException(status_code=401,
                            detail={"error": {"code": "caldav_auth_failed", "detail": test.get("error", "")}})
    cid = str(uuid.uuid4())
    display = payload.display_name or f"{payload.kind.replace('caldav_', '').title()} — {payload.username}"
    conn = models.Connection(
        id=cid, kind=payload.kind,
        display_name=display,
        account_email=payload.username,
        caldav_base_url=payload.base_url,
        status="connected",
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    keychain_bridge.set_token(cid, json.dumps({"username": payload.username, "password": payload.password}))
    return _connection_dict(conn)


@router.post("/{connection_id}/token")
def connections_push_token(connection_id: str, payload: TokenPushRequest, db: Session = Depends(get_db)):
    """Frontend pushes a token from the macOS Keychain into the runner's
    in-memory cache. Used after backend restart so sync resumes without a
    full reconnect."""
    if not db.query(models.Connection).filter(models.Connection.id == connection_id).first():
        raise HTTPException(status_code=404, detail={"error": {"code": "connection_not_found"}})
    keychain_bridge.set_token(connection_id, payload.token)
    return {"ok": True}


@router.get("/{connection_id}/calendars", response_model=List[RemoteCalendarRead])
async def connections_remote_calendars(connection_id: str, db: Session = Depends(get_db)):
    conn = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail={"error": {"code": "connection_not_found"}})

    if conn.kind == "google":
        token_blob = await keychain_bridge.get_token(connection_id)
        if not token_blob:
            raise HTTPException(status_code=401, detail={"error": {"code": "auth_expired"}})
        try:
            tok = await google.refresh_access_token(token_blob)
        except Exception as e:
            raise HTTPException(status_code=401, detail={"error": {"code": "auth_expired", "detail": str(e)[:200]}})
        cals = await google.list_calendars(tok["access_token"])
        return [{
            "id":           c.get("id"),
            "display_name": c.get("summary") or "(Untitled)",
            "color":        c.get("backgroundColor"),
        } for c in cals]

    # CalDAV
    creds_blob = await keychain_bridge.get_token(connection_id)
    if not creds_blob:
        raise HTTPException(status_code=401, detail={"error": {"code": "auth_expired"}})
    try:
        creds = json.loads(creds_blob)
    except Exception:
        raise HTTPException(status_code=401, detail={"error": {"code": "auth_expired"}})
    cols = await asyncio.get_event_loop().run_in_executor(
        None, caldav.list_collections,
        conn.caldav_base_url or caldav.ICLOUD_DEFAULT_BASE,
        creds["username"], creds["password"],
    )
    return [{"id": c["href"], "display_name": c["display_name"], "color": c.get("color")} for c in cols]


@router.post("/{connection_id}/subscribe", response_model=ConnectionCalendarRead)
async def connections_subscribe(connection_id: str, payload: SubscribeRequest, db: Session = Depends(get_db)):
    conn = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail={"error": {"code": "connection_not_found"}})

    # Auto-create the local timeline if not provided.
    local_cal_id = payload.local_calendar_id
    if local_cal_id is None:
        cal = models.Calendar(
            name=payload.remote_display_name,
            color=payload.remote_color or "#6366f1",
            created_via_sync=True,
        )
        db.add(cal)
        db.commit()
        db.refresh(cal)
        local_cal_id = cal.id

    # UNIQUE(connection_id, remote_calendar_id) check (per §10 Q8).
    existing = (db.query(models.ConnectionCalendar)
                  .filter(models.ConnectionCalendar.connection_id == connection_id,
                          models.ConnectionCalendar.remote_calendar_id == payload.remote_calendar_id)
                  .first())
    if existing:
        raise HTTPException(
            status_code=409,
            detail={"error": {"code": "already_subscribed",
                              "detail": f"This calendar is already synced to timeline {existing.local_calendar_id}."}},
        )

    cc = models.ConnectionCalendar(
        id=str(uuid.uuid4()),
        connection_id=connection_id,
        local_calendar_id=local_cal_id,
        remote_calendar_id=payload.remote_calendar_id,
        remote_display_name=payload.remote_display_name,
        sync_direction=payload.sync_direction,
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(cc)
    db.commit()
    db.refresh(cc)

    # Trigger an immediate sync so the user sees events appear.
    # In tests where no event loop is running, just skip the kick-off.
    try:
        asyncio.create_task(runner.run_one(connection_id))
    except RuntimeError:
        pass
    return _cc_dict(cc)


@router.delete("/{connection_id}/calendars/{cc_id}")
def connections_unsubscribe(connection_id: str, cc_id: str, db: Session = Depends(get_db)):
    cc = db.query(models.ConnectionCalendar).filter(
        models.ConnectionCalendar.id == cc_id,
        models.ConnectionCalendar.connection_id == connection_id,
    ).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    # Null-out events bound to this cc — non-destructive locally.
    db.query(models.Event).filter(models.Event.connection_calendar_id == cc_id).update({
        "connection_calendar_id": None,
        "external_id": None,
        "external_etag": None,
        "last_synced_at": None,
    })
    # Drop the join row + any pending review items for it.
    db.query(models.SyncReviewItem).filter(
        models.SyncReviewItem.connection_calendar_id == cc_id
    ).delete()
    db.delete(cc)
    db.commit()
    return {"ok": True}


@router.patch("/{connection_id}/calendars/{cc_id}", response_model=ConnectionCalendarRead)
def connections_cc_patch(connection_id: str, cc_id: str, payload: CCPatchRequest, db: Session = Depends(get_db)):
    cc = db.query(models.ConnectionCalendar).filter(
        models.ConnectionCalendar.id == cc_id,
        models.ConnectionCalendar.connection_id == connection_id,
    ).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    if payload.sync_direction is not None:
        if payload.sync_direction not in ("both", "pull", "push"):
            raise HTTPException(status_code=400, detail={"error": {"code": "bad_direction"}})
        cc.sync_direction = payload.sync_direction
    if payload.local_calendar_id is not None:
        cc.local_calendar_id = payload.local_calendar_id
    db.commit()
    db.refresh(cc)
    return _cc_dict(cc)


@router.post("/{connection_id}/pause", response_model=ConnectionRead)
def connections_pause(connection_id: str, db: Session = Depends(get_db)):
    conn = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail={"error": {"code": "connection_not_found"}})
    conn.status = "paused"
    db.commit()
    db.refresh(conn)
    return _connection_dict(conn)


@router.post("/{connection_id}/resume", response_model=ConnectionRead)
async def connections_resume(connection_id: str, db: Session = Depends(get_db)):
    conn = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail={"error": {"code": "connection_not_found"}})
    conn.status = "connected"
    db.commit()
    db.refresh(conn)
    try:
        asyncio.create_task(runner.run_one(connection_id))
    except RuntimeError:
        pass
    return _connection_dict(conn)


@router.delete("/{connection_id}")
def connections_disconnect(connection_id: str, payload: DisconnectRequest, db: Session = Depends(get_db)):
    """Full disconnect.

    Per design doc §3 + §10 Q7 + §11 R5: non-destructive locally and remotely.
      - Cascade delete ConnectionCalendar + SyncReviewItem rows.
      - Null-out Event.connection_calendar_id et al on every event tied here.
      - Per affected created_via_sync=true timeline, apply the user's
        keep / move / delete decision (default: keep).
      - Clear the keychain bridge entry.
      - Provider events untouched (we don't delete remote events).
    """
    conn = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail={"error": {"code": "connection_not_found"}})

    cc_rows = db.query(models.ConnectionCalendar).filter(
        models.ConnectionCalendar.connection_id == connection_id
    ).all()
    cc_ids = [cc.id for cc in cc_rows]

    # Null-out events.
    if cc_ids:
        db.query(models.Event).filter(models.Event.connection_calendar_id.in_(cc_ids)).update(
            {"connection_calendar_id": None, "external_id": None,
             "external_etag": None, "last_synced_at": None},
            synchronize_session=False,
        )
        db.query(models.SyncReviewItem).filter(
            models.SyncReviewItem.connection_calendar_id.in_(cc_ids)
        ).delete(synchronize_session=False)

    # Apply per-timeline decisions.
    decisions = {d.local_calendar_id: d for d in payload.timelines}
    for cc in cc_rows:
        cal = db.query(models.Calendar).filter(models.Calendar.id == cc.local_calendar_id).first()
        if not cal or not cal.created_via_sync:
            continue
        d = decisions.get(cc.local_calendar_id)
        if d is None or d.strategy == "keep":
            continue
        if d.strategy == "move" and d.move_target_id:
            db.query(models.Event).filter(models.Event.calendar_id == cal.id).update(
                {"calendar_id": d.move_target_id}, synchronize_session=False)
            db.delete(cal)
        elif d.strategy == "delete":
            db.query(models.Event).filter(models.Event.calendar_id == cal.id).delete(synchronize_session=False)
            db.delete(cal)

    # Drop the connection's children + the connection itself.
    for cc in cc_rows:
        db.delete(cc)
    db.query(models.SyncIgnoreRule).filter(
        models.SyncIgnoreRule.connection_id == connection_id
    ).delete(synchronize_session=False)
    db.delete(conn)
    db.commit()

    keychain_bridge.clear_token(connection_id)
    return {"ok": True}
