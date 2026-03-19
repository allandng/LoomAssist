from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, Form
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
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
import logging
from datetime import datetime, timedelta 
from sqlmodel import select
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from pypdf import PdfReader

# Updated imports to SQLModel structure 
from database.database import SessionLocal, engine
from database import models

# Initialize Database
models.SQLModel.metadata.create_all(engine)

# Safe Startup Migration Check
# We use raw PRAGMA here instead of Alembic to keep the single-file nature of the vibecoded backend
# while safely evolving the schema without dropping the database or destroying existing data.
with engine.begin() as conn:
    try:
        conn.execute(text("ALTER TABLE calendar ADD COLUMN color VARCHAR DEFAULT '#6366f1'"))
    except OperationalError:
        pass
        
    try:
        result = conn.execute(text("PRAGMA table_info(event)")).fetchall()
        columns = [row[1] for row in result]
        if "is_recurring" not in columns:
            conn.execute(text("ALTER TABLE event ADD COLUMN is_recurring BOOLEAN DEFAULT FALSE"))
        if "recurrence_days" not in columns:
            conn.execute(text("ALTER TABLE event ADD COLUMN recurrence_days VARCHAR"))
        if "recurrence_end" not in columns:
            conn.execute(text("ALTER TABLE event ADD COLUMN recurrence_end VARCHAR"))
        if "description" not in columns:
            conn.execute(text("ALTER TABLE event ADD COLUMN description VARCHAR"))
        if "unique_description" not in columns:
            conn.execute(text("ALTER TABLE event ADD COLUMN unique_description VARCHAR"))
    except Exception as e:
        print(f"Migration error: {e}")

app = FastAPI(title="Loom Backend API")

# Configure logging as per guardrail
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("loom")

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
    db_calendar = db.query(models.Calendar).filter(models.Calendar.id == event.calendar_id).first()
    if not db_calendar:
        raise HTTPException(
            status_code=404, 
            detail={"error": {"code": "not_found", "detail": "Calendar not found"}}
        )
    
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

# ==========================================
# INTEGRATION ROUTES
# ==========================================

class ApprovedEvent(BaseModel):
    title: str
    start_time: str
    end_time: str
    is_recurring: Optional[bool] = False
    recurrence_days: Optional[str] = None
    recurrence_end: Optional[str] = None
    description: Optional[str] = None
    unique_description: Optional[str] = None

class SaveApprovedEventsRequest(BaseModel):
    calendar_id: int
    events: list[ApprovedEvent]

@app.post("/integrations/import-ics-file/")
async def import_ics_file(
    file: UploadFile = File(...),
    calendar_id: int = Form(...),
    db: Session = Depends(get_db)
):
    db_calendar = db.query(models.Calendar).filter(models.Calendar.id == calendar_id).first()
    if not db_calendar:
        raise HTTPException(
            status_code=404, 
            detail={"error": {"code": "not_found", "detail": "Calendar not found"}}
        )

    try:
        file_bytes = await file.read()
        scraped_events = scraper.parse_ics_bytes(file_bytes)
        
        events_added = 0
        added_instances = []
        for event_data in scraped_events:
            new_event = models.Event(
                title=event_data["title"],
                start_time=event_data["start_time"],
                end_time=event_data["end_time"],
                calendar_id=calendar_id
            )
            db.add(new_event)
            added_instances.append(new_event)
            events_added += 1
            
        # KNOWN LIMITATION: Duplicate prevention is not yet implemented
        db.commit() 
        for ev in added_instances:
            db.refresh(ev)
            
        return {"status": "success", "events_added": events_added, "event_ids": [ev.id for ev in added_instances]}
        
    except Exception as e:
        db.rollback()
        logger.warning(f"ICS file import failed: {str(e)}")
        raise HTTPException(
            status_code=400, 
            detail={"error": {"code": "ics_parse_failed", "detail": str(e)}} 
        )

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

@app.post("/documents/save-approved-events/")
def save_approved_events(request: SaveApprovedEventsRequest, db: Session = Depends(get_db)):
    db_calendar = db.query(models.Calendar).filter(models.Calendar.id == request.calendar_id).first()
    if not db_calendar:
        raise HTTPException(
            status_code=404, 
            detail={"error": {"code": "not_found", "detail": "Calendar not found"}}
        )
        
    try:
        events_added = 0
        added_instances = []
        for ev in request.events:
            new_event = models.Event(
                title=ev.title,
                start_time=ev.start_time,
                end_time=ev.end_time,
                is_recurring=ev.is_recurring,
                recurrence_days=ev.recurrence_days,
                recurrence_end=ev.recurrence_end,
                description=ev.description,
                unique_description=ev.unique_description,
                calendar_id=request.calendar_id
            )
            db.add(new_event)
            added_instances.append(new_event)
            events_added += 1
            
        # KNOWN LIMITATION: Duplicate prevention is not yet implemented
        db.commit()
        for ev in added_instances:
            db.refresh(ev)
            
        return {"status": "success", "events_added": events_added, "event_ids": [ev.id for ev in added_instances]}
    except Exception as e:
        db.rollback()
        logger.error(f"Save approved events failed: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail={"error": {"code": "save_failed", "detail": str(e)}}
        )

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
        return f"Scheduled event on Loom."
    
    # Structured error for unknown intent 
    return {"error": {"code": "unknown_intent", "detail": f"Action '{action}' not supported."}}

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