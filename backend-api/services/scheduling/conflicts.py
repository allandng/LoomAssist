"""Event-vs-event conflict detection.

Given a candidate (start, end, calendar_id), return existing events on the
same calendar that overlap — direct overlap, travel-buffer overlap, or
(for lecture events) prep-buffer overlap.

Called by event create/update routes and /events/check-conflicts. Extracted
from main.py in Stage 1 (substep 1A.2). No LLM dependency.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from database import models


def get_conflicts(
    start: str, end: str, calendar_id: int,
    exclude_event_id: int | None,
    db: Session,
) -> list[tuple]:
    """Return (event, conflict_type) for events on the same calendar that overlap
    [start, end]. conflict_type is 'event' for direct event-block overlap, or
    'travel' when the proposed window only intersects another event's travel
    buffer (the [event_start - travel_minutes, event_start) window)."""
    try:
        start_dt = datetime.fromisoformat(start)
        end_dt   = datetime.fromisoformat(end)
    except ValueError:
        return []
    candidates = db.query(models.Event).filter(models.Event.calendar_id == calendar_id).all()
    conflicts: list[tuple] = []
    for ev in candidates:
        if exclude_event_id and ev.id == exclude_event_id:
            continue
        try:
            ev_start = datetime.fromisoformat(ev.start_time)
            ev_end   = datetime.fromisoformat(ev.end_time)
        except ValueError:
            continue
        # Direct overlap
        if not (ev_end <= start_dt or ev_start >= end_dt):
            conflicts.append((ev, "event"))
            continue
        # Travel-buffer overlap: the [ev_start - travel, ev_start) window
        travel = ev.travel_time_minutes or 0
        if travel > 0:
            buffer_start = ev_start - timedelta(minutes=travel)
            if not (ev_start <= start_dt or buffer_start >= end_dt):
                conflicts.append((ev, "travel"))
        # Prep-buffer overlap (lectures only): [ev_start - travel - prep, ev_start - travel)
        if ev.event_type == "lecture":
            prep = ev.prep_minutes or 0
            if prep > 0:
                prep_end   = ev_start - timedelta(minutes=travel)
                prep_start = prep_end  - timedelta(minutes=prep)
                if not (prep_end <= start_dt or prep_start >= end_dt):
                    conflicts.append((ev, "prep"))
    return conflicts
