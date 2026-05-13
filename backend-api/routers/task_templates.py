from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional

from core.deps import get_db
from database import models

router = APIRouter(prefix="/task-templates")


class TaskTemplateCreate(BaseModel):
    name: str
    title: str
    description: Optional[str] = None
    default_priority: Optional[str] = "low"
    recurrence_days: Optional[str] = None
    calendar_id: Optional[int] = None


@router.get("", response_model=List[models.TaskTemplateRead])
def list_task_templates(db: Session = Depends(get_db)):
    return db.query(models.TaskTemplate).order_by(models.TaskTemplate.created_at).all()


@router.post("", response_model=models.TaskTemplateRead)
def create_task_template(payload: TaskTemplateCreate, db: Session = Depends(get_db)):
    t = models.TaskTemplate(
        name=payload.name,
        title=payload.title,
        description=payload.description,
        default_priority=payload.default_priority or "low",
        recurrence_days=payload.recurrence_days,
        calendar_id=payload.calendar_id,
        created_at=datetime.now().isoformat(),
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.delete("/{tpl_id}")
def delete_task_template(tpl_id: int, db: Session = Depends(get_db)):
    t = db.query(models.TaskTemplate).filter(models.TaskTemplate.id == tpl_id).first()
    if not t:
        raise HTTPException(status_code=404, detail={"error": {"code": "template_not_found"}})
    db.delete(t)
    db.commit()
    return {"status": "deleted"}
