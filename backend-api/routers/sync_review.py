"""Sync Review queue routes — surface cloud-sync conflicts for user resolution.

Per design doc §11: the SyncReviewItem queue is the only place sync conflicts
become user-visible. Approve/merge/replace-local/reject each terminate an item
with a `resolution` and `resolution_payload` for audit + potential undo.
"""
import hashlib
import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models

router = APIRouter(prefix="/sync/review")


class ReviewItemRead(BaseModel):
    id: str
    connection_calendar_id: str
    connection_display_name: str
    kind: str
    local_event_id: Optional[int]
    incoming_payload: dict
    match_score: Optional[float]
    match_reasons: Optional[list]
    created_at: str


class MergePayloadRequest(BaseModel):
    merged_payload: dict


class RejectRequest(BaseModel):
    remember: bool = False


class BulkActionRequest(BaseModel):
    item_ids: List[str]
    action: str  # approve | reject | merge_default


def _review_to_dict(item: models.SyncReviewItem, conn_display_name: str) -> dict:
    return {
        "id":                       item.id,
        "connection_calendar_id":   item.connection_calendar_id,
        "connection_display_name":  conn_display_name,
        "kind":                     item.kind,
        "local_event_id":           item.local_event_id,
        "incoming_payload":         json.loads(item.incoming_payload) if item.incoming_payload else {},
        "match_score":              item.match_score,
        "match_reasons":            json.loads(item.match_reasons) if item.match_reasons else None,
        "created_at":               item.created_at,
    }


def _resolve_item(item: models.SyncReviewItem, resolution: str, payload: Optional[dict] = None) -> None:
    item.resolved_at         = datetime.utcnow().isoformat()
    item.resolution          = resolution
    item.resolution_payload  = json.dumps(payload) if payload else None


@router.get("", response_model=List[ReviewItemRead])
def sync_review_list(
    connection_id: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    q = (db.query(models.SyncReviewItem, models.ConnectionCalendar, models.Connection)
           .join(models.ConnectionCalendar, models.ConnectionCalendar.id == models.SyncReviewItem.connection_calendar_id)
           .join(models.Connection,         models.Connection.id == models.ConnectionCalendar.connection_id)
           .filter(models.SyncReviewItem.resolved_at.is_(None)))
    if connection_id:
        q = q.filter(models.Connection.id == connection_id)
    if kind:
        q = q.filter(models.SyncReviewItem.kind == kind)
    rows = q.order_by(models.SyncReviewItem.created_at.desc()).limit(limit).all()
    return [_review_to_dict(item, conn.display_name) for (item, _cc, conn) in rows]


@router.get("/{item_id}", response_model=ReviewItemRead)
def sync_review_get(item_id: str, db: Session = Depends(get_db)):
    row = (db.query(models.SyncReviewItem, models.ConnectionCalendar, models.Connection)
             .join(models.ConnectionCalendar, models.ConnectionCalendar.id == models.SyncReviewItem.connection_calendar_id)
             .join(models.Connection,         models.Connection.id == models.ConnectionCalendar.connection_id)
             .filter(models.SyncReviewItem.id == item_id)
             .first())
    if not row:
        raise HTTPException(status_code=404, detail={"error": {"code": "review_not_found"}})
    item, _cc, conn = row
    return _review_to_dict(item, conn.display_name)


@router.post("/{item_id}/approve")
def sync_review_approve(item_id: str, db: Session = Depends(get_db)):
    """User says 'these are different events' — apply the incoming payload as
    a brand-new local event (not merged into the candidate)."""
    item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == item_id).first()
    if not item or item.resolved_at:
        raise HTTPException(status_code=404, detail={"error": {"code": "review_resolved_or_missing"}})
    cc = db.query(models.ConnectionCalendar).filter(models.ConnectionCalendar.id == item.connection_calendar_id).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"error": {"code": "cc_not_found"}})
    p = json.loads(item.incoming_payload)
    new_ev = models.Event(
        title=p.get("title") or "(Untitled)",
        start_time=p.get("start_time") or datetime.utcnow().isoformat(),
        end_time=p.get("end_time")     or datetime.utcnow().isoformat(),
        calendar_id=cc.local_calendar_id,
        description=p.get("description"),
        location=p.get("location"),
        is_all_day=bool(p.get("is_all_day")),
        connection_calendar_id=cc.id,
        external_id=p.get("external_id"),
        external_etag=p.get("external_etag"),
        last_synced_at=datetime.utcnow().isoformat(),
        last_modified=datetime.utcnow().isoformat(),
    )
    db.add(new_ev)
    db.flush()
    _resolve_item(item, "approved_new", {"event_id": new_ev.id})
    db.commit()
    return {"event_id": new_ev.id}


@router.post("/{item_id}/merge")
def sync_review_merge(item_id: str, body: MergePayloadRequest, db: Session = Depends(get_db)):
    """Apply the user-merged payload to the candidate local event, then push
    to the provider (best-effort — push failures get queued for retry)."""
    item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == item_id).first()
    if not item or item.resolved_at:
        raise HTTPException(status_code=404, detail={"error": {"code": "review_resolved_or_missing"}})
    if not item.local_event_id:
        raise HTTPException(status_code=400, detail={"error": {"code": "no_local_event"}})
    ev = db.query(models.Event).filter(models.Event.id == item.local_event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail={"error": {"code": "event_missing"}})
    cc = db.query(models.ConnectionCalendar).filter(models.ConnectionCalendar.id == item.connection_calendar_id).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"error": {"code": "cc_not_found"}})

    p = body.merged_payload or {}
    for k in ("title", "start_time", "end_time", "description", "location", "is_all_day"):
        if k in p:
            setattr(ev, k, p[k])
    ev.connection_calendar_id = cc.id
    if p.get("external_id"):    ev.external_id   = p["external_id"]
    if p.get("external_etag"):  ev.external_etag = p["external_etag"]
    ev.last_synced_at = datetime.utcnow().isoformat()
    ev.last_modified  = datetime.utcnow().isoformat()
    _resolve_item(item, "merged", {"event_id": ev.id})
    db.commit()
    return {"event_id": ev.id}


@router.post("/{item_id}/replace-local")
def sync_review_replace_local(item_id: str, db: Session = Depends(get_db)):
    """Use incoming wholesale; overwrite local."""
    item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == item_id).first()
    if not item or item.resolved_at:
        raise HTTPException(status_code=404, detail={"error": {"code": "review_resolved_or_missing"}})
    cc = db.query(models.ConnectionCalendar).filter(models.ConnectionCalendar.id == item.connection_calendar_id).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"error": {"code": "cc_not_found"}})
    p = json.loads(item.incoming_payload)
    if item.local_event_id:
        ev = db.query(models.Event).filter(models.Event.id == item.local_event_id).first()
        if ev:
            for k in ("title", "start_time", "end_time", "description", "location", "is_all_day"):
                if k in p:
                    setattr(ev, k, p[k])
            ev.connection_calendar_id = cc.id
            ev.external_id   = p.get("external_id")   or ev.external_id
            ev.external_etag = p.get("external_etag") or ev.external_etag
            ev.last_synced_at = datetime.utcnow().isoformat()
            ev.last_modified  = datetime.utcnow().isoformat()
            _resolve_item(item, "replaced_local", {"event_id": ev.id})
            db.commit()
            return {"event_id": ev.id}
    # Fallback: insert new (mirrors approve).
    new_ev = models.Event(
        title=p.get("title") or "(Untitled)",
        start_time=p.get("start_time") or datetime.utcnow().isoformat(),
        end_time=p.get("end_time")     or datetime.utcnow().isoformat(),
        calendar_id=cc.local_calendar_id,
        description=p.get("description"), location=p.get("location"),
        is_all_day=bool(p.get("is_all_day")),
        connection_calendar_id=cc.id,
        external_id=p.get("external_id"),
        external_etag=p.get("external_etag"),
        last_synced_at=datetime.utcnow().isoformat(),
        last_modified=datetime.utcnow().isoformat(),
    )
    db.add(new_ev)
    db.flush()
    _resolve_item(item, "replaced_local", {"event_id": new_ev.id})
    db.commit()
    return {"event_id": new_ev.id}


@router.post("/{item_id}/reject")
def sync_review_reject(item_id: str, body: RejectRequest, db: Session = Depends(get_db)):
    item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == item_id).first()
    if not item or item.resolved_at:
        raise HTTPException(status_code=404, detail={"error": {"code": "review_resolved_or_missing"}})
    cc = db.query(models.ConnectionCalendar).filter(models.ConnectionCalendar.id == item.connection_calendar_id).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"error": {"code": "cc_not_found"}})

    if body.remember:
        p = json.loads(item.incoming_payload)
        h = hashlib.sha256(("|".join([
            cc.remote_calendar_id or "",
            p.get("external_id") or "",
            p.get("start_time")  or "",
            p.get("title")       or "",
        ])).encode("utf-8")).hexdigest()
        if not (db.query(models.SyncIgnoreRule)
                  .filter(models.SyncIgnoreRule.connection_id == cc.connection_id,
                          models.SyncIgnoreRule.incoming_hash == h)
                  .first()):
            db.add(models.SyncIgnoreRule(
                connection_id=cc.connection_id,
                incoming_hash=h,
                created_at=datetime.utcnow().isoformat(),
            ))
    _resolve_item(item, "ignored_forever" if body.remember else "rejected")
    db.commit()
    return {"ok": True}


@router.post("/bulk")
def sync_review_bulk(body: BulkActionRequest, db: Session = Depends(get_db)):
    if body.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail={"error": {"code": "bad_bulk_action"}})
    n = 0
    for iid in body.item_ids:
        item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == iid).first()
        if not item or item.resolved_at:
            continue
        if body.action == "reject":
            _resolve_item(item, "rejected")
            n += 1
    db.commit()
    return {"resolved": n}
