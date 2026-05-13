import hashlib

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models
from services.integrations.ics import _refresh_subscription

router = APIRouter(prefix="/subscriptions")


class SubscriptionCreate(BaseModel):
    name: str
    url: str
    timeline_id: int
    refresh_minutes: int = 360
    enabled: bool = True


@router.get("", response_model=list[models.SubscriptionRead])
def list_subscriptions(db: Session = Depends(get_db)):
    return db.query(models.Subscription).all()


@router.post("", response_model=models.SubscriptionRead)
def create_subscription(body: SubscriptionCreate, db: Session = Depends(get_db)):
    sub = models.Subscription(**body.model_dump())
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


@router.put("/{sub_id}", response_model=models.SubscriptionRead)
def update_subscription(sub_id: int, body: SubscriptionCreate, db: Session = Depends(get_db)):
    sub = db.query(models.Subscription).filter(models.Subscription.id == sub_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    for k, v in body.model_dump().items():
        setattr(sub, k, v)
    db.commit()
    db.refresh(sub)
    return sub


@router.delete("/{sub_id}")
def delete_subscription(sub_id: int, db: Session = Depends(get_db)):
    sub = db.query(models.Subscription).filter(models.Subscription.id == sub_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    url_hash = hashlib.md5(sub.url.encode()).hexdigest()[:8]
    prefix = f"sub-{url_hash}-"
    db.query(models.Event).filter(models.Event.external_uid.like(f"{prefix}%")).delete(synchronize_session=False)
    db.delete(sub)
    db.commit()
    return {"status": "deleted"}


@router.post("/{sub_id}/refresh", response_model=models.SubscriptionRead)
async def refresh_subscription(sub_id: int, db: Session = Depends(get_db)):
    sub = db.query(models.Subscription).filter(models.Subscription.id == sub_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    await _refresh_subscription(sub, db)
    db.refresh(sub)
    return sub
