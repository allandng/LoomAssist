"""Request-level validation helpers shared across routes.

All helpers raise `HTTPException` on failure so route handlers can call them
unconditionally; on success they return None. Extracted from main.py in
Stage 1 (substep 1A.1).

NOTE: this module deliberately has NO embedder dependency. The
`_try_upsert_embedding` wrapper that originally lived alongside these
helpers in main.py belongs to `services/ai/embedder.py` (substep 1A.6) —
keeping it out of `core/` is what prevents the sentence-transformers
dependency from leaking into every router that imports from `core`.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from database import models


def validate_event_times(start_time: str, end_time: str) -> None:
    """Raises HTTPException 422 if times are invalid. Only called on new/edited events."""
    try:
        start = datetime.fromisoformat(start_time)
        end = datetime.fromisoformat(end_time)
    except ValueError:
        raise HTTPException(status_code=422,
            detail={'error': {'code': 'invalid_time_format',
                              'detail': 'start_time and end_time must be valid ISO 8601 strings.'}})
    if end <= start:
        raise HTTPException(status_code=422,
            detail={'error': {'code': 'invalid_time_range',
                              'detail': 'end_time must be after start_time.'}})
    if not (1970 <= start.year <= 2100):
        raise HTTPException(status_code=422,
            detail={'error': {'code': 'out_of_range',
                              'detail': 'Event year must be between 1970 and 2100.'}})


def validate_calendar_exists(calendar_id: int, db: Session) -> None:
    """Raises HTTPException 404 if calendar not found."""
    cal = db.query(models.Calendar).filter(models.Calendar.id == calendar_id).first()
    if not cal:
        raise HTTPException(status_code=404,
            detail={'error': {'code': 'calendar_not_found',
                              'detail': f'Calendar {calendar_id} does not exist.'}})


def _detect_circular(event_id: int, depends_on_id: int, db: Session) -> bool:
    """Return True if setting event_id.depends_on = depends_on_id would create a cycle."""
    visited: set[int] = {event_id}
    current = depends_on_id
    while current is not None:
        if current in visited:
            return True
        visited.add(current)
        ev = db.query(models.Event).filter(models.Event.id == current).first()
        if not ev:
            break
        current = ev.depends_on_event_id
    return False
