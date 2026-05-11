"""Task-to-time-block autopilot algorithm. Backs POST /schedule/autopilot.

Walks tasks ordered by (deadline, priority) and greedily places each into the
next available free slot. Returns plain dicts; the route handler wraps these
in its Pydantic response model so the canonical schema stays co-located with
the HTTP surface in main.py.

Extracted from main.py in Stage 1 (substep 1A.2). No LLM dependency.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from database import models
from services.scheduling.find_free import _find_free_slots_internal


_PRIORITY_ORDER = {"high": 0, "med": 1, "low": 2}


def compute_autopilot_proposals(
    db: Session,
    window_start: datetime,
    window_end: datetime,
    working_hours_start: int,
    working_hours_end: int,
) -> tuple[list[dict], list[dict]]:
    """Return (proposals, overflow) as plain dicts ready for Pydantic wrapping."""
    tasks = (
        db.query(models.Task)
        .filter(models.Task.estimated_minutes != None, models.Task.is_complete == False)  # noqa: E711
        .all()
    )
    tasks.sort(key=lambda t: (
        t.deadline or "9999-12-31",
        _PRIORITY_ORDER.get(t.priority or "low", 2),
    ))

    proposals: list[dict] = []
    overflow:  list[dict] = []

    # Local busy list — includes proposals already made (so tasks don't overlap each other)
    local_busy: list[tuple[datetime, datetime]] = []

    for task in tasks:
        dur = task.estimated_minutes or 60

        # Build busy list from DB events + already-proposed slots
        db_events = db.query(models.Event).all()
        busy: list[tuple[datetime, datetime]] = []
        for ev in db_events:
            try:
                ev_s = datetime.fromisoformat(ev.start_time)
                ev_e = datetime.fromisoformat(ev.end_time)
            except ValueError:
                continue
            if ev_s < window_end and ev_e > window_start:
                busy.append((ev_s, ev_e))
        busy.extend(local_busy)
        busy.sort()

        slots = _find_free_slots_internal(
            db, window_start, window_end, dur,
            working_hours_start, working_hours_end,
        )
        # Override busy list: _find_free_slots_internal queries the DB; we need to
        # also exclude local_busy — re-filter its results manually
        valid_slots = []
        duration_td = timedelta(minutes=dur)
        for s in slots:
            slot_start = datetime.fromisoformat(s["start"])
            slot_end   = slot_start + duration_td
            if not any(b_s < slot_end and b_e > slot_start for b_s, b_e in local_busy):
                valid_slots.append(s)

        if not valid_slots:
            reason = "no free slot found in window"
            if task.deadline and datetime.fromisoformat(task.deadline + "T23:59:59") < window_end:
                reason = f"cannot fit before deadline {task.deadline}"
            overflow.append({
                "task_id":    task.id,
                "task_title": task.note or f"Task {task.id}",
                "reason":     reason,
            })
            continue

        chosen = valid_slots[0]
        chosen_start = datetime.fromisoformat(chosen["start"])
        chosen_end   = datetime.fromisoformat(chosen["end"])
        local_busy.append((chosen_start, chosen_end))

        proposals.append({
            "task_id":    task.id,
            "task_title": task.note or f"Task {task.id}",
            "start":      chosen["start"],
            "end":        chosen["end"],
            "rationale":  f"Earliest free {dur}-min slot",
        })

    return proposals, overflow
