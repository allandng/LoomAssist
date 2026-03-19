from fastapi import FastAPI, Depends, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel # Add this to your existing FastAPI imports
from services import scraper   # Import our new logic
import asyncio
from faster_whisper import WhisperModel
import os
import tempfile
import ollama # Add this for the local LLM intent engine
import json   # Add this to parse the LLM's output
import re     # Add this to clean chatty LLM output
from datetime import datetime, timedelta # Add this to handle event scheduling times

from database.database import SessionLocal, engine
from database import models, schemas

# Create tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Loom Backend API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load model globally so it only initializes once on startup.
# "base.en" is a great balance of speed and accuracy for Mac CPUs.
model = WhisperModel("base.en", device="cpu", compute_type="int8")

# Dependency: This opens a database connection for a request, then safely closes it
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
# CALENDAR ROUTES (The Shared Timelines)
# ==========================================

@app.post("/calendars/", response_model=schemas.Calendar)
def create_calendar(calendar: schemas.CalendarCreate, db: Session = Depends(get_db)):
    db_calendar = models.Calendar(name=calendar.name, description=calendar.description)
    db.add(db_calendar)
    db.commit()
    db.refresh(db_calendar)
    return db_calendar

@app.get("/calendars/", response_model=list[schemas.Calendar])
def read_calendars(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(models.Calendar).offset(skip).limit(limit).all()

# ==========================================
# EVENT ROUTES
# ==========================================

@app.post("/events/", response_model=schemas.Event)
def create_event(event: schemas.EventCreate, db: Session = Depends(get_db)):
    # First, verify the timeline/calendar actually exists
    db_calendar = db.query(models.Calendar).filter(models.Calendar.id == event.calendar_id).first()
    if not db_calendar:
        raise HTTPException(status_code=404, detail="Calendar not found")
    
    # Save the event
    db_event = models.Event(**event.model_dump())
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event

@app.get("/events/", response_model=list[schemas.Event])
def read_events(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(models.Event).offset(skip).limit(limit).all()

@app.put("/events/{event_id}", response_model=schemas.Event)
def update_event(event_id: int, event: schemas.EventCreate, db: Session = Depends(get_db)):
    db_event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not db_event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    for key, value in event.model_dump().items():
        setattr(db_event, key, value)
        
    db.commit()
    db.refresh(db_event)
    return db_event

@app.delete("/events/{event_id}")
def delete_event(event_id: int, db: Session = Depends(get_db)):
    db_event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not db_event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    db.delete(db_event)
    db.commit()
    return {"status": "success", "message": "Event deleted"}


# ==========================================
# INTEGRATION ROUTES (Canvas / Classroom)
# ==========================================

class SyncRequest(BaseModel):
    calendar_id: int
    ics_url: str

@app.post("/integrations/sync-ics/")
def sync_external_calendar(request: SyncRequest, db: Session = Depends(get_db)):
    # 1. Verify the Loom calendar exists
    db_calendar = db.query(models.Calendar).filter(models.Calendar.id == request.calendar_id).first()
    if not db_calendar:
        raise HTTPException(status_code=404, detail="Loom Calendar not found")

    try:
        # 2. Fetch and parse the external data using our service
        scraped_events = scraper.fetch_and_parse_ics(request.ics_url)
        
        # 3. Save each scraped event to the database
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
        return {"status": "success", "message": f"Successfully imported {events_added} events from Canvas/Classroom!"}
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    

@app.delete("/calendars/{calendar_id}")
def delete_calendar(calendar_id: int, db: Session = Depends(get_db)):
    db_calendar = db.query(models.Calendar).filter(models.Calendar.id == calendar_id).first()
    
    if not db_calendar:
        raise HTTPException(status_code=404, detail="Calendar not found")
    
    # Delete associated events to prevent orphaned data
    db.query(models.Event).filter(models.Event.calendar_id == calendar_id).delete()
    
    # Delete the calendar itself
    db.delete(db_calendar)
    db.commit()
    
    return {"status": "success", "message": f"Calendar {calendar_id} and its events deleted."}

# ==========================================
# INTENT ENGINE (Ollama LLM)
# ==========================================
# Helper function to send a sentence to the local LLM and ask for JSON back
def extract_intent(sentence: str):
    # Get current date and time so the LLM knows what "tomorrow" means
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    prompt = f"""
    You are an intent extraction engine. Parse the following command into JSON.
    The current date and time is: {current_time}.
    Available actions: "schedule_event", "delete_event", "search_flights", "general_query".
    Command: "{sentence}"
    If the action is "schedule_event", provide these parameters: "title" (string), "start_time" (ISO 8601 string, calculate using the current time), "end_time" (ISO 8601 string, calculate using the current time).
    Output ONLY valid JSON in this format: {{"action": "...", "parameters": {{...}}}}
    """
    
    response = ollama.chat(model='llama3.2', messages=[
        {'role': 'user', 'content': prompt}
    ])
    
    try:
        content = response['message']['content'].strip()
        # Find the first '{' and the last '}' to extract only the JSON object
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            content = match.group(0)
            
        return json.loads(content)
    except json.JSONDecodeError:
        return {"action": "parse_error", "raw_output": response['message']['content']}
    
# Logic to execute the intent and modify the database
def execute_intent(intent: dict, db: Session):
    action = intent.get("action")
    params = intent.get("parameters", {})
    
    if action == "schedule_event":
        default_cal = db.query(models.Calendar).filter(models.Calendar.name == "Loom Voice Assistant").first()
        if not default_cal:
            default_cal = models.Calendar(name="Loom Voice Assistant", description="Events auto-created by voice commands.")
            db.add(default_cal)
            db.commit()
            db.refresh(default_cal)

        # Bulletproof fallback for explicit nulls from the LLM
        title = params.get("title")
        if not title:
            title = "New Voice Event"
            
        start_time = params.get("start_time")
        if not start_time:
            start_time = datetime.now().isoformat()
            
        end_time = params.get("end_time")
        if not end_time:
            end_time = (datetime.now() + timedelta(hours=1)).isoformat()

        new_event = models.Event(
            title=title,
            start_time=start_time,
            end_time=end_time,
            calendar_id=default_cal.id
        )
        db.add(new_event)
        db.commit()
        return f"Scheduled '{title}' on your Loom Voice Assistant calendar."
    
    return f"Action '{action}' recognized, but execution logic is not fully built yet."

# ==========================================
# TRANSCRIPTION ROUTE (Loom STT)
# ==========================================

# Add this new route to handle the audio file:
@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...), db: Session = Depends(get_db)): # Added db injection here
    # Create a temporary file to store the audio chunk for the model
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:
        # Read the file asynchronously to prevent blocking the API
        temp_audio.write(await file.read())
        temp_file_path = temp_audio.name

    try:
        # Run local transcription
        segments, info = model.transcribe(temp_file_path, beam_size=5)
        
        # Stitch the generator segments into a single string
        raw_text = "".join([segment.text for segment in segments]).strip()
        
        # Enforcing the Real-time Modularity rule: Parse sentence-by-sentence
        sentences = [sentence.strip() + "." for sentence in raw_text.split(".") if sentence.strip()]
        
        intents = []
        execution_results = []
        
        for sentence in sentences:
            # 1. Ask Ollama what the intent is
            intent_data = extract_intent(sentence)
            intents.append({"sentence": sentence, "intent": intent_data})
            
            # 2. Automatically execute the database action based on the intent
            result_msg = execute_intent(intent_data, db)
            if result_msg:
                execution_results.append(result_msg)
        
        print(f"Received audio: {file.filename}")
        print(f"Transcription: {raw_text}")
        print(f"Parsed Intents: {json.dumps(intents, indent=2)}")
        print(f"Execution Results: {execution_results}")
        
        return {
            "status": "success",
            "raw_text": raw_text,
            "parsed_data": intents,
            "execution_results": execution_results
        }
    finally:
        # Clean up the temporary file from your Mac's drive
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)