"""Free-slot finder shared by /schedule/find-free's caller chain, the conflict
resolver, autopilot, and the study-block generator. Quantized to 15-min
boundaries; bounded at 5 results.

Extracted from main.py in Stage 1 (substep 1A.2). No LLM dependency.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from database import models


def _find_free_slots_internal(
    db: Session,
    window_start: datetime,
    window_end: datetime,
    duration_minutes: int,
    working_hours_start: int,
    working_hours_end: int,
) -> list[dict]:
    """Shared free-slot finder used by both the public endpoint and conflict resolver."""
    duration = timedelta(minutes=duration_minutes)
    events   = db.query(models.Event).all()
    busy: list[tuple[datetime, datetime]] = []
    for ev in events:
        try:
            ev_s = datetime.fromisoformat(ev.start_time)
            ev_e = datetime.fromisoformat(ev.end_time)
        except ValueError:
            continue
        if ev_s < window_end and ev_e > window_start:
            travel = timedelta(minutes=ev.travel_time_minutes or 0)
            prep   = timedelta(minutes=ev.prep_minutes or 0) if ev.event_type == "lecture" else timedelta(0)
            busy.append((ev_s - travel - prep, ev_e))
    busy.sort()

    free_slots: list[dict] = []
    cursor = window_start.replace(hour=working_hours_start, minute=0, second=0, microsecond=0)
    if cursor < window_start:
        cursor = window_start
    remainder = cursor.minute % 15
    if remainder:
        cursor += timedelta(minutes=(15 - remainder))
    cursor = cursor.replace(second=0, microsecond=0)

    while cursor + duration <= window_end and len(free_slots) < 5:
        slot_end = cursor + duration
        day_end = cursor.replace(hour=working_hours_end, minute=0, second=0, microsecond=0)
        if cursor.hour < working_hours_start:
            cursor = cursor.replace(hour=working_hours_start, minute=0, second=0, microsecond=0)
            continue
        if cursor >= day_end or slot_end > day_end:
            # Past working hours — jump to next day's start
            next_day = cursor + timedelta(days=1)
            cursor = next_day.replace(hour=working_hours_start, minute=0, second=0, microsecond=0)
            continue
        if not any(b_s < slot_end and b_e > cursor for b_s, b_e in busy):
            free_slots.append({"start": cursor.isoformat(), "end": slot_end.isoformat()})
            cursor = slot_end
        else:
            cursor += timedelta(minutes=15)
    return free_slots
