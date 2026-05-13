from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models

router = APIRouter(prefix="/tasks")


class TaskCreate(BaseModel):
    event_id: int
    note: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    is_complete: bool = False
    estimated_minutes: Optional[int] = None
    deadline: Optional[str] = None


class TaskUpdate(BaseModel):
    is_complete: bool
    note: Optional[str] = None
    status: Optional[str] = None    # backlog | doing | done
    priority: Optional[str] = None  # high | med | low
    due_date: Optional[str] = None  # ISO date string
    estimated_minutes: Optional[int] = None
    deadline: Optional[str] = None


@router.post("/", response_model=models.TaskRead)
def create_task(task: TaskCreate, db: Session = Depends(get_db)):
    # Idempotent — return existing task if this event is already pinned
    existing = db.query(models.Task).filter(models.Task.event_id == task.event_id).first()
    if existing:
        return existing
    try:
        db_task = models.Task(
            event_id=task.event_id,
            note=task.note,
            is_complete=task.is_complete,
            status=task.status or "backlog",
            priority=task.priority or "low",
            estimated_minutes=task.estimated_minutes,
            deadline=task.deadline,
            added_at=datetime.now().isoformat(),
        )
        db.add(db_task)
        db.commit()
        db.refresh(db_task)
        return db_task
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400,
            detail={"error": {"code": "task_create_failed", "detail": str(e)}})


@router.get("/", response_model=list[models.TaskRead])
def list_tasks(db: Session = Depends(get_db)):
    return db.query(models.Task).all()


@router.put("/{task_id}", response_model=models.TaskRead)
def update_task(task_id: int, task: TaskUpdate, db: Session = Depends(get_db)):
    db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "task_not_found", "detail": f"Task {task_id} does not exist."}})
    db_task.is_complete = task.is_complete
    db_task.note = task.note
    if task.status             is not None: db_task.status             = task.status
    if task.priority           is not None: db_task.priority           = task.priority
    if task.due_date           is not None: db_task.due_date           = task.due_date
    if task.estimated_minutes  is not None: db_task.estimated_minutes  = task.estimated_minutes
    if task.deadline           is not None: db_task.deadline           = task.deadline
    db.commit()
    db.refresh(db_task)
    return db_task


@router.delete("/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "task_not_found", "detail": f"Task {task_id} does not exist."}})
    db.delete(db_task)
    db.commit()
    return {"status": "success"}
