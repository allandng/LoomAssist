from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models

router = APIRouter(prefix="/calendars")


@router.post("/", response_model=models.CalendarRead)
def create_calendar(calendar: models.CalendarBase, db: Session = Depends(get_db)):
    db_calendar = models.Calendar.model_validate(calendar)
    db_calendar.last_modified = datetime.now().isoformat()
    db.add(db_calendar)
    db.commit()
    db.refresh(db_calendar)
    return db_calendar


@router.get("/", response_model=list[models.CalendarRead])
def read_calendars(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return (
        db.query(models.Calendar)
        .filter(models.Calendar.deleted_at.is_(None))
        .offset(skip).limit(limit).all()
    )


@router.put("/{calendar_id}", response_model=models.CalendarRead)
def update_calendar(calendar_id: int, calendar_update: models.CalendarBase, db: Session = Depends(get_db)):
    db_calendar = db.query(models.Calendar).filter(models.Calendar.id == calendar_id).first()
    if not db_calendar:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "not_found", "detail": "Calendar not found"}}
        )

    # Sync metadata is engine-owned — don't let a stale client payload
    # null it out or resurrect a tombstone.
    updates = calendar_update.model_dump(exclude={"last_modified", "deleted_at"})
    for key, value in updates.items():
        setattr(db_calendar, key, value)
    db_calendar.last_modified = datetime.now().isoformat()

    db.commit()
    db.refresh(db_calendar)
    return db_calendar


@router.delete("/{calendar_id}")
def delete_calendar(calendar_id: int, db: Session = Depends(get_db)):
    db_calendar = db.query(models.Calendar).filter(models.Calendar.id == calendar_id).first()
    if not db_calendar:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "not_found", "detail": "Calendar not found"}}
        )

    db.query(models.Event).filter(models.Event.calendar_id == calendar_id).delete()
    db.delete(db_calendar)
    db.commit()
    return {"status": "success", "message": f"Calendar {calendar_id} deleted."}
