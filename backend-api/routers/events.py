"""Event CRUD + state-mutation routes.

Covers all /events/* routes: list/read/create/update/delete, conflict
pre-check, recurring-event skip-date toggles, the missed-events listing
(Feature 7), the clock-in/out PATCH route (duration analytics), and the
Phase 10 cross-event dependency cascade.

The embedding writeback on create/update/delete is best-effort —
`try_upsert_event_embedding` swallows its own errors so an embedder
import or model-load failure never blocks the event write.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from core.deps import get_db
from core.validation import validate_event_times, validate_calendar_exists, _detect_circular
from database import models
from loom_logger import get_logger
from services.ai.reminders import infer_reminder
from services.scheduling.conflicts import get_conflicts

router = APIRouter(prefix="/events")
logger = get_logger("main")


class ConflictCheckRequest(BaseModel):
    start_time: str
    end_time: str
    calendar_id: int
    exclude_event_id: int | None = None


# H4: Pydantic model for skip-date request body
class SkipDateRequest(BaseModel):
    date: str


# ------------------------------------------
# MISSED EVENTS
# ------------------------------------------
# Users explicitly opt-in mark a past event as missed via the EventEditorModal
# footer; the mark is the nullable Event.missed_at ISO timestamp. Marking is
# done via the normal full-payload PUT /events/{id} — no dedicated PATCH route,
# because the editor already round-trips every field on save and the
# auto-clear-on-save rule (a regular Save clears missed_at) means missed_at
# was already on the wire either way.

class MissedEventsResponse(BaseModel):
    items: list[models.EventRead]
    truncated: bool


class ClockPayload(BaseModel):
    action: str  # "in" | "out"


class CascadeDependentsResponse(BaseModel):
    updated: list[dict]


@router.post("/check-conflicts")
def check_conflicts(payload: ConflictCheckRequest, db: Session = Depends(get_db)):
    conflicts = get_conflicts(
        payload.start_time, payload.end_time,
        payload.calendar_id, payload.exclude_event_id, db,
    )
    return {"conflicts": [{"id": c.id, "title": c.title, "conflict_type": ct} for c, ct in conflicts]}


@router.post("/")
def create_event(event: models.EventBase, db: Session = Depends(get_db)):
    validate_calendar_exists(event.calendar_id, db)
    validate_event_times(event.start_time, event.end_time)

    if event.reminder_minutes is None:
        try:
            inferred = infer_reminder(event.title, event.description)
            event.reminder_minutes = inferred["minutes"]
            event.reminder_source = "inferred"
        except Exception as e:
            logger.warning(f"Reminder inference failed, skipping: {e}")
            event.reminder_source = "none"
    else:
        event.reminder_source = "user"

    # Phase 10: guard circular dependency
    if event.depends_on_event_id is not None:
        dep_ev = db.query(models.Event).filter(models.Event.id == event.depends_on_event_id).first()
        if dep_ev and dep_ev.is_recurring:
            raise HTTPException(status_code=400, detail={"error": {"code": "recurring_parent", "detail": "Recurring events cannot be dependency parents."}})

    db_event = models.Event.model_validate(event)
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    # Lazy import: keeps sentence-transformers out of app boot path.
    # See services/ai/embedder.py for the lazy-load contract.
    from services.ai.embedder import try_upsert_event_embedding
    try_upsert_event_embedding(db_event.id, db_event.title, db_event.description, db)
    conflicts = get_conflicts(db_event.start_time, db_event.end_time, db_event.calendar_id, db_event.id, db)
    return {
        "event": db_event,
        "conflicts": [{"id": c.id, "title": c.title, "conflict_type": ct} for c, ct in conflicts],
    }


@router.get("/", response_model=list[models.EventRead])
def read_events(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(models.Event).offset(skip).limit(limit).all()


@router.get("/missed", response_model=MissedEventsResponse)
def list_missed_events(db: Session = Depends(get_db)):
    """Return events the user has marked as missed.

    Filter:
      - missed_at IS NOT NULL          opt-in marker present
      - deleted_at IS NULL             not tombstoned
      - connection_calendar_id IS NULL local-only (synced rescheduling would
                                       push a unilateral move to the provider —
                                       out of scope for v1)
      - NOT is_recurring               editor cannot move a single occurrence
                                       (the only instanceDate-aware path is
                                       Skip this date) — recurring is a separate
                                       follow-up feature
      - NOT is_all_day                 no clock-in semantics; find-free returns
                                       hour-precision slots

    Legacy rows pre-dating those boolean columns store NULL. SQL three-valued
    logic makes `NULL != True` evaluate to NULL (so such rows would be silently
    excluded by `!= True`). We OR with `IS NULL` to include them explicitly.

    Sorted by start_time ascending. Capped at 20; `truncated` flag tells the
    frontend to render an "and N more" footnote.
    """
    rows = (
        db.query(models.Event)
        .filter(models.Event.missed_at.isnot(None))
        .filter(models.Event.deleted_at.is_(None))
        .filter(models.Event.connection_calendar_id.is_(None))
        .filter(or_(models.Event.is_recurring == False, models.Event.is_recurring.is_(None)))  # noqa: E712
        .filter(or_(models.Event.is_all_day   == False, models.Event.is_all_day.is_(None)))    # noqa: E712
        .order_by(models.Event.start_time.asc())
        .limit(21)
        .all()
    )
    truncated = len(rows) > 20
    return {"items": rows[:20], "truncated": truncated}


@router.put("/{event_id}")
def update_event(event_id: int, event: models.EventBase, db: Session = Depends(get_db)):
    db_event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not db_event:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "not_found", "detail": "Event not found"}}
        )

    validate_event_times(event.start_time, event.end_time)

    if event.reminder_minutes is None and event.reminder_source != "user":
        try:
            inferred = infer_reminder(event.title, event.description)
            event.reminder_minutes = inferred["minutes"]
            event.reminder_source = "inferred"
        except Exception as e:
            logger.warning(f"Reminder inference failed on update, skipping: {e}")
            event.reminder_source = "none"
    elif event.reminder_minutes is not None and event.reminder_source not in ("user", "inferred"):
        event.reminder_source = "user"

    for key, value in event.model_dump().items():
        setattr(db_event, key, value)

    # Phase 10: guard circular dependency and recurring parent
    new_dep_id = event.depends_on_event_id
    if new_dep_id is not None:
        dep_ev = db.query(models.Event).filter(models.Event.id == new_dep_id).first()
        if dep_ev and dep_ev.is_recurring:
            raise HTTPException(status_code=400, detail={"error": {"code": "recurring_parent", "detail": "Recurring events cannot be dependency parents."}})
        if _detect_circular(event_id, new_dep_id, db):
            raise HTTPException(status_code=400, detail={"error": {"code": "circular_dependency", "detail": "This would create a circular dependency."}})

    db.commit()
    db.refresh(db_event)
    # Lazy import: keeps sentence-transformers out of app boot path.
    # See services/ai/embedder.py for the lazy-load contract.
    from services.ai.embedder import try_upsert_event_embedding
    try_upsert_event_embedding(db_event.id, db_event.title, db_event.description, db)
    conflicts = get_conflicts(db_event.start_time, db_event.end_time, db_event.calendar_id, db_event.id, db)

    # Return any dependents so frontend can offer cascade
    dependents = db.query(models.Event).filter(
        models.Event.depends_on_event_id == event_id
    ).all()

    return {
        "event": db_event,
        "conflicts": [{"id": c.id, "title": c.title, "conflict_type": ct} for c, ct in conflicts],
        "dependents": [{"id": d.id, "title": d.title, "start_time": d.start_time, "end_time": d.end_time} for d in dependents],
    }


@router.delete("/{event_id}")
def delete_event(event_id: int, db: Session = Depends(get_db)):
    db_event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not db_event:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "not_found", "detail": "Event not found"}}
        )

    event_id_to_delete = db_event.id
    # Phase 10: nullify depends_on for children — never cascade-delete
    db.query(models.Event).filter(
        models.Event.depends_on_event_id == event_id_to_delete
    ).update({"depends_on_event_id": None}, synchronize_session=False)
    db.delete(db_event)
    db.commit()
    try:
        from services.ai.embedder import delete_event_embedding
        delete_event_embedding(event_id_to_delete, db)
    except Exception:
        pass
    return {"status": "success", "message": "Event deleted"}


@router.post("/{event_id}/skip-date")
def skip_event_date(event_id: int, body: SkipDateRequest, db: Session = Depends(get_db)):
    """Append a YYYY-MM-DD date to skipped_dates for a recurring event."""
    db_event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not db_event:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "not_found", "detail": "Event not found"}}
        )
    existing = db_event.skipped_dates or ""
    dates = [d for d in existing.split(",") if d]
    if body.date not in dates:
        dates.append(body.date)
    db_event.skipped_dates = ",".join(dates)
    db.commit()
    db.refresh(db_event)
    return {"status": "success", "skipped_dates": db_event.skipped_dates}


@router.delete("/{event_id}/skip-date")
def unskip_event_date(event_id: int, body: SkipDateRequest, db: Session = Depends(get_db)):
    """Remove a previously skipped date from a recurring event."""
    db_event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not db_event:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "not_found", "detail": "Event not found"}}
        )
    existing = db_event.skipped_dates or ""
    dates = [d for d in existing.split(",") if d and d != body.date]
    db_event.skipped_dates = ",".join(dates) if dates else None
    db.commit()
    db.refresh(db_event)
    return {"status": "success", "skipped_dates": db_event.skipped_dates}


@router.patch("/{event_id}/clock")
def clock_event(event_id: int, payload: ClockPayload, db: Session = Depends(get_db)):
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "event_not_found", "detail": f"Event {event_id} does not exist."}})
    if payload.action == "in":
        event.actual_start = datetime.now().isoformat()
    elif payload.action == "out":
        event.actual_end = datetime.now().isoformat()
    else:
        raise HTTPException(status_code=400,
            detail={"error": {"code": "invalid_action", "detail": "action must be 'in' or 'out'"}})
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.post("/{event_id}/cascade-dependents", response_model=CascadeDependentsResponse)
def cascade_dependents(event_id: int, db: Session = Depends(get_db)):
    """Apply depends_offset_minutes to all direct dependents of this event."""
    parent = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    children = db.query(models.Event).filter(
        models.Event.depends_on_event_id == event_id
    ).all()

    updated = []
    for child in children:
        if child.depends_offset_minutes is None:
            continue
        try:
            parent_end = datetime.fromisoformat(parent.end_time)
        except ValueError:
            continue
        offset  = timedelta(minutes=child.depends_offset_minutes)
        dur_td  = timedelta(seconds=max(0, (
            datetime.fromisoformat(child.end_time) - datetime.fromisoformat(child.start_time)
        ).total_seconds()))
        new_start = parent_end + offset
        new_end   = new_start + dur_td
        child.start_time = new_start.isoformat()
        child.end_time   = new_end.isoformat()
        updated.append(child.model_dump())

    db.commit()
    return CascadeDependentsResponse(updated=updated)
