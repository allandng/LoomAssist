import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models

router = APIRouter(prefix="/templates")


@router.post("/", response_model=models.EventTemplateRead)
def create_template(template: models.EventTemplateCreate, db: Session = Depends(get_db)):
    try:
        db_template = models.EventTemplate.model_validate(template)
        db.add(db_template)
        db.commit()
        db.refresh(db_template)
        return db_template
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400,
            detail={"error": {"code": "template_create_failed", "detail": str(e)}})


@router.get("/", response_model=list[models.EventTemplateRead])
def list_templates(db: Session = Depends(get_db)):
    return db.query(models.EventTemplate).all()


@router.delete("/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db)):
    db_template = db.query(models.EventTemplate).filter(models.EventTemplate.id == template_id).first()
    if not db_template:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "template_not_found", "detail": f"Template {template_id} does not exist."}})
    db.delete(db_template)
    db.commit()
    return {"status": "success"}


class TimeBlockDef(BaseModel):
    title: str
    day_of_week: int    # 1=Mon … 7=Sun
    start_time: str     # "HH:MM"
    end_time: str       # "HH:MM"
    calendar_id: int


class TimeBlockTemplateCreate(BaseModel):
    name: str
    description: str = ""
    blocks: list[TimeBlockDef]


class ApplyTemplateRequest(BaseModel):
    week_monday_date: str   # ISO YYYY-MM-DD


@router.get("/time-blocks", response_model=list[models.TimeBlockTemplateRead])
def list_time_block_templates(db: Session = Depends(get_db)):
    return db.query(models.TimeBlockTemplate).all()


@router.post("/time-blocks", response_model=models.TimeBlockTemplateRead)
def create_time_block_template(payload: TimeBlockTemplateCreate, db: Session = Depends(get_db)):
    try:
        tpl = models.TimeBlockTemplate(
            name=payload.name,
            description=payload.description,
            created_at=datetime.now().isoformat(),
            blocks_json=json.dumps([b.model_dump() for b in payload.blocks]),
        )
        db.add(tpl)
        db.commit()
        db.refresh(tpl)
        return tpl
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400,
            detail={"error": {"code": "tbt_create_failed", "detail": str(e)}})


@router.delete("/time-blocks/{tpl_id}", status_code=204)
def delete_time_block_template(tpl_id: int, db: Session = Depends(get_db)):
    tpl = db.query(models.TimeBlockTemplate).filter(models.TimeBlockTemplate.id == tpl_id).first()
    if not tpl:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "tbt_not_found", "detail": f"Template {tpl_id} does not exist."}})
    db.delete(tpl)
    db.commit()
    return Response(status_code=204)


@router.post("/time-blocks/{tpl_id}/apply")
def apply_time_block_template(tpl_id: int, req: ApplyTemplateRequest, db: Session = Depends(get_db)):
    tpl = db.query(models.TimeBlockTemplate).filter(models.TimeBlockTemplate.id == tpl_id).first()
    if not tpl:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "tbt_not_found", "detail": f"Template {tpl_id} does not exist."}})
    try:
        monday = datetime.fromisoformat(req.week_monday_date)
    except ValueError:
        raise HTTPException(status_code=422,
            detail={"error": {"code": "invalid_date", "detail": "week_monday_date must be ISO YYYY-MM-DD."}})
    try:
        blocks = json.loads(tpl.blocks_json)
    except Exception:
        blocks = []
    pending = []
    for block in blocks:
        dow = int(block["day_of_week"])
        day_date = monday + timedelta(days=dow - 1)
        start_iso = f"{day_date.strftime('%Y-%m-%d')}T{block['start_time']}:00"
        end_iso   = f"{day_date.strftime('%Y-%m-%d')}T{block['end_time']}:00"
        event = models.Event(
            title=block["title"],
            start_time=start_iso,
            end_time=end_iso,
            calendar_id=int(block["calendar_id"]),
        )
        db.add(event)
        pending.append(event)
    if not pending:
        return {"applied_count": 0, "events": []}
    db.flush()   # assigns IDs without committing
    ids = [e.id for e in pending]
    db.commit()
    created = db.query(models.Event).filter(models.Event.id.in_(ids)).all()
    return {"applied_count": len(created), "events": created}
