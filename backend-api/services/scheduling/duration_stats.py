"""Planned-vs-actual duration aggregation. Backs GET /stats/duration.

Extracted from main.py in Stage 1 (substep 1A.2). No LLM dependency.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from database import models


def compute_duration_stats(db: Session) -> list[dict]:
    """Per-event planned-vs-actual minute deltas for events that have been
    clocked in and out."""
    events = db.query(models.Event).filter(models.Event.actual_end != None).all()  # noqa: E711
    stats: list[dict] = []
    for e in events:
        if not e.actual_start or not e.actual_end:
            continue
        planned = (datetime.fromisoformat(e.end_time) -
                   datetime.fromisoformat(e.start_time)).seconds / 60
        actual  = (datetime.fromisoformat(e.actual_end) -
                   datetime.fromisoformat(e.actual_start)).seconds / 60
        stats.append({
            "id": e.id, "title": e.title,
            "calendar_id": e.calendar_id,
            "planned_minutes": round(planned),
            "actual_minutes":  round(actual),
            "delta_minutes":   round(actual - planned),
        })
    return stats
