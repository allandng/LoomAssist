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

    # "Missed": opt-in marker. ISO timestamp set when the user marks the event
    # as missed via the EventEditorModal footer; null otherwise. Source of
    # truth for GET /events/missed. Auto-cleared by the editor on a normal save.
    missed_at: Optional[str] = Field(default=None)

    # Location and travel time
    location: Optional[str] = Field(default=None)
    travel_time_minutes: Optional[int] = Field(default=None)

    # Class-Prep Auto-Blocking — type qualifies events for prep buffers
    event_type:   Optional[str] = Field(default=None)   # "lecture" | "lab" | "office_hours" | "other"
    prep_minutes: Optional[int] = Field(default=None)

    # Phase 1: Adaptive Reminders — tracks whether reminder was user-set or inferred
    reminder_source: Optional[str] = Field(default="none")  # "user" | "inferred" | "none"

    # Phase 10: Cross-Event Dependencies
    depends_on_event_id: Optional[int] = Field(default=None)
    depends_offset_minutes: Optional[int] = Field(default=None)

    # Phase 14c: Sync metadata
    last_modified: Optional[str] = Field(default=None)   # ISO datetime, updated on every write
    deleted_at: Optional[str] = Field(default=None)      # tombstone — set instead of DELETE

    # Phase v3.0: Cloud sync metadata
    # connection_calendar_id: null = local-only event. Populated when an event
    # came from sync OR was pushed to a provider.
    connection_calendar_id: Optional[str] = Field(default=None, index=True)
    # external_id: provider's stable id (Google: event.id; CalDAV: resource href).
    # UNIQUE INDEX (connection_calendar_id, external_id) WHERE external_id IS NOT NULL.
    # Distinct from external_uid which stays ICS-only (design doc §3 callout / R7).
    external_id: Optional[str] = Field(default=None, index=True)
    external_etag: Optional[str] = Field(default=None)   # provider concurrency token
    last_synced_at: Optional[str] = Field(default=None)  # drives the freshness pill

    # Procrastination Radar: links study-block (or future focus-session) events
    # back to the originating Assignment so the radar can detect "no study time blocked."
    assignment_id: Optional[int] = Field(default=None, index=True)

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
    # Phase v3.0: True for timelines auto-created during connection setup.
    # Drives the disconnect-confirm copy.
    created_via_sync: Optional[bool] = Field(default=False)
    # Future-features 3A: course timelines — drives Up Next deadline detection,
    # the Semester at a Glance view, and the grade tracker.
    is_course: Optional[bool] = Field(default=False)
    course_code: Optional[str] = Field(default=None)
    term_start: Optional[str] = Field(default=None)  # ISO date
    term_end:   Optional[str] = Field(default=None)  # ISO date

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
    # Phase 7: Time-Blocking Autopilot
    estimated_minutes: Optional[int] = Field(default=None)
    deadline: Optional[str] = Field(default=None)       # ISO date string, nullable
    # Future-features 3C: grade tracker on tasks
    grade:  Optional[float] = Field(default=None)
    weight: Optional[float] = Field(default=None)
    # Phase 14c: Sync metadata
    last_modified: Optional[str] = Field(default=None)
    deleted_at: Optional[str] = Field(default=None)

class TaskRead(SQLModel):
    id: int
    event_id: int
    is_complete: bool
    note: Optional[str]
    added_at: Optional[str]
    status: Optional[str]
    priority: Optional[str]
    due_date: Optional[str]
    estimated_minutes: Optional[int]
    deadline: Optional[str]
    grade:  Optional[float]
    weight: Optional[float]

# --- HABIT MODELS (4A) ---
class Habit(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    color: str = Field(default="#6366f1")
    target_per_week: int = Field(default=7)
    created_at: str

class HabitRead(SQLModel):
    id: int
    name: str
    color: str
    target_per_week: int
    created_at: str

class HabitEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    habit_id: int = Field(index=True)
    date: str       # ISO date YYYY-MM-DD
    count: int = Field(default=1)

class HabitEntryRead(SQLModel):
    id: int
    habit_id: int
    date: str
    count: int

# --- TASK TEMPLATE MODELS (4C) ---
class TaskTemplate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    title: str
    description: Optional[str] = None
    default_priority: str = Field(default="low")
    recurrence_days: Optional[str] = None  # comma-sep day nums
    calendar_id: Optional[int] = None
    created_at: str

class TaskTemplateRead(SQLModel):
    id: int
    name: str
    title: str
    description: Optional[str]
    default_priority: str
    recurrence_days: Optional[str]
    calendar_id: Optional[int]
    created_at: str

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
    # Feature 10: optional pre-filled recipients for project-driven availability.
    # JSON list of {person_id, name, email}. Receivers still self-identify on the
    # receiver page — this is metadata only.
    recipients_json: Optional[str] = None

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
    recipients_json: Optional[str] = None

# --- JOURNAL ENTRY MODELS (Phase 12) ---
class JournalEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    date: str                           # ISO date YYYY-MM-DD
    transcript: str
    audio_path: Optional[str] = None   # local file path if audio storage enabled
    mood: Optional[str] = None         # "great" | "ok" | "rough" | None
    created_at: str                     # ISO datetime
    event_id: Optional[int] = Field(default=None, index=True)

class JournalEntryRead(SQLModel):
    id: int
    date: str
    transcript: str
    audio_path: Optional[str]
    mood: Optional[str]
    created_at: str
    event_id: Optional[int] = None

# --- WEEKLY REVIEW (cached generated review for a Mon–Sun window) ---
class WeeklyReview(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    week_start: str = Field(index=True)            # ISO date (Monday)
    markdown: str                                  # rendered review text
    metrics: str = Field(default="{}")             # JSON: total_hours, busiest_day, completion_rate, hours_per_timeline
    generated_at: str                              # ISO datetime

class WeeklyReviewRead(SQLModel):
    id: int
    week_start: str
    markdown: str
    metrics: str
    generated_at: str

# --- POMODORO SESSION MODELS (Energy Mapping) ---
# Each completed pomodoro phase is logged here. Drives the Energy Map widget on
# the home page (work-mode counts binned by hour-of-day × day-of-week).
class PomodoroSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    completed_at: str = Field(index=True)              # ISO datetime, local tz
    duration_minutes: int                              # actual elapsed work duration
    mode: str                                          # work | short-break | long-break
    task_id: Optional[int] = Field(default=None, index=True)  # no FK (Task pattern)
    task_note: Optional[str] = Field(default=None)     # denormalized snapshot
    round_num: Optional[int] = Field(default=None)

class PomodoroSessionRead(SQLModel):
    id: int
    completed_at: str
    duration_minutes: int
    mode: str
    task_id: Optional[int]
    task_note: Optional[str]
    round_num: Optional[int]

# --- SUBSCRIPTION MODELS (Phase 9) ---
class Subscription(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    url: str
    timeline_id: int
    refresh_minutes: int = Field(default=360)
    last_synced: Optional[str] = None
    last_error: Optional[str] = None
    enabled: bool = Field(default=True)

class SubscriptionRead(SQLModel):
    id: int
    name: str
    url: str
    timeline_id: int
    refresh_minutes: int
    last_synced: Optional[str]
    last_error: Optional[str]
    enabled: bool

# --- COURSE MODELS (Phase 8) ---
class Course(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    code: Optional[str] = None           # e.g. "CS107"
    instructor: Optional[str] = None
    syllabus_path: Optional[str] = None  # local file path
    timeline_id: Optional[int] = None    # default Calendar for this course
    grade_weights: str = Field(default="[]")  # JSON [{"name":"Midterm","weight":30},...]
    color: str = Field(default="#6366f1")
    # Feature 10: 'course' (default) | 'independent' (singleton catch-all for
    # uncourseed group projects). The Independent row is auto-created on first
    # uncourseed project; its term_id stays NULL (term-scope-agnostic).
    kind: Optional[str] = Field(default="course")

class CourseRead(SQLModel):
    id: int
    name: str
    code: Optional[str]
    instructor: Optional[str]
    syllabus_path: Optional[str]
    timeline_id: Optional[int]
    grade_weights: str
    color: str
    kind: Optional[str] = "course"

class Assignment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    course_id: int = Field(index=True)
    title: str
    due_date: str                         # ISO date
    weight_category: Optional[str] = None # references grade_weights[].name
    score: Optional[float] = None
    max_score: Optional[float] = None
    event_id: Optional[int] = None        # if scheduled on calendar
    # Feature 10: deliverables = assignments. NULL on personal-only assignments.
    project_id: Optional[int] = Field(default=None, index=True)
    assignee_person_id: Optional[int] = Field(default=None, index=True)

class AssignmentRead(SQLModel):
    id: int
    course_id: int
    title: str
    due_date: str
    weight_category: Optional[str]
    score: Optional[float]
    max_score: Optional[float]
    event_id: Optional[int]
    project_id: Optional[int] = None
    assignee_person_id: Optional[int] = None

# --- EVENT EMBEDDING MODELS (Phase 6) ---
class EventEmbedding(SQLModel, table=True):
    event_id: int = Field(primary_key=True)
    vector: bytes                # numpy float32 serialized via tobytes()
    model: str = Field(default="all-MiniLM-L6-v2")
    updated_at: str              # ISO datetime

# --- INBOX ITEM MODELS (Phase 4) ---
class InboxItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    text: str
    created_at: str                          # ISO datetime
    proposed_start: Optional[str] = None    # ISO datetime
    proposed_duration: Optional[int] = None  # minutes
    scheduled_event_id: Optional[int] = None
    archived: bool = Field(default=False)

class InboxItemRead(SQLModel):
    id: int
    text: str
    created_at: str
    proposed_start: Optional[str]
    proposed_duration: Optional[int]
    scheduled_event_id: Optional[int]
    archived: bool

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

# --- PEER MODELS (Phase 14a) ---
class Peer(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    cert_fingerprint: str          # SHA-256 hex fingerprint of the peer's TLS cert
    last_seen: Optional[str] = None  # ISO datetime
    created_at: str

class PeerRead(SQLModel):
    id: int
    name: str
    cert_fingerprint: str
    last_seen: Optional[str]
    created_at: str

# --- DEVICE CONFIG (Phase 14c — single-row config) ---
class DeviceConfig(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    device_id: str                 # UUID assigned at first boot

# --- ACCOUNT (Phase v3.0 — identity-only mirror of Supabase user) ---
class Account(SQLModel, table=True):
    id: str = Field(default="me", primary_key=True)  # single-row enforcement
    supabase_user_id: str
    email: str
    display_name: Optional[str] = None
    auth_provider: str             # google · apple · microsoft · email
    created_at: str
    last_login_at: Optional[str] = None

class AccountRead(SQLModel):
    id: str
    supabase_user_id: str
    email: str
    display_name: Optional[str]
    auth_provider: str
    created_at: str
    last_login_at: Optional[str]

# --- CONNECTION (Phase v3.0 — provider link, e.g. Google / iCloud / generic CalDAV) ---
# Independent of Account. A user in local-only mode (no Account row) can still
# create connections. The connection's auth identity may differ from the
# LoomAssist account identity.
class Connection(SQLModel, table=True):
    id: str = Field(primary_key=True)                       # UUID; Keychain key = com.loomassist.connection.{id}
    kind: str                                               # google | caldav_icloud | caldav_generic
    display_name: str                                       # e.g. "Google — sam@workspace.com"
    account_email: str                                      # provider-side email
    caldav_base_url: Optional[str] = Field(default=None)    # null for Google
    status: str = Field(default="connected")                # connected | paused | auth_expired | error
    last_synced_at: Optional[str] = Field(default=None)
    last_error: Optional[str] = Field(default=None)
    created_at: str

class ConnectionRead(SQLModel):
    id: str
    kind: str
    display_name: str
    account_email: str
    caldav_base_url: Optional[str]
    status: str
    last_synced_at: Optional[str]
    last_error: Optional[str]
    created_at: str

# --- CONNECTION CALENDAR (M:N join: one row per remote-calendar ↔ local-timeline pair) ---
# Holds the per-pair sync state — direction, sync token, last-seen ETag, last
# successful cursor. This is the table that makes the dedup engine
# deterministic: every Event written by sync carries this id.
class ConnectionCalendar(SQLModel, table=True):
    id: str = Field(primary_key=True)
    connection_id: str = Field(index=True)                  # FK → Connection.id (CASCADE on delete)
    local_calendar_id: int                                  # FK → Calendar.id (nullable on disconnect)
    remote_calendar_id: str                                 # Google: calendarId; CalDAV: collection href
    remote_display_name: str                                # cached for the disconnect screen + Sync Center
    sync_direction: str = Field(default="both")             # both | pull | push
    sync_token: Optional[str] = Field(default=None)         # Google incremental cursor
    caldav_ctag: Optional[str] = Field(default=None)        # CalDAV collection-level cursor
    last_full_sync_at: Optional[str] = Field(default=None)
    created_at: str

class ConnectionCalendarRead(SQLModel):
    id: str
    connection_id: str
    local_calendar_id: int
    remote_calendar_id: str
    remote_display_name: str
    sync_direction: str
    sync_token: Optional[str]
    caldav_ctag: Optional[str]
    last_full_sync_at: Optional[str]
    created_at: str

# --- SYNC REVIEW ITEM (queued surface state — every ambiguous match becomes a row) ---
# The Sync Review page is `WHERE resolved_at IS NULL`. The only new table the
# user directly sees as a list.
class SyncReviewItem(SQLModel, table=True):
    id: str = Field(primary_key=True)                       # UUID
    connection_calendar_id: str = Field(index=True)
    kind: str                                               # incoming_duplicate | bidirectional_conflict | push_rejected
    local_event_id: Optional[int] = Field(default=None)     # null on push_rejected of a deleted local
    incoming_payload: str                                   # JSON — full provider event normalized to LoomAssist shape
    match_score: Optional[float] = Field(default=None)      # 0.0–1.0; null for non-duplicate kinds
    match_reasons: Optional[str] = Field(default=None)      # JSON array — drives the merge UI
    created_at: str
    resolved_at: Optional[str] = Field(default=None, index=True)
    resolution: Optional[str] = Field(default=None)         # approved_new | merged | rejected | replaced_local | ignored_forever
    resolution_payload: Optional[str] = Field(default=None) # JSON — what we actually wrote (audit log + undo)

class SyncReviewItemRead(SQLModel):
    id: str
    connection_calendar_id: str
    kind: str
    local_event_id: Optional[int]
    incoming_payload: str
    match_score: Optional[float]
    match_reasons: Optional[str]
    created_at: str
    resolved_at: Optional[str]
    resolution: Optional[str]
    resolution_payload: Optional[str]

# --- SYNC IGNORE RULE (denylist for "Reject & remember" decisions) ---
# When a user picks "Reject & remember" on a Sync Review item, we hash the
# provider event's stable identifying tuple and add it here. Future cycles
# skip any incoming event whose hash matches.
class SyncIgnoreRule(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    connection_id: str = Field(index=True)
    incoming_hash: str = Field(index=True)                  # SHA-256 of (remote_calendar_id + external_id + start_iso + title)
    created_at: str

# --- FEATURE 10: GROUP PROJECT TRACKER ---
# Projects sit under Course (or the singleton "Independent" pseudo-course).
# Person is a local-only contact-like entity; never linked to Account/Auth.
# ProjectMember is the M:N join. See docs/projects-design.md.

class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    course_id: int = Field(index=True)        # FK Course; "Independent" pseudo-course if uncourseed
    name: str
    description: Optional[str] = None
    color: str = Field(default="#6366f1")
    archived_at: Optional[str] = None         # nullable ISO datetime; archived projects hide by default
    created_at: str

class ProjectRead(SQLModel):
    id: int
    course_id: int
    name: str
    description: Optional[str]
    color: str
    archived_at: Optional[str]
    created_at: str

class Person(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    email: Optional[str] = None               # required only for availability use
    phone: Optional[str] = None
    notes: Optional[str] = None
    archived_at: Optional[str] = None
    # Exactly one row may be true at a time — enforced at the route layer
    # (POST /people/{id}/set-self clears all other rows in a transaction).
    is_self: bool = Field(default=False)
    created_at: str

class PersonRead(SQLModel):
    id: int
    name: str
    email: Optional[str]
    phone: Optional[str]
    notes: Optional[str]
    archived_at: Optional[str]
    is_self: bool
    created_at: str

class ProjectMember(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(index=True)
    person_id: int = Field(index=True)
    role: Optional[str] = None                # free-form: "lead", "writer", "designer", …
    created_at: str

class ProjectMemberRead(SQLModel):
    id: int
    project_id: int
    person_id: int
    role: Optional[str]
    created_at: str
# --- STAGE 2: AWS CLOUD SYNC (v3.0 roadmap §4) ---
# CloudSyncState maps a local row to its server-side encrypted record.
# Deliberately a separate table — zero risk to existing data paths.
# The DEK/KEK never touch the database; keys live only in process memory
# (services/cloudsync/session.py).

class CloudSyncState(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    record_type: str = Field(index=True)              # "event" | "task"
    local_id: int = Field(index=True)                 # PK of the local row
    record_id: str = Field(index=True, unique=True)   # server record id e.g. "evt_<uuid>"
    server_version: int = Field(default=0)            # last version seen/written on server
    # Local last_modified at the moment of last successful push or pull-apply.
    # Row needs pushing iff its current last_modified differs from this.
    synced_local_modified: Optional[str] = Field(default=None)
    deleted: bool = Field(default=False)              # server tombstone already written

class CloudSyncConfig(SQLModel, table=True):
    """Single-row table ('me' pattern, like Account)."""
    id: str = Field(default="me", primary_key=True)
    email: Optional[str] = None                       # Cognito sign-in email
    user_sub: Optional[str] = None                    # Cognito sub
    pull_cursor: int = Field(default=0)               # ms-epoch delta-query watermark
    last_synced_at: Optional[str] = None              # ISO datetime of last successful run
