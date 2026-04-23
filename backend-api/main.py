from loom_logger import get_logger, write_crash_snapshot, LOG_FILE, CRASH_FLAG
import logging
logging.basicConfig(handlers=[])  # suppress root handler noise

from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, Form, Request
from fastapi.responses import JSONResponse, Response, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from typing import Optional, List
from sqlalchemy.orm import Session
from pydantic import BaseModel
from services import scraper
import asyncio
from faster_whisper import WhisperModel
import os
import tempfile
import ollama
import json
import re
import time as _time
from collections import defaultdict
from datetime import datetime, timedelta
from sqlmodel import select
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from pypdf import PdfReader
import shutil
import hashlib
import uuid
from pathlib import Path
from database.database import SessionLocal, engine, create_db_and_tables, run_migrations, migrate_todo_to_task
from database import models

# Run column migrations FIRST (adds missing columns to existing DB)
run_migrations()

# Drop legacy todo table and create task table if needed
migrate_todo_to_task()

# Then create any brand-new tables (including task)
create_db_and_tables()

app = FastAPI(title="Loom Backend API")

logger = get_logger("main")


class CrashMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        try:
            return await call_next(request)
        except Exception as exc:
            get_logger("crash").critical(
                f"Unhandled {request.method} {request.url.path}",
                exc_info=True,
            )
            write_crash_snapshot(type(exc), exc, exc.__traceback__)
            return JSONResponse(
                status_code=500,
                content={"error": {"code": "internal_error", "detail": "An unexpected error occurred."}},
            )


app.add_middleware(CrashMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

model = WhisperModel("base.en", device="cpu", compute_type="int8")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def validate_event_times(start_time: str, end_time: str):
    """Raises HTTPException 422 if times are invalid. Only called on new/edited events."""
    try:
        start = datetime.fromisoformat(start_time)
        end = datetime.fromisoformat(end_time)
    except ValueError:
        raise HTTPException(status_code=422,
            detail={'error': {'code': 'invalid_time_format',
                              'detail': 'start_time and end_time must be valid ISO 8601 strings.'}})
    if end <= start:
        raise HTTPException(status_code=422,
            detail={'error': {'code': 'invalid_time_range',
                              'detail': 'end_time must be after start_time.'}})
    if not (1970 <= start.year <= 2100):
        raise HTTPException(status_code=422,
            detail={'error': {'code': 'out_of_range',
                              'detail': 'Event year must be between 1970 and 2100.'}})

def validate_calendar_exists(calendar_id: int, db: Session):
    """Raises HTTPException 404 if calendar not found."""
    cal = db.query(models.Calendar).filter(models.Calendar.id == calendar_id).first()
    if not cal:
        raise HTTPException(status_code=404,
            detail={'error': {'code': 'calendar_not_found',
                              'detail': f'Calendar {calendar_id} does not exist.'}})

# ==========================================
# LOG RATE LIMITER
# ==========================================

_log_rate: dict[str, tuple[int, float]] = defaultdict(lambda: (0, 0.0))


def _check_rate(ip: str, limit: int = 100, window: float = 60.0) -> bool:
    count, start = _log_rate[ip]
    now = _time.monotonic()
    if now - start > window:
        _log_rate[ip] = (1, now)
        return True
    if count >= limit:
        return False
    _log_rate[ip] = (count + 1, start)
    return True


# ==========================================
# LOGGING ENDPOINTS
# ==========================================

class FrontendLogEntry(BaseModel):
    level: str
    message: str
    context: Optional[dict] = None


@app.post("/api/logs")
async def receive_frontend_log(entry: FrontendLogEntry, request: Request):
    ip = request.client.host if request.client else "unknown"
    if not _check_rate(ip):
        return JSONResponse(status_code=429, content={"error": {"code": "rate_limited"}})
    frontend_logger = get_logger("frontend")
    level = entry.level.upper()
    msg = entry.message if not entry.context else f"{entry.message} | {entry.context}"
    getattr(frontend_logger, level.lower(), frontend_logger.info)(msg)
    return {"status": "ok"}


@app.get("/api/logs/crash-flag")
def get_crash_flag():
    if CRASH_FLAG.exists():
        crash_file = CRASH_FLAG.read_text().strip()
        CRASH_FLAG.unlink(missing_ok=True)
        return {"crashed": True, "crash_file": crash_file}
    return {"crashed": False, "crash_file": None}


@app.get("/api/logs/export")
def export_logs():
    if not LOG_FILE.exists():
        return Response(
            content="No log file found.",
            media_type="text/plain",
            headers={"Content-Disposition": 'attachment; filename="loomassist_logs.txt"'},
        )
    lines = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
    content = "".join(lines[-500:])
    return Response(
        content=content,
        media_type="text/plain",
        headers={"Content-Disposition": 'attachment; filename="loomassist_logs.txt"'},
    )


@app.delete("/api/logs")
def clear_logs():
    if LOG_FILE.exists():
        LOG_FILE.unlink()
    LOG_FILE.touch()
    return {"status": "ok"}


@app.get("/")
async def root():
    return {"status": "online", "message": "Loom Backend is running."}

# ==========================================
# CALENDAR ROUTES
# ==========================================

@app.post("/calendars/", response_model=models.CalendarRead)
def create_calendar(calendar: models.CalendarBase, db: Session = Depends(get_db)):
    db_calendar = models.Calendar.model_validate(calendar)
    db.add(db_calendar)
    db.commit()
    db.refresh(db_calendar)
    return db_calendar

@app.get("/calendars/", response_model=list[models.CalendarRead])
def read_calendars(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(models.Calendar).offset(skip).limit(limit).all()

@app.put("/calendars/{calendar_id}", response_model=models.CalendarRead)
def update_calendar(calendar_id: int, calendar_update: models.CalendarBase, db: Session = Depends(get_db)):
    db_calendar = db.query(models.Calendar).filter(models.Calendar.id == calendar_id).first()
    if not db_calendar:
        raise HTTPException(
            status_code=404, 
            detail={"error": {"code": "not_found", "detail": "Calendar not found"}}
        )
    
    for key, value in calendar_update.model_dump().items():
        setattr(db_calendar, key, value)
        
    db.commit()
    db.refresh(db_calendar)
    return db_calendar

@app.delete("/calendars/{calendar_id}")
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

# ==========================================
# EVENT ROUTES
# ==========================================

@app.post("/events/", response_model=models.EventRead)
def create_event(event: models.EventBase, db: Session = Depends(get_db)):
    validate_calendar_exists(event.calendar_id, db)
    validate_event_times(event.start_time, event.end_time)
    
    db_event = models.Event.model_validate(event)
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event

@app.get("/events/", response_model=list[models.EventRead])
def read_events(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(models.Event).offset(skip).limit(limit).all()

@app.put("/events/{event_id}", response_model=models.EventRead)
def update_event(event_id: int, event: models.EventBase, db: Session = Depends(get_db)):
    db_event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not db_event:
        raise HTTPException(
            status_code=404, 
            detail={"error": {"code": "not_found", "detail": "Event not found"}}
        )
    
    validate_event_times(event.start_time, event.end_time)
    
    for key, value in event.model_dump().items():
        setattr(db_event, key, value)
        
    db.commit()
    db.refresh(db_event)
    return db_event

@app.delete("/events/{event_id}")
def delete_event(event_id: int, db: Session = Depends(get_db)):
    db_event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not db_event:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "not_found", "detail": "Event not found"}}
        )

    db.delete(db_event)
    db.commit()
    return {"status": "success", "message": "Event deleted"}

# H4: Pydantic model for skip-date request body
class SkipDateRequest(BaseModel):
    date: str

@app.post("/events/{event_id}/skip-date")
def skip_event_date(event_id: int, body: SkipDateRequest, db: Session = Depends(get_db)):
    """Append a YYYY-MM-DD date to skipped_dates for a recurring event."""
    db_event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not db_event:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "not_found", "detail": "Event not found"}}
        )
    existing = db_event.skipped_dates or ""
    dates = [d for d in existing.split(",") if d]
    if body.date not in dates:
        dates.append(body.date)
    db_event.skipped_dates = ",".join(dates)
    db.commit()
    db.refresh(db_event)
    return {"status": "success", "skipped_dates": db_event.skipped_dates}

@app.delete("/events/{event_id}/skip-date")
def unskip_event_date(event_id: int, body: SkipDateRequest, db: Session = Depends(get_db)):
    """Remove a previously skipped date from a recurring event."""
    db_event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not db_event:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "not_found", "detail": "Event not found"}}
        )
    existing = db_event.skipped_dates or ""
    dates = [d for d in existing.split(",") if d and d != body.date]
    db_event.skipped_dates = ",".join(dates) if dates else None
    db.commit()
    db.refresh(db_event)
    return {"status": "success", "skipped_dates": db_event.skipped_dates}

# ==========================================
# INTEGRATION ROUTES
# ==========================================

# REPLACE the existing ApprovedEvent class with:
class ApprovedEvent(BaseModel):
    title: str
    start_time: str
    end_time: str
    is_recurring: Optional[bool] = False
    recurrence_days: Optional[str] = None
    recurrence_end: Optional[str] = None
    description: Optional[str] = None
    unique_description: Optional[str] = None
    timezone: Optional[str] = 'local'

class SaveApprovedEventsRequest(BaseModel):
    calendar_id: int
    events: list[ApprovedEvent]

@app.post("/integrations/import-ics-file/")
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

@app.get("/export/timelines/")
def export_timelines(calendar_ids: str, format: str = "json", db: Session = Depends(get_db)):
    if not calendar_ids:
        raise HTTPException(status_code=400, detail={"error": {"code": "export_failed", "detail": "calendar_ids cannot be empty."}})
        
    try:
        id_list = [int(cid.strip()) for cid in calendar_ids.split(',')]
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": {"code": "export_failed", "detail": "calendar_ids must be a comma-separated list of integers."}})
        
    calendars = db.query(models.Calendar).filter(models.Calendar.id.in_(id_list)).all()
    found_ids = [cal.id for cal in calendars]
    skipped_ids = [cid for cid in id_list if cid not in found_ids]
    
    if format.lower() == "json":
        # Build JSON Response
        data = {
            "exported_at": datetime.now().isoformat(),
            "timelines": [],
            "skipped_ids": skipped_ids
        }
        for cal in calendars:
            cal_data = {
                "id": cal.id,
                "name": cal.name,
                "color": cal.color,
                "description": cal.description,
                "events": []
            }
            for ev in cal.events:
                cal_data["events"].append({
                    "id": ev.id,
                    "title": ev.title,
                    "start_time": ev.start_time,
                    "end_time": ev.end_time,
                    "is_recurring": ev.is_recurring,
                    "recurrence_days": ev.recurrence_days,
                    "recurrence_end": ev.recurrence_end,
                    "description": ev.description,
                    "unique_description": ev.unique_description
                })
            data["timelines"].append(cal_data)
        return JSONResponse(content=data)
        
    elif format.lower() == "ics":
        # Build ICS Response without external libraries
        lines = []
        lines.append("BEGIN:VCALENDAR")
        lines.append("VERSION:2.0")
        lines.append("PRODID:-//Loom Assistant//EN")
        
        day_map = {"0": "SU", "1": "MO", "2": "TU", "3": "WE", "4": "TH", "5": "FR", "6": "SA"}
        
        for cal in calendars:
            for ev in cal.events:
                lines.append("BEGIN:VEVENT")
                lines.append(f"UID:loom-{ev.id}@loom-assist")
                
                # FUTURE IMPROVEMENT: Proper timezone support (Z or specific TZID). Currently treating as floating local time.
                start_dt = ev.start_time.replace("-", "").replace(":", "")[:15]
                end_dt = ev.end_time.replace("-", "").replace(":", "")[:15]
                lines.append(f"DTSTART:{start_dt}")
                lines.append(f"DTEND:{end_dt}")
                
                summary = (ev.title or "Untitled").replace("\n", " ").replace(",", "\\,")
                lines.append(f"SUMMARY:{summary}")
                
                desc_parts = []
                if ev.description: desc_parts.append(ev.description)
                if ev.unique_description: 
                    if desc_parts: desc_parts.append("---")
                    desc_parts.append(ev.unique_description)
                
                if desc_parts:
                    full_desc = "\\n".join(desc_parts).replace("\n", "\\n").replace(",", "\\,")
                    lines.append(f"DESCRIPTION:{full_desc}")
                    
                lines.append(f"X-LOOM-CALENDAR:{cal.name}")
                
                if ev.is_recurring and ev.recurrence_days:
                    days = [day_map.get(d.strip()) for d in ev.recurrence_days.split(",") if d.strip() in day_map]
                    if days:
                        rrule = f"FREQ=WEEKLY;BYDAY={','.join(days)}"
                        if ev.recurrence_end:
                            until_dt = ev.recurrence_end.replace("-", "").replace(":", "")[:8] + "T235959"
                            rrule += f";UNTIL={until_dt}"
                        lines.append(f"RRULE:{rrule}")
                        
                lines.append("END:VEVENT")
                
        lines.append("END:VCALENDAR")
        
        # Mandatory CRLF line endings for standard ICS
        ics_string = "\r\n".join(lines) + "\r\n"
        return Response(
            content=ics_string, 
            media_type="text/calendar", 
            headers={"Content-Disposition": 'attachment; filename="loom-export.ics"'}
        )
    else:
        raise HTTPException(status_code=400, detail={"error": {"code": "export_failed", "detail": "Format must be json or ics."}})

def extract_syllabus_events(text: str) -> list:
    today = datetime.now().strftime("%Y-%m-%d")
    prompt = f"""
    Today is {today}. Extract all assignments, exams, and due dates from this syllabus text. 
    Return ONLY a JSON array of objects with 'title' and 'date' (YYYY-MM-DD format). Do not include preamble or markdown formatting.
    Syllabus text: {text}
    """
    
    try:
        response = ollama.chat(model='llama3.2', messages=[{'role': 'user', 'content': prompt}])
        content = response['message']['content'].strip()
        match = re.search(r'\[.*\]', content, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        return []
    except Exception as e:
        logger.error(f"Syllabus LLM extraction error: {str(e)}")
        return []

@app.post("/documents/extract-syllabus/")
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

def generate_event_uid(title: str, date_str: str) -> str:
    raw = f"{title.strip().lower()}{date_str[:10]}"
    return 'loom-pdf-' + hashlib.md5(raw.encode()).hexdigest()[:16]

@app.post("/documents/save-approved-events/")
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
            db.flush() # Populate ID
            created_ids.append(new_event.id)
            events_added += 1
            
        db.commit()
        return {
            "status": "success", 
            "events_added": events_added, 
            "events_skipped": events_skipped,
            "event_ids": created_ids
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
# ==========================================
# DATABASE ADMIN ROUTES
# ==========================================
# NOTE: This endpoint has no authentication — it is designed for local desktop use only.
# Do not expose this endpoint over a network without adding auth.
@app.get('/admin/backup')
def backup_database():
    db_path = os.environ.get('LOOM_DB_PATH', './loom.sqlite3')
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404,
            detail={'error': {'code': 'db_not_found', 'detail': 'Database file not found.'}})
    with open(db_path, 'rb') as f:
        content = f.read()
    return Response(content=content, media_type='application/octet-stream',
        headers={'Content-Disposition': 'attachment; filename=loom-backup.sqlite3'})

SQLITE_HEADER = b'SQLite format 3\x00'

@app.post('/admin/restore')
async def restore_database(file: UploadFile = File(...)):
    content = await file.read()
    # Validate SQLite magic bytes
    if len(content) < 16 or content[:16] != SQLITE_HEADER:
        raise HTTPException(status_code=400,
            detail={'error': {'code': 'invalid_db_file',
                              'detail': 'File is not a valid SQLite database.'}})
    
    # Write to temp and verify it opens
    with tempfile.NamedTemporaryFile(delete=False, suffix='.sqlite3') as tmp:
        tmp.write(content)
        tmp_path = tmp.name
        
    try:
        from sqlalchemy import create_engine as ce
        test_eng = ce(f'sqlite:///{tmp_path}')
        with test_eng.connect() as conn:
            conn.execute(text('SELECT 1'))
        test_eng.dispose()
    except Exception:
        os.remove(tmp_path)
        raise HTTPException(status_code=400,
            detail={'error': {'code': 'corrupt_db', 'detail': 'Backup file is corrupt.'}})
    
    # Replace live DB
    db_path = os.environ.get('LOOM_DB_PATH', './loom.sqlite3')
    engine.dispose()  # Close all pooled connections before replacing the file
    shutil.move(tmp_path, db_path)
    
    return {'status': 'success', 'message': 'Database restored. Reload your data.'}
# ==========================================
# INTENT ENGINE
# ==========================================
def extract_intent(sentence: str):
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    prompt = f"..." # Prompt content preserved

    try:
        response = ollama.chat(model='llama3.2', messages=[
            {'role': 'user', 'content': prompt}
        ])
        content = response['message']['content'].strip()
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            content = match.group(0)
        return json.loads(content)
    except Exception as e:
        logger.error(f"LLM extraction error: {str(e)}")
        # If LLM fails, we return a parse_error structure for execute_intent to handle
        return {"action": "parse_error", "detail": str(e)}

def execute_intent(intent: dict, db: Session):
    action = intent.get("action")
    params = intent.get("parameters", {})
    
    if action == "schedule_event":
        # Change the final return of execute_intent to:
        return {"message": f"Successfully scheduled {event_data['title']}", "event_id": db_event.id}
    
    # Structured error for unknown intent 
    return {"error": {"code": "unknown_intent", "detail": f"Action '{action}' not supported."}}

# ==========================================
# QUICK-ADD INTENT ROUTE
# ==========================================
class IntentRequest(BaseModel):
    text: str
    calendar_id: Optional[int] = None

@app.post('/intent')
def process_intent(request: IntentRequest, db: Session = Depends(get_db)):
    try:
        intent_data = extract_intent(request.text)
        result = execute_intent(intent_data, db)
        # Change the return of process_intent to:
        return {"status": "success", "result": result["message"], "event_id": result["event_id"], "intent": intent_data}
    except Exception as e:
        import logging
        logging.error(f'Intent processing failed: {e}')
        raise HTTPException(status_code=500,
            detail={'error': {'code': 'intent_failed', 'detail': str(e)}})

# ==========================================
# EVENT TEMPLATE ROUTES (M3)
# ==========================================

@app.post("/templates/", response_model=models.EventTemplateRead)
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

@app.get("/templates/", response_model=list[models.EventTemplateRead])
def list_templates(db: Session = Depends(get_db)):
    return db.query(models.EventTemplate).all()

@app.delete("/templates/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db)):
    db_template = db.query(models.EventTemplate).filter(models.EventTemplate.id == template_id).first()
    if not db_template:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "template_not_found", "detail": f"Template {template_id} does not exist."}})
    db.delete(db_template)
    db.commit()
    return {"status": "success"}

# ==========================================
# SCHEDULE WELLNESS ANALYSIS (M2)
# ==========================================

class ScheduleEvent(BaseModel):
    title: str
    start_time: str
    end_time: str

class ScheduleAnalyzeRequest(BaseModel):
    events: list[ScheduleEvent]

@app.post("/schedule/analyze")
def analyze_schedule(request: ScheduleAnalyzeRequest):
    try:
        sorted_events = sorted(request.events, key=lambda e: e.start_time)
        schedule_text = "\n".join(
            f"{e.start_time[11:16]}-{e.end_time[11:16]}: {e.title}"
            for e in sorted_events
        )
        prompt = (
            "You are a wellness assistant reviewing a daily schedule.\n"
            f"Schedule:\n{schedule_text}\n"
            "Identify any of these issues (only if clearly present):\n\n"
            "No meal break (no 30+ min gap between 11am-2pm)\n"
            "Back-to-back events with no buffer (events end and start within 5 minutes)\n"
            "No commute time before first event if it starts before 9am\n"
            "No break in 4+ consecutive hours of events\n\n"
            "Respond ONLY as a JSON array of short warning strings (max 12 words each).\n"
            "If no issues found, respond with: []\n"
            'Example: ["No lunch break planned between 11am and 2pm"]'
        )
        response = ollama.chat(model='llama3.2', messages=[{'role': 'user', 'content': prompt}])
        content = response['message']['content'].strip()
        match = re.search(r'\[.*\]', content, re.DOTALL)
        if match:
            warnings = json.loads(match.group(0))
            return {"warnings": warnings}
        return {"warnings": []}
    except Exception as e:
        logger.warning(f"Schedule analysis failed: {str(e)}")
        return {"warnings": []}

# ==========================================
# TASK ROUTES (replaces M1 Todo)
# ==========================================

class TaskCreate(BaseModel):
    event_id: int
    note: Optional[str] = None

class TaskUpdate(BaseModel):
    is_complete: bool
    note: Optional[str] = None

@app.post("/tasks/", response_model=models.TaskRead)
def create_task(task: TaskCreate, db: Session = Depends(get_db)):
    # Idempotent — return existing task if this event is already pinned
    existing = db.query(models.Task).filter(models.Task.event_id == task.event_id).first()
    if existing:
        return existing
    try:
        db_task = models.Task(
            event_id=task.event_id,
            note=task.note,
            is_complete=False,
            added_at=datetime.now().isoformat()
        )
        db.add(db_task)
        db.commit()
        db.refresh(db_task)
        return db_task
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400,
            detail={"error": {"code": "task_create_failed", "detail": str(e)}})

@app.get("/tasks/", response_model=list[models.TaskRead])
def list_tasks(db: Session = Depends(get_db)):
    return db.query(models.Task).all()

@app.put("/tasks/{task_id}", response_model=models.TaskRead)
def update_task(task_id: int, task: TaskUpdate, db: Session = Depends(get_db)):
    db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "task_not_found", "detail": f"Task {task_id} does not exist."}})
    db_task.is_complete = task.is_complete
    db_task.note = task.note
    db.commit()
    db.refresh(db_task)
    return db_task

@app.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "task_not_found", "detail": f"Task {task_id} does not exist."}})
    db.delete(db_task)
    db.commit()
    return {"status": "success"}

# ==========================================
# TRANSCRIPTION ROUTE
# ==========================================

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...), db: Session = Depends(get_db)):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:
        temp_audio.write(await file.read())
        temp_file_path = temp_audio.name

    try:
        segments, info = model.transcribe(temp_file_path, beam_size=5)
        raw_text = "".join([segment.text for segment in segments]).strip()
        sentences = [sentence.strip() + "." for sentence in raw_text.split(".") if sentence.strip()]
        
        intents = []
        execution_results = []
        
        for sentence in sentences:
            try:
                intent_data = extract_intent(sentence)
                if "error" in intent_data:
                     execution_results.append(intent_data)
                else:
                    intents.append({"sentence": sentence, "intent": intent_data})
                    result_msg = execute_intent(intent_data, db)
                    execution_results.append(result_msg)
            except Exception as e:
                logger.error(f"Ollama unreachable: {str(e)}")
                execution_results.append({"error": {"code": "llm_unavailable", "detail": "Local LLM engine is offline."}})
        
        return {
            "status": "success",
            "raw_text": raw_text,
            "parsed_data": intents,
            "execution_results": execution_results
        }
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)


# ============================================================
# AVAILABILITY REQUEST ROUTES
# ============================================================

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


@app.post("/availability")
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


@app.get("/availability/{token}", response_model=models.AvailabilityRequestRead)
def get_availability(token: str, db: Session = Depends(get_db)):
    req = db.query(models.AvailabilityRequest).filter(
        models.AvailabilityRequest.token == token
    ).first()
    if not req:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "not_found", "detail": "Availability request not found."}})
    _check_availability_expiry(req)
    return req


@app.post("/availability/{token}/confirm")
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


@app.post("/availability/{token}/amend")
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


@app.post("/availability/{token}/respond-amendment")
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


@app.get("/availability/{token}/view", response_class=HTMLResponse)
def view_availability(token: str, db: Session = Depends(get_db)):
    req = db.query(models.AvailabilityRequest).filter(
        models.AvailabilityRequest.token == token
    ).first()
    if not req:
        return HTMLResponse(content=_404_HTML, status_code=404)
    html_path = Path(__file__).parent / "availability_receiver.html"
    html = html_path.read_text(encoding="utf-8").replace("{{ token }}", token)
    return HTMLResponse(content=html)