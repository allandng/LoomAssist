from sqlmodel import create_engine, SQLModel, Session
from sqlalchemy.orm import sessionmaker
import logging
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

# This creates a local file named loom.sqlite3 in your root folder
SQLALCHEMY_DATABASE_URL = "sqlite:///./loom.sqlite3"

# Connect to the SQLite database
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# In SQLModel, we use the built-in metadata for table creation [cite: 65, 67]
def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def run_migrations():
    logging.info("Starting PRAGMA migration check...")
    with engine.begin() as conn:
        # 1. Calendar table
        try:
            conn.execute(text("ALTER TABLE calendar ADD COLUMN color VARCHAR DEFAULT '#6366f1'"))
            logging.info("Migration: added column 'color' to calendar table.")
        except OperationalError:
            pass # Column already exists
        
        # 2. Event table
        try:
            result = conn.execute(text("PRAGMA table_info(event)")).fetchall()
            columns = [row[1] for row in result]
            
            new_columns = {
                "is_recurring": "BOOLEAN DEFAULT FALSE",
                "recurrence_days": "VARCHAR",
                "recurrence_end": "VARCHAR",
                "description": "VARCHAR",
                "unique_description": "VARCHAR",
                "reminder_minutes": "INTEGER",
                "external_uid": "VARCHAR",
                "timezone": "VARCHAR DEFAULT 'local'",
                "is_all_day": "INTEGER DEFAULT 0",
                "skipped_dates": "TEXT",
                "per_day_times": "TEXT",
                "checklist": "TEXT",
                "actual_start": "TEXT",
                "actual_end":   "TEXT",
                "location": "TEXT",
                "travel_time_minutes": "INTEGER",
                "reminder_source": "TEXT DEFAULT 'none'",
                "depends_on_event_id": "INTEGER",
                "depends_offset_minutes": "INTEGER",
            }
            
            for col_name, col_type in new_columns.items():
                if col_name not in columns:
                    conn.execute(text(f"ALTER TABLE event ADD COLUMN {col_name} {col_type}"))
                    logging.info(f"Migration: added column '{col_name}' to event table.")
            
        except Exception as e:
            logging.error(f"Migration error on event table: {e}")

        # 3. Task table — v2.0 Kanban fields
        try:
            result = conn.execute(text("PRAGMA table_info(task)")).fetchall()
            task_cols = [row[1] for row in result]
            task_new = {
                "status":   "VARCHAR DEFAULT 'backlog'",
                "priority": "VARCHAR DEFAULT 'low'",
                "due_date": "VARCHAR",
            }
            for col_name, col_type in task_new.items():
                if col_name not in task_cols:
                    conn.execute(text(f"ALTER TABLE task ADD COLUMN {col_name} {col_type}"))
                    logging.info(f"Migration: added column '{col_name}' to task table.")
        except Exception as e:
            logging.error(f"Migration error on task table: {e}")

        # 4. TimeBlockTemplate table
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS timeblockstemplate (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    created_at TEXT DEFAULT '',
                    blocks_json TEXT DEFAULT '[]'
                )
            """))
        except Exception as e:
            logging.error(f"Migration error on timeblockstemplate table: {e}")

        # Phase 12: JournalEntry table
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS journalentry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL,
                    transcript TEXT NOT NULL,
                    audio_path TEXT,
                    mood TEXT,
                    created_at TEXT NOT NULL
                )
            """))
        except Exception as e:
            logging.error(f"Migration error on journalentry table: {e}")

        # Phase 9: Subscription table
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS subscription (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    url TEXT NOT NULL,
                    timeline_id INTEGER NOT NULL,
                    refresh_minutes INTEGER NOT NULL DEFAULT 360,
                    last_synced TEXT,
                    last_error TEXT,
                    enabled INTEGER NOT NULL DEFAULT 1
                )
            """))
        except Exception as e:
            logging.error(f"Migration error on subscription table: {e}")

        # Phase 8: Course + Assignment tables
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS course (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    code TEXT,
                    instructor TEXT,
                    syllabus_path TEXT,
                    timeline_id INTEGER,
                    grade_weights TEXT NOT NULL DEFAULT '[]',
                    color TEXT NOT NULL DEFAULT '#6366f1'
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS assignment (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    course_id INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    due_date TEXT NOT NULL,
                    weight_category TEXT,
                    score REAL,
                    max_score REAL,
                    event_id INTEGER
                )
            """))
        except Exception as e:
            logging.error(f"Migration error on course/assignment tables: {e}")

        # Phase 7: autopilot fields on Task
        try:
            result = conn.execute(text("PRAGMA table_info(task)")).fetchall()
            task_cols = [row[1] for row in result]
            autopilot_cols = {
                "estimated_minutes": "INTEGER",
                "deadline": "VARCHAR",
            }
            for col_name, col_type in autopilot_cols.items():
                if col_name not in task_cols:
                    conn.execute(text(f"ALTER TABLE task ADD COLUMN {col_name} {col_type}"))
                    logging.info(f"Migration: added column '{col_name}' to task table.")
        except Exception as e:
            logging.error(f"Migration error on task (autopilot cols): {e}")

        # 5. InboxItem table (Phase 4)
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS inboxitem (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    text TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    proposed_start TEXT,
                    proposed_duration INTEGER,
                    scheduled_event_id INTEGER,
                    archived INTEGER NOT NULL DEFAULT 0
                )
            """))
        except Exception as e:
            logging.error(f"Migration error on inboxitem table: {e}")

        # 6. EventEmbedding table (Phase 6)
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS eventembedding (
                    event_id INTEGER PRIMARY KEY,
                    vector BLOB NOT NULL,
                    model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
                    updated_at TEXT NOT NULL
                )
            """))
        except Exception as e:
            logging.error(f"Migration error on eventembedding table: {e}")

        # Phase 14a: Peer table
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS peer (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    cert_fingerprint TEXT NOT NULL,
                    last_seen TEXT,
                    created_at TEXT NOT NULL
                )
            """))
        except Exception as e:
            logging.error(f"Migration error on peer table: {e}")

        # Phase 14c: DeviceConfig table
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS deviceconfig (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id TEXT NOT NULL
                )
            """))
        except Exception as e:
            logging.error(f"Migration error on deviceconfig table: {e}")

        # Phase v3.0: Account table (identity-only mirror of Supabase user)
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS account (
                    id TEXT PRIMARY KEY,
                    supabase_user_id TEXT NOT NULL,
                    email TEXT NOT NULL,
                    display_name TEXT,
                    auth_provider TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_login_at TEXT
                )
            """))
        except Exception as e:
            logging.error(f"Migration error on account table: {e}")

        # Phase v3.0: Connection table (provider link)
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS connection (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    account_email TEXT NOT NULL,
                    caldav_base_url TEXT,
                    status TEXT NOT NULL DEFAULT 'connected',
                    last_synced_at TEXT,
                    last_error TEXT,
                    created_at TEXT NOT NULL
                )
            """))
        except Exception as e:
            logging.error(f"Migration error on connection table: {e}")

        # Phase v3.0: ConnectionCalendar table (per-pair sync state)
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS connectioncalendar (
                    id TEXT PRIMARY KEY,
                    connection_id TEXT NOT NULL,
                    local_calendar_id INTEGER NOT NULL,
                    remote_calendar_id TEXT NOT NULL,
                    remote_display_name TEXT NOT NULL,
                    sync_direction TEXT NOT NULL DEFAULT 'both',
                    sync_token TEXT,
                    caldav_ctag TEXT,
                    last_full_sync_at TEXT,
                    created_at TEXT NOT NULL
                )
            """))
            conn.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS
                idx_connectioncalendar_remote
                ON connectioncalendar(connection_id, remote_calendar_id)
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS
                idx_connectioncalendar_connection
                ON connectioncalendar(connection_id)
            """))
        except Exception as e:
            logging.error(f"Migration error on connectioncalendar table: {e}")

        # Phase v3.0: SyncReviewItem table (the queue)
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS syncreviewitem (
                    id TEXT PRIMARY KEY,
                    connection_calendar_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    local_event_id INTEGER,
                    incoming_payload TEXT NOT NULL,
                    match_score REAL,
                    match_reasons TEXT,
                    created_at TEXT NOT NULL,
                    resolved_at TEXT,
                    resolution TEXT,
                    resolution_payload TEXT
                )
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_syncreview_pending
                ON syncreviewitem(resolved_at) WHERE resolved_at IS NULL
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_syncreview_cc
                ON syncreviewitem(connection_calendar_id)
            """))
        except Exception as e:
            logging.error(f"Migration error on syncreviewitem table: {e}")

        # Phase v3.0: SyncIgnoreRule table (per-connection denylist)
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS syncignorerule (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    connection_id TEXT NOT NULL,
                    incoming_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_syncignore_lookup
                ON syncignorerule(connection_id, incoming_hash)
            """))
        except Exception as e:
            logging.error(f"Migration error on syncignorerule table: {e}")

        # Phase v3.0: cloud-sync columns on Event
        try:
            result = conn.execute(text("PRAGMA table_info(event)")).fetchall()
            event_cols = [row[1] for row in result]
            cloud_cols = {
                "connection_calendar_id": "TEXT",
                "external_id":            "TEXT",
                "external_etag":          "TEXT",
                "last_synced_at":         "TEXT",
            }
            for col_name, col_type in cloud_cols.items():
                if col_name not in event_cols:
                    conn.execute(text(f"ALTER TABLE event ADD COLUMN {col_name} {col_type}"))
                    logging.info(f"Migration: added column '{col_name}' to event table.")
            # Partial unique index — allows multiple rows with NULL external_id
            # (which is the normal "local only" state for v2 events).
            conn.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_event_external_id
                ON event(connection_calendar_id, external_id)
                WHERE external_id IS NOT NULL
            """))
        except Exception as e:
            logging.error(f"Migration error on event cloud-sync cols: {e}")

        # Phase v3.0: created_via_sync column on Calendar
        try:
            result = conn.execute(text("PRAGMA table_info(calendar)")).fetchall()
            cal_cols = [row[1] for row in result]
            if "created_via_sync" not in cal_cols:
                conn.execute(text("ALTER TABLE calendar ADD COLUMN created_via_sync INTEGER DEFAULT 0"))
                logging.info("Migration: added column 'created_via_sync' to calendar table.")
        except Exception as e:
            logging.error(f"Migration error on calendar created_via_sync: {e}")

        # Phase 14c: last_modified + deleted_at on event and task
        try:
            result = conn.execute(text("PRAGMA table_info(event)")).fetchall()
            event_cols = [row[1] for row in result]
            for col in ["last_modified", "deleted_at"]:
                if col not in event_cols:
                    conn.execute(text(f"ALTER TABLE event ADD COLUMN {col} TEXT"))
            result = conn.execute(text("PRAGMA table_info(task)")).fetchall()
            task_cols = [row[1] for row in result]
            for col in ["last_modified", "deleted_at"]:
                if col not in task_cols:
                    conn.execute(text(f"ALTER TABLE task ADD COLUMN {col} TEXT"))
        except Exception as e:
            logging.error(f"Migration error on sync columns: {e}")

    logging.info("Migration check complete.")

def migrate_todo_to_task():
    """
    Migrates the old standalone 'todo' table to the new event-linked 'task' table.
    Drops the todo table if it exists (data is not preserved — todos were
    standalone records not linked to events in most cases).
    Creates the task table via SQLModel create_all if it does not exist.
    This function is idempotent — safe to run on every startup.
    """
    with engine.connect() as conn:
        # Check if old todo table exists
        result = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='todo'"))
        if result.fetchone():
            conn.execute(text("DROP TABLE todo"))
            conn.commit()
            import logging
            logging.info("Migration: dropped legacy 'todo' table.")
    # SQLModel create_all will create the new 'task' table on next startup