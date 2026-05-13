from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from core.validation import validate_calendar_exists, validate_event_times
from database import models
from services.ai.reminders import infer_reminder as _infer_reminder
from services.scheduling.find_free import _find_free_slots_internal

router = APIRouter(prefix="/inbox")


class InboxCreateRequest(BaseModel):
    text: str


class InboxProposeResponse(BaseModel):
    proposed_start: Optional[str]
    proposed_duration: Optional[int]
    rationale: str


class InboxScheduleRequest(BaseModel):
    start: str
    end: str
    calendar_id: int


@router.get("", response_model=list[models.InboxItemRead])
def list_inbox(db: Session = Depends(get_db)):
    return (
        db.query(models.InboxItem)
        .filter(models.InboxItem.archived == False)  # noqa: E712
        .order_by(models.InboxItem.id.desc())
        .all()
    )


@router.post("", response_model=models.InboxItemRead)
def create_inbox_item(body: InboxCreateRequest, db: Session = Depends(get_db)):
    item = models.InboxItem(
        text=body.text,
        created_at=datetime.now().isoformat(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.post("/{item_id}/propose", response_model=InboxProposeResponse)
def propose_inbox_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.InboxItem).filter(models.InboxItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    # Use find-free to get candidate slots
    now = datetime.now()
    window_end = now + timedelta(days=7)
    candidates = _find_free_slots_internal(db, now, window_end, 60, 9, 18)

    # Lazy import: keeps LLM model out of app boot path.
    # See services/ai/inbox_propose.py for the lazy-load contract.
    from services.ai.inbox_propose import propose_inbox_slot
    proposal = propose_inbox_slot(item.text, candidates)
    item.proposed_start    = proposal["proposed_start"]
    item.proposed_duration = proposal["proposed_duration"]
    db.commit()
    return InboxProposeResponse(**proposal)


@router.post("/{item_id}/schedule", response_model=models.InboxItemRead)
def schedule_inbox_item(item_id: int, body: InboxScheduleRequest, db: Session = Depends(get_db)):
    item = db.query(models.InboxItem).filter(models.InboxItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    validate_calendar_exists(body.calendar_id, db)
    validate_event_times(body.start, body.end)

    # Infer reminder for the new event
    try:
        inferred = _infer_reminder(item.text, None)
        reminder_minutes = inferred["minutes"]
        reminder_source  = "inferred"
    except Exception:
        reminder_minutes = None
        reminder_source  = "none"

    db_event = models.Event(
        title=item.text,
        start_time=body.start,
        end_time=body.end,
        calendar_id=body.calendar_id,
        reminder_minutes=reminder_minutes,
        reminder_source=reminder_source,
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)

    item.scheduled_event_id = db_event.id
    item.archived = True
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", response_model=models.InboxItemRead)
def delete_inbox_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.InboxItem).filter(models.InboxItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    item.archived = True
    db.commit()
    db.refresh(item)
    return item
