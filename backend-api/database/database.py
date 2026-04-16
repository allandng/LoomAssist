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
                "checklist": "TEXT"
            }
            
            for col_name, col_type in new_columns.items():
                if col_name not in columns:
                    conn.execute(text(f"ALTER TABLE event ADD COLUMN {col_name} {col_type}"))
                    logging.info(f"Migration: added column '{col_name}' to event table.")
            
        except Exception as e:
            logging.error(f"Migration error on event table: {e}")

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