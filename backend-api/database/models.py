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

    # Duration analytics — actual clock-in/out timestamps
    actual_start: Optional[str] = Field(default=None)
    actual_end:   Optional[str] = Field(default=None)

    # Location and travel time
    location: Optional[str] = Field(default=None)
    travel_time_minutes: Optional[int] = Field(default=None)

    # Phase 1: Adaptive Reminders — tracks whether reminder was user-set or inferred
    reminder_source: Optional[str] = Field(default="none")  # "user" | "inferred" | "none"

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
    # v2.0 Kanban fields
    status: Optional[str] = Field(default="backlog")    # backlog | doing | done
    priority: Optional[str] = Field(default="low")      # high | med | low
    due_date: Optional[str] = Field(default=None)       # ISO date string, nullable

class TaskRead(SQLModel):
    id: int
    event_id: int
    is_complete: bool
    note: Optional[str]
    added_at: Optional[str]
    status: Optional[str]
    priority: Optional[str]
    due_date: Optional[str]

# --- AVAILABILITY REQUEST MODELS ---
class AvailabilityRequest(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    token: str = Field(unique=True, index=True)
    sender_name: str
    duration_minutes: int = Field(default=60)
    slots: str                              # JSON: [{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM"}, ...]
    status: str = Field(default="pending")  # pending | confirmed | amended | declined
    confirmed_slot: Optional[str] = None    # JSON object, null until confirmed
    amendment_slot: Optional[str] = None    # JSON object, null until proposed
    receiver_name: Optional[str] = None
    created_at: str
    expires_at: str

class AvailabilityRequestRead(SQLModel):
    id: int
    token: str
    sender_name: str
    duration_minutes: int
    slots: str
    status: str
    confirmed_slot: Optional[str]
    amendment_slot: Optional[str]
    receiver_name: Optional[str]
    created_at: str
    expires_at: str

# --- TIME BLOCK TEMPLATE MODELS ---
class TimeBlockTemplate(SQLModel, table=True):
    __tablename__ = "timeblockstemplate"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: str = Field(default="")
    created_at: str = Field(default="")
    blocks_json: str = Field(default="[]")
    # blocks_json shape: [{"title": str, "day_of_week": int (1=Mon…7=Sun),
    #                       "start_time": "HH:MM", "end_time": "HH:MM", "calendar_id": int}]

class TimeBlockTemplateRead(SQLModel):
    id: int
    name: str
    description: str
    created_at: str
    blocks_json: str