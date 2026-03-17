from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# This creates a local file named loom.sqlite3 in your root folder
SQLALCHEMY_DATABASE_URL = "sqlite:///./loom.sqlite3"

# Connect to the SQLite database
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# This Base class is what our actual database models will inherit from
Base = declarative_base()