"""Cloud-sync runner control routes — /sync/run, /sync/status, /sync/events SSE.

Distinct namespace from the existing LAN sync (/sync/exchange, /sync/apply,
/sync/now/{peer_id} — those live in routers/lan_sync.py).
"""
import asyncio
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models
from services.sync import runner

router = APIRouter()


class SyncStatusItem(BaseModel):
    connection_id:         str
    status:                str
    last_synced_at:        Optional[str]
    last_error:            Optional[str]
    pending_review_count:  int


@router.post("/sync/run")
async def sync_run_all(db: Session = Depends(get_db)):
    started = await runner.run_all(db)
    return {"started": started}


@router.post("/sync/run/{connection_id}")
async def sync_run_one(connection_id: str, db: Session = Depends(get_db)):
    if not db.query(models.Connection).filter(models.Connection.id == connection_id).first():
        raise HTTPException(status_code=404, detail={"error": {"code": "connection_not_found"}})
    await runner.run_one(connection_id)
    return {"started": connection_id}


@router.get("/sync/status", response_model=List[SyncStatusItem])
def sync_status(db: Session = Depends(get_db)):
    out: List[dict] = []
    for c in db.query(models.Connection).all():
        review_count = (
            db.query(models.SyncReviewItem)
              .join(models.ConnectionCalendar, models.ConnectionCalendar.id == models.SyncReviewItem.connection_calendar_id)
              .filter(models.ConnectionCalendar.connection_id == c.id,
                      models.SyncReviewItem.resolved_at.is_(None))
              .count()
        )
        out.append({
            "connection_id":         c.id,
            "status":                c.status,
            "last_synced_at":        c.last_synced_at,
            "last_error":            c.last_error,
            "pending_review_count":  review_count,
        })
    return out


@router.get("/sync/events")
async def sync_events_stream():
    """SSE endpoint. Frontend's SyncContext subscribes once on mount; the
    runner pushes {conn_id, phase, ...} events."""
    queue = runner.subscribe()

    async def gen():
        try:
            yield "event: ready\ndata: {}\n\n"
            while True:
                evt = await queue.get()
                yield f"data: {json.dumps(evt)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            runner.unsubscribe(queue)

    return StreamingResponse(gen(), media_type="text/event-stream")
