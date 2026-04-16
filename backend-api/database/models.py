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

    # H2: All-day / multi-day span
    is_all_day: Optional[bool] = Field(default=False)

    # H4: Recurring event exceptions — comma-separated YYYY-MM-DD dates to skip
    skipped_dates: Optional[str] = Field(default=None)

    # H5: Per-day different start/end times — JSON string {"1":["09:00","11:00"],...}
    per_day_times: Optional[str] = Field(default=None)

    # L3: Task checklist — JSON string [{"text":"...", "done":false}, ...]
    checklist: Optional[str] = Field(default=None)

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

# --- EVENT TEMPLATE MODELS (M3) ---
class EventTemplate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)        # User label e.g. "Weekly Standup"
    title: str                            # Pre-filled event title
    description: Optional[str] = None
    duration_minutes: int = Field(default=60)
    is_recurring: bool = Field(default=False)
    recurrence_days: Optional[str] = None
    calendar_id: Optional[int] = Field(default=None)  # Optional default timeline

class EventTemplateRead(SQLModel):
    id: int
    name: str
    title: str
    description: Optional[str]
    duration_minutes: int
    is_recurring: bool
    recurrence_days: Optional[str]
    calendar_id: Optional[int]

class EventTemplateCreate(SQLModel):
    name: str
    title: str
    description: Optional[str] = None
    duration_minutes: int = 60
    is_recurring: bool = False
    recurrence_days: Optional[str] = None
    calendar_id: Optional[int] = None

# --- TASK MODELS (replaces M1 Todo) ---
class Task(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    event_id: int = Field(index=True)
    # No FK constraint — avoids cascade issues when events are deleted
    is_complete: bool = Field(default=False)
    note: Optional[str] = Field(default=None)
    added_at: Optional[str] = Field(default=None)  # ISO datetime string

class TaskRead(SQLModel):
    id: int
    event_id: int
    is_complete: bool
    note: Optional[str]
    added_at: Optional[str]