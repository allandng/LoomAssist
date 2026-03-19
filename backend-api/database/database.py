from sqlmodel import create_engine, SQLModel, Session
from sqlalchemy.orm import sessionmaker

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