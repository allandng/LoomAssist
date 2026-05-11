"""Procrastination radar — assignments due within 7 days that have no linked
study/focus block. Backs GET /schedule/procrastination-radar.

Returns plain dicts shaped like the route's `ProcrastinationWarning` Pydantic
class so the route handler can wrap them directly.

Extracted from main.py in Stage 1 (substep 1A.2). No LLM dependency.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from database import models


_WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _radar_message(title: str, days_until: int, due_dt: datetime) -> str:
    if days_until == 0:
        return f"{title} due today — no study time blocked."
    if days_until == 1:
        return f"{title} due tomorrow — no study time blocked."
    if days_until == 7:
        return f"{title} due in 7 days — no study time blocked."
    return f"{title} due {_WEEKDAY_NAMES[due_dt.weekday()]} — no study time blocked."


def compute_procrastination_warnings(db: Session, now: datetime) -> list[dict]:
    """Assignments due within 7 days with no linked study/focus block."""
    today = now.date()
    horizon = today + timedelta(days=7)
    horizon_iso = horizon.isoformat()
    today_iso = today.isoformat()
    now_iso = now.isoformat()

    assignments = (
        db.query(models.Assignment)
        .filter(models.Assignment.due_date >= today_iso)
        .filter(models.Assignment.due_date <= horizon_iso)
        .order_by(models.Assignment.due_date)
        .all()
    )

    warnings: list[dict] = []
    for a in assignments:
        block_count = (
            db.query(models.Event)
            .filter(models.Event.assignment_id == a.id)
            .filter(models.Event.deleted_at.is_(None))
            .filter(models.Event.start_time >= now_iso)
            .count()
        )
        if block_count > 0:
            continue

        try:
            due_dt = datetime.strptime(a.due_date[:10], "%Y-%m-%d")
        except ValueError:
            continue
        days_until = (due_dt.date() - today).days
        if days_until < 0 or days_until > 7:
            continue

        course = db.query(models.Course).filter(models.Course.id == a.course_id).first()
        course_name = course.name if course else ""

        warnings.append({
            "assignment_id": a.id,
            "title":         a.title,
            "course_name":   course_name,
            "due_date":      a.due_date[:10],
            "days_until":    days_until,
            "message":       _radar_message(a.title, days_until, due_dt),
        })

    return warnings
