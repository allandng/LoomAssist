from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional

from core.deps import get_db
from database import models

router = APIRouter(prefix="/pomodoro-sessions")


class PomodoroSessionCreate(BaseModel):
    completed_at: str
    duration_minutes: int
    mode: str
    task_id: Optional[int] = None
    task_note: Optional[str] = None
    round_num: Optional[int] = None


class EnergyMapResponse(BaseModel):
    grid: List[List[int]]
    total: int
    source: str
    last_session_at: Optional[str] = None
    weeks: int


@router.post("", response_model=models.PomodoroSessionRead)
def create_pomodoro_session(payload: PomodoroSessionCreate, db: Session = Depends(get_db)):
    try:
        row = models.PomodoroSession(
            completed_at=payload.completed_at,
            duration_minutes=payload.duration_minutes,
            mode=payload.mode,
            task_id=payload.task_id,
            task_note=payload.task_note,
            round_num=payload.round_num,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400,
            detail={"error": {"code": "pomodoro_create_failed", "detail": str(e)}})


@router.get("/energy-map", response_model=EnergyMapResponse)
def energy_map(weeks: int = 12, proxy: bool = True, db: Session = Depends(get_db)):
    """
    Return a 7×24 grid of completion counts (rows = day-of-week Mon..Sun, cols = hour 0..23).
    Falls back to Event.actual_start (clock-in) and Event.start_time as a proxy energy
    signal when fewer than 5 work-mode pomodoros exist in the window.
    """
    cutoff = (datetime.now() - timedelta(weeks=max(1, weeks))).isoformat()

    grid = [[0 for _ in range(24)] for _ in range(7)]

    pomodoros = (
        db.query(models.PomodoroSession)
        .filter(models.PomodoroSession.mode == "work")
        .filter(models.PomodoroSession.completed_at >= cutoff)
        .all()
    )

    last_session_at: Optional[str] = None
    for p in pomodoros:
        try:
            dt = datetime.fromisoformat(p.completed_at)
        except (ValueError, TypeError):
            continue
        grid[dt.weekday()][dt.hour] += 1
        if last_session_at is None or p.completed_at > last_session_at:
            last_session_at = p.completed_at

    total = len(pomodoros)
    source = "pomodoro"

    if proxy and total < 5:
        # Proxy: bin Event.actual_start (clock-in) first, fall back to start_time.
        events = (
            db.query(models.Event)
            .filter(models.Event.deleted_at.is_(None))
            .all()
        )
        proxy_added = 0
        for ev in events:
            iso = ev.actual_start or ev.start_time
            if not iso or iso < cutoff:
                continue
            try:
                dt = datetime.fromisoformat(iso)
            except (ValueError, TypeError):
                continue
            grid[dt.weekday()][dt.hour] += 1
            proxy_added += 1
        if proxy_added > 0:
            source = "mixed" if total > 0 else "events_proxy"

    return EnergyMapResponse(
        grid=grid,
        total=total,
        source=source,
        last_session_at=last_session_at,
        weeks=weeks,
    )
