from typing import List, Optional
from sqlmodel import SQLModel, Field, Relationship

# --- EVENT MODELS ---
class EventBase(SQLModel):
    title: str = Field(index=True)
    start_time: str
    end_time: str
    calendar_id: int = Field(foreign_key="calendar.id")
    
    # Recurring Event Fields
    is_recurring: Optional[bool] = Field(default=False)
    recurrence_days: Optional[str] = Field(default=None) # e.g., "1,3" for Mon/Wed
    recurrence_end: Optional[str] = Field(default=None)
    
    # Description Fields
    description: Optional[str] = Field(default=None)
    unique_description: Optional[str] = Field(default=None)
    
    # Reminder Field
    reminder_minutes: Optional[int] = Field(default=None)

    # Duplicate Prevention Field
    external_uid: Optional[str] = Field(default=None, index=True)

    # NEW: Timezone Handling
    timezone: Optional[str] = Field(default='local')

class Event(EventBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    calendar: Optional["Calendar"] = Relationship(back_populates="events")

class EventRead(EventBase):
    id: int

# --- CALENDAR MODELS ---
class CalendarBase(SQLModel):
    name: str = Field(index=True)
    description: Optional[str] = None
    color: Optional[str] = Field(default="#6366f1") 

class Calendar(CalendarBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    events: List["Event"] = Relationship(back_populates="calendar")

class CalendarRead(CalendarBase):
    id: int
    events: List[EventRead] = []