import os
import tempfile
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from pypdf import PdfReader
from sqlalchemy.orm import Session

from core.deps import get_db
from core.validation import validate_calendar_exists
from database import models
from loom_logger import get_logger
from services import scraper
from services.integrations.ics import generate_event_uid
from services.integrations.timeline_export import build_ics_export, build_json_export

router = APIRouter()
logger = get_logger("main")


class ApprovedEvent(BaseModel):
    title: str
    start_time: str
    end_time: str
    is_recurring: Optional[bool] = False
    recurrence_days: Optional[str] = None
    recurrence_end: Optional[str] = None
    description: Optional[str] = None
    unique_description: Optional[str] = None
    timezone: Optional[str] = "local"


class SaveApprovedEventsRequest(BaseModel):
    calendar_id: int
    events: list[ApprovedEvent]
    course_id: Optional[int] = None  # Phase 8: if set, also create Assignment rows


@router.post("/integrations/import-ics-file/")
async def import_ics_file(
    file: UploadFile = File(...),
    calendar_id: int = Form(...),
    db: Session = Depends(get_db)
):
    validate_calendar_exists(calendar_id, db)

    try:
        content = await file.read()
        raw_events = scraper.parse_ics_bytes(content)

        events_added = 0
        events_skipped = 0

        for ev_data in raw_events:
            # Duplicate Check
            if ev_data.get("external_uid"):
                existing = db.query(models.Event).filter(
                    models.Event.calendar_id == calendar_id,
                    models.Event.external_uid == ev_data["external_uid"]
                ).first()

                if existing:
                    events_skipped += 1
                    continue

            new_event = models.Event(
                title=ev_data["title"],
                start_time=ev_data["start_time"],
                end_time=ev_data["end_time"],
                calendar_id=calendar_id,
                external_uid=ev_data.get("external_uid")
            )
            db.add(new_event)
            events_added += 1

        db.commit()
        return {"status": "success", "events_added": events_added, "events_skipped": events_skipped}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/export/timelines/")
def export_timelines(calendar_ids: str, format: str = "json", db: Session = Depends(get_db)):
    if not calendar_ids:
        raise HTTPException(status_code=400, detail={"error": {"code": "export_failed", "detail": "calendar_ids cannot be empty."}})
    try:
        id_list = [int(cid.strip()) for cid in calendar_ids.split(",")]
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": {"code": "export_failed", "detail": "calendar_ids must be a comma-separated list of integers."}})

    calendar_list = db.query(models.Calendar).filter(models.Calendar.id.in_(id_list)).all()
    found_ids = [cal.id for cal in calendar_list]
    skipped_ids = [cid for cid in id_list if cid not in found_ids]

    if format.lower() == "json":
        return JSONResponse(content=build_json_export(calendar_list, skipped_ids))
    elif format.lower() == "ics":
        return Response(
            content=build_ics_export(calendar_list),
            media_type="text/calendar",
            headers={"Content-Disposition": 'attachment; filename="loom-export.ics"'},
        )
    else:
        raise HTTPException(status_code=400, detail={"error": {"code": "export_failed", "detail": "Format must be json or ics."}})


@router.post("/documents/extract-syllabus/")
async def extract_syllabus(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_pdf:
        temp_pdf.write(await file.read())
        temp_file_path = temp_pdf.name

    try:
        reader = PdfReader(temp_file_path)
        extracted_text = ""
        for page in reader.pages:
            text = page.extract_text()
            if text:
                extracted_text += text + "\n"

        if len(extracted_text.strip()) < 100:
            raise HTTPException(
                status_code=400,
                detail={"error": {"code": "pdf_unreadable", "detail": "PDF appears to be scanned or image-based. Digital PDFs only."}}
            )

        # FUTURE IMPROVEMENT: Implement proper chunking for massive PDFs
        truncated_text = extracted_text[:8000]
        # Lazy import: keeps LLM model out of app boot path.
        # See services/ai/syllabus.py for the lazy-load contract.
        from services.ai.syllabus import extract_syllabus_events
        events = extract_syllabus_events(truncated_text)

        return {"status": "success", "events": events}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Syllabus parse failed: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "syllabus_parse_failed", "detail": str(e)}}
        )
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)


@router.post("/documents/save-approved-events/")
def save_approved_events(request: SaveApprovedEventsRequest, db: Session = Depends(get_db)):
    validate_calendar_exists(request.calendar_id, db)

    try:
        events_added = 0
        events_skipped = 0
        created_ids = []

        for ev in request.events:
            # Generate deterministic hash for PDF events using start_time
            uid = generate_event_uid(ev.title, ev.start_time)

            # Duplicate Check
            existing = db.query(models.Event).filter(
                models.Event.calendar_id == request.calendar_id,
                models.Event.external_uid == uid
            ).first()

            if existing:
                events_skipped += 1
                continue

            new_event = models.Event(
                title=ev.title,
                start_time=ev.start_time,
                end_time=ev.end_time,
                calendar_id=request.calendar_id,
                is_recurring=ev.is_recurring,
                recurrence_days=ev.recurrence_days,
                recurrence_end=ev.recurrence_end,
                description=ev.description,
                unique_description=ev.unique_description,
                external_uid=uid,
                timezone=ev.timezone
            )
            db.add(new_event)
            db.flush()  # Populate ID
            created_ids.append(new_event.id)
            events_added += 1

            # Phase 8: if a course_id was provided, also create an Assignment row
            if request.course_id:
                assignment = models.Assignment(
                    course_id=request.course_id,
                    title=ev.title,
                    due_date=ev.start_time[:10],  # YYYY-MM-DD
                    event_id=new_event.id,
                )
                db.add(assignment)

        db.commit()
        return {
            "status": "success",
            "events_added": events_added,
            "events_skipped": events_skipped,
            "event_ids": created_ids,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
