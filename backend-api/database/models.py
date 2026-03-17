from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base

class Calendar(Base):
    __tablename__ = "calendars"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True) # e.g., "Personal", "Family", "OS Class"
    description = Column(String, nullable=True)

    # A single calendar can have many events
    events = relationship("Event", back_populates="calendar")

class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    start_time = Column(String) 
    end_time = Column(String)
    
    # This links the event to a specific timeline/calendar
    calendar_id = Column(Integer, ForeignKey("calendars.id"))

    # Establishes the relationship back to the Calendar model
    calendar = relationship("Calendar", back_populates="events")