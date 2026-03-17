from pydantic import BaseModel
from typing import List, Optional

# --- EVENT SCHEMAS ---
class EventBase(BaseModel):
    title: str
    start_time: str
    end_time: str
    calendar_id: int

class EventCreate(EventBase):
    pass

class Event(EventBase):
    id: int

    class Config:
        from_attributes = True

# --- CALENDAR SCHEMAS ---
class CalendarBase(BaseModel):
    name: str
    description: Optional[str] = None

class CalendarCreate(CalendarBase):
    pass

class Calendar(CalendarBase):
    id: int
    events: List[Event] = []

    class Config:
        from_attributes = True