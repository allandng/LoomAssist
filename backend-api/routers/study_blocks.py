from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models

router = APIRouter(prefix="/study")


class StudyBlockRequest(BaseModel):
    subject: str
    deadline_date: str           # ISO date YYYY-MM-DD
    calendar_id: int
    num_sessions: int = 5
    session_duration_minutes: int = 90
    preferred_hour: int = 18
    skip_weekends: bool = True
    assignment_id: Optional[int] = None  # Procrastination Radar — links blocks back to Assignment


class StudyBlockPreview(BaseModel):
    title: str
    start_time: str
    end_time: str
    description: str
    calendar_id: int
    assignment_id: Optional[int] = None


@router.post("/generate-preview", response_model=list[StudyBlockPreview])
def generate_study_preview(req: StudyBlockRequest):
    deadline = datetime.strptime(req.deadline_date, "%Y-%m-%d")
    now      = datetime.now()
    days_avail = (deadline - now).days

    if days_avail <= 0:
        raise HTTPException(status_code=400,
            detail={"error": {"code": "past_deadline", "detail": "Deadline has already passed."}})

    interval = max(1, days_avail // max(req.num_sessions, 1))
    cursor   = now.replace(hour=req.preferred_hour, minute=0, second=0, microsecond=0)
    if cursor <= now:
        cursor += timedelta(days=1)

    blocks = []
    for i in range(req.num_sessions):
        if cursor >= deadline:
            break
        if req.skip_weekends and cursor.weekday() >= 5:
            cursor += timedelta(days=7 - cursor.weekday())
        if cursor >= deadline:
            break
        label = "Final Review" if i == req.num_sessions - 1 else f"Study Session {i + 1}"
        end_cursor = cursor + timedelta(minutes=req.session_duration_minutes)
        blocks.append(StudyBlockPreview(
            title=f"{req.subject} — {label}",
            start_time=cursor.isoformat(),
            end_time=end_cursor.isoformat(),
            description=f"Auto-generated study block. Deadline: {req.deadline_date}",
            calendar_id=req.calendar_id,
            assignment_id=req.assignment_id,
        ))
        cursor += timedelta(days=interval)

    return blocks


@router.post("/confirm-blocks")
def confirm_study_blocks(blocks: list[StudyBlockPreview], db: Session = Depends(get_db)):
    created = []
    for b in blocks:
        event = models.Event(**b.model_dump())
        db.add(event)
        db.commit()
        db.refresh(event)
        created.append(event)
    return {"created_count": len(created), "events": created}
