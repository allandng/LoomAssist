from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional

from core.deps import get_db
from database import models

router = APIRouter(prefix="/habits")


class HabitCreate(BaseModel):
    name: str
    color: Optional[str] = "#6366f1"
    target_per_week: Optional[int] = 7


class HabitUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    target_per_week: Optional[int] = None


class HabitLog(BaseModel):
    date: str  # YYYY-MM-DD
    count: Optional[int] = 1


@router.get("", response_model=List[models.HabitRead])
def list_habits(db: Session = Depends(get_db)):
    return db.query(models.Habit).order_by(models.Habit.created_at).all()


@router.post("", response_model=models.HabitRead)
def create_habit(payload: HabitCreate, db: Session = Depends(get_db)):
    h = models.Habit(
        name=payload.name,
        color=payload.color or "#6366f1",
        target_per_week=payload.target_per_week or 7,
        created_at=datetime.now().isoformat(),
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


@router.put("/{habit_id}", response_model=models.HabitRead)
def update_habit(habit_id: int, payload: HabitUpdate, db: Session = Depends(get_db)):
    h = db.query(models.Habit).filter(models.Habit.id == habit_id).first()
    if not h:
        raise HTTPException(status_code=404, detail={"error": {"code": "habit_not_found"}})
    if payload.name is not None: h.name = payload.name
    if payload.color is not None: h.color = payload.color
    if payload.target_per_week is not None: h.target_per_week = payload.target_per_week
    db.commit()
    db.refresh(h)
    return h


@router.delete("/{habit_id}")
def delete_habit(habit_id: int, db: Session = Depends(get_db)):
    h = db.query(models.Habit).filter(models.Habit.id == habit_id).first()
    if not h:
        raise HTTPException(status_code=404, detail={"error": {"code": "habit_not_found"}})
    db.query(models.HabitEntry).filter(models.HabitEntry.habit_id == habit_id).delete()
    db.delete(h)
    db.commit()
    return {"status": "deleted"}


@router.get("/{habit_id}/entries", response_model=List[models.HabitEntryRead])
def list_habit_entries(habit_id: int, db: Session = Depends(get_db)):
    return db.query(models.HabitEntry).filter(models.HabitEntry.habit_id == habit_id).all()


@router.post("/{habit_id}/log", response_model=models.HabitEntryRead)
def log_habit(habit_id: int, payload: HabitLog, db: Session = Depends(get_db)):
    h = db.query(models.Habit).filter(models.Habit.id == habit_id).first()
    if not h:
        raise HTTPException(status_code=404, detail={"error": {"code": "habit_not_found"}})
    existing = db.query(models.HabitEntry).filter(
        models.HabitEntry.habit_id == habit_id,
        models.HabitEntry.date == payload.date,
    ).first()
    if existing:
        existing.count = payload.count or 1
        db.commit()
        db.refresh(existing)
        return existing
    entry = models.HabitEntry(habit_id=habit_id, date=payload.date, count=payload.count or 1)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{habit_id}/entries/{entry_id}")
def delete_habit_entry(habit_id: int, entry_id: int, db: Session = Depends(get_db)):
    e = db.query(models.HabitEntry).filter(
        models.HabitEntry.id == entry_id,
        models.HabitEntry.habit_id == habit_id,
    ).first()
    if not e:
        raise HTTPException(status_code=404, detail={"error": {"code": "entry_not_found"}})
    db.delete(e)
    db.commit()
    return {"status": "deleted"}
