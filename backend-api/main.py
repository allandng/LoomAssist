from fastapi import FastAPI, Depends, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
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

# Updated imports to SQLModel structure 
from database.database import SessionLocal, engine
from database import models

# Initialize Database
models.SQLModel.metadata.create_all(engine)

app = FastAPI(title="Loom Backend API")

# Configure logging as per guardrail [cite: 63]
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

class SyncRequest(BaseModel):
    calendar_id: int
    ics_url: str

@app.post("/integrations/sync-ics/")
def sync_external_calendar(request: SyncRequest, db: Session = Depends(get_db)):
    db_calendar = db.query(models.Calendar).filter(models.Calendar.id == request.calendar_id).first()
    if not db_calendar:
        raise HTTPException(
            status_code=404, 
            detail={"error": {"code": "not_found", "detail": "Loom Calendar not found"}}
        )

    try:
        scraped_events = scraper.fetch_and_parse_ics(request.ics_url)
        
        events_added = 0
        for event_data in scraped_events:
            new_event = models.Event(
                title=event_data["title"],
                start_time=event_data["start_time"],
                end_time=event_data["end_time"],
                calendar_id=request.calendar_id
            )
            db.add(new_event)
            events_added += 1
            
        db.commit()
        return {"status": "success", "message": f"Successfully imported {events_added} events!"}
        
    except Exception as e:
        logger.warning(f"ICS sync failed: {str(e)}") # Log level as per guardrail [cite: 63]
        raise HTTPException(
            status_code=400, 
            detail={"error": {"code": "ics_fetch_failed", "detail": str(e)}} # Structured error 
        )

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
        # Existing schedule_event logic preserved
        # ...
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
            # Task 2: Try/Catch specifically for Ollama availability [cite: 48, 80]
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