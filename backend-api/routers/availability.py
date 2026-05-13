import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models

router = APIRouter(prefix="/availability")


class CreateAvailabilityRequest(BaseModel):
    sender_name: str
    duration_minutes: int = 60
    slots: list  # [{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM"}]


class ContactInfo(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    company: Optional[str] = None


class ConfirmAvailabilityRequest(BaseModel):
    slot: dict
    receiver_name: Optional[str] = None
    contact: Optional[ContactInfo] = None


class AmendAvailabilityRequest(BaseModel):
    slot: dict
    receiver_name: str
    note: Optional[str] = None


class RespondAmendmentRequest(BaseModel):
    action: str  # "accept" | "decline" | "counter"
    counter_slot: Optional[dict] = None


def _check_availability_expiry(req: models.AvailabilityRequest):
    if datetime.utcnow() > datetime.fromisoformat(req.expires_at):
        raise HTTPException(
            status_code=410,
            detail={"error": {"code": "link_expired", "detail": "This availability link has expired."}}
        )


def _create_meeting_event(db: Session, slot: dict, contact: dict | None = None) -> Optional[int]:
    calendar = db.query(models.Calendar).first()
    if not calendar:
        return None
    date_str = slot["date"]
    description = None
    if contact:
        lines = []
        if contact.get("name"):    lines.append(f"Name: {contact['name']}")
        if contact.get("email"):   lines.append(f"Email: {contact['email']}")
        if contact.get("phone"):   lines.append(f"Phone: {contact['phone']}")
        if contact.get("company"): lines.append(f"Company: {contact['company']}")
        description = "\n".join(lines) if lines else None
    event_data = models.EventBase(
        title="Meeting (availability booking)",
        description=description,
        start_time=f"{date_str}T{slot['start']}:00",
        end_time=f"{date_str}T{slot['end']}:00",
        calendar_id=calendar.id,
        reminder_minutes=15,
    )
    db_event = models.Event.model_validate(event_data)
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event.id


@router.post("")
def create_availability(body: CreateAvailabilityRequest, db: Session = Depends(get_db)):
    token = str(uuid.uuid4())
    now = datetime.utcnow()
    req = models.AvailabilityRequest(
        token=token,
        sender_name=body.sender_name,
        duration_minutes=body.duration_minutes,
        slots=json.dumps(body.slots),
        status="pending",
        created_at=now.isoformat(),
        expires_at=(now + timedelta(days=7)).isoformat(),
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    share_url = f"http://localhost:8000/availability/{token}/view"
    return {"id": req.id, "token": token, "share_url": share_url, "view_url": share_url}


@router.get("/{token}", response_model=models.AvailabilityRequestRead)
def get_availability(token: str, db: Session = Depends(get_db)):
    req = db.query(models.AvailabilityRequest).filter(
        models.AvailabilityRequest.token == token
    ).first()
    if not req:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "not_found", "detail": "Availability request not found."}})
    _check_availability_expiry(req)
    return req


@router.post("/{token}/confirm")
def confirm_availability(token: str, body: ConfirmAvailabilityRequest, db: Session = Depends(get_db)):
    req = db.query(models.AvailabilityRequest).filter(
        models.AvailabilityRequest.token == token
    ).first()
    if not req:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "not_found", "detail": "Availability request not found."}})
    _check_availability_expiry(req)
    if req.status == "confirmed":
        raise HTTPException(status_code=409,
            detail={"error": {"code": "already_resolved", "detail": "This time has already been booked."}})
    req.status = "confirmed"
    req.confirmed_slot = json.dumps(body.slot)
    if body.contact and body.contact.name:
        req.receiver_name = body.contact.name
    elif body.receiver_name:
        req.receiver_name = body.receiver_name
    db.commit()
    db.refresh(req)
    contact_dict = body.contact.model_dump() if body.contact else None
    event_id = _create_meeting_event(db, body.slot, contact_dict)
    return {"status": req.status, "confirmed_slot": json.loads(req.confirmed_slot), "event_id": event_id}


@router.post("/{token}/amend")
def amend_availability(token: str, body: AmendAvailabilityRequest, db: Session = Depends(get_db)):
    req = db.query(models.AvailabilityRequest).filter(
        models.AvailabilityRequest.token == token
    ).first()
    if not req:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "not_found", "detail": "Availability request not found."}})
    _check_availability_expiry(req)
    if req.status not in ("pending",):
        raise HTTPException(status_code=409,
            detail={"error": {"code": "already_resolved", "detail": "Request cannot be amended in its current state."}})
    req.status = "amended"
    req.amendment_slot = json.dumps(body.slot)
    req.receiver_name = body.receiver_name
    db.commit()
    db.refresh(req)
    return {"status": req.status, "amendment_slot": json.loads(req.amendment_slot)}


@router.post("/{token}/respond-amendment")
def respond_amendment(token: str, body: RespondAmendmentRequest, db: Session = Depends(get_db)):
    req = db.query(models.AvailabilityRequest).filter(
        models.AvailabilityRequest.token == token
    ).first()
    if not req:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "not_found", "detail": "Availability request not found."}})
    _check_availability_expiry(req)

    if body.action == "accept":
        slot = json.loads(req.amendment_slot)
        req.status = "confirmed"
        req.confirmed_slot = req.amendment_slot
        db.commit()
        db.refresh(req)
        event_id = _create_meeting_event(db, slot)
        return {"status": "confirmed", "event_id": event_id}

    elif body.action == "decline":
        req.status = "declined"
        db.commit()
        return {"status": "declined"}

    elif body.action == "counter":
        if not body.counter_slot:
            raise HTTPException(status_code=422,
                detail={"error": {"code": "missing_counter_slot", "detail": "counter_slot is required for counter action."}})
        req.status = "pending"
        req.amendment_slot = json.dumps(body.counter_slot)
        db.commit()
        return {"status": "pending", "amendment_slot": body.counter_slot}

    raise HTTPException(status_code=422,
        detail={"error": {"code": "invalid_action", "detail": "action must be accept, decline, or counter."}})


_404_HTML = (
    "<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Not Found</title>"
    "<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;"
    "display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}"
    ".box{text-align:center;padding:48px 24px}"
    "h2{font-size:1.4rem;font-weight:700;margin-bottom:8px}"
    "p{color:#64748b;font-size:0.95rem}</style></head>"
    "<body><div class='box'><h2>Link not found</h2>"
    "<p>This availability link does not exist.</p></div></body></html>"
)


@router.get("/{token}/view", response_class=HTMLResponse)
def view_availability(token: str, db: Session = Depends(get_db)):
    req = db.query(models.AvailabilityRequest).filter(
        models.AvailabilityRequest.token == token
    ).first()
    if not req:
        return HTMLResponse(content=_404_HTML, status_code=404)
    # routers/availability.py is one level deeper than main.py;
    # walk up out of routers/ to land on backend-api/.
    html_path = Path(__file__).resolve().parent.parent / "availability_receiver.html"
    html = html_path.read_text(encoding="utf-8").replace("{{ token }}", token)
    return HTMLResponse(content=html)
