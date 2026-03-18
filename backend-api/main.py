from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel # Add this to your existing FastAPI imports
from services import scraper   # Import our new logic

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