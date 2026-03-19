from typing import List, Optional
from sqlmodel import SQLModel, Field, Relationship

# --- EVENT MODELS ---

class EventBase(SQLModel):
    title: str = Field(index=True)
    start_time: str
    end_time: str
    calendar_id: int = Field(foreign_key="calendar.id")

class Event(EventBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    
    # Establishes the relationship back to the Calendar model
    calendar: Optional["Calendar"] = Relationship(back_populates="events")

class EventRead(EventBase):
    id: int

# --- CALENDAR MODELS ---

class CalendarBase(SQLModel):
    name: str = Field(index=True)
    description: Optional[str] = None

class Calendar(CalendarBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    
    # A single calendar can have many events [cite: 20]
    events: List["Event"] = Relationship(back_populates="calendar")

class CalendarRead(CalendarBase):
    id: int
    events: List[EventRead] = []