"""Plain-text daily summary, suitable for TTS. Backs POST /ai/briefing.

Currently no LLM — formats today's events into a few short sentences. Placed
in services/ai/ as the natural home if/when an LLM rewrite ships (the route's
URL prefix already promises an AI experience to clients).

Extracted from main.py in Stage 1 (substep 1A.6).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from database import models


def compute_briefing(db: Session) -> dict:
    """Return a TTS-friendly `{"text": str}` summary of today's events."""
    today = datetime.now().date()
    start = datetime.combine(today, datetime.min.time())
    end   = start + timedelta(days=1)
    events = db.query(models.Event).filter(
        models.Event.start_time >= start.isoformat(),
        models.Event.start_time <  end.isoformat(),
    ).order_by(models.Event.start_time).all()

    if not events:
        return {"text": "You have no events scheduled today."}

    lines = [f"You have {len(events)} event{'s' if len(events) != 1 else ''} today."]
    for e in events[:5]:
        try:
            t = datetime.fromisoformat(e.start_time).strftime("%-I:%M %p")
        except (ValueError, AttributeError):
            t = ""
        lines.append(f"At {t}: {e.title}.")
    if len(events) > 5:
        lines.append(f"And {len(events) - 5} more.")
    return {"text": " ".join(lines)}
