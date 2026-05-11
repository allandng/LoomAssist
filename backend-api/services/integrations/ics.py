"""iCal subscription fetch + external-event-UID helpers.

Distinct from `services/scraper.py`, which parses local .ics file bytes for
the `/integrations/import-ics-file/` route. This module handles:

- Stable UID generation for events imported from external sources
  (`_ical_uid` for subscription feeds, `generate_event_uid` for syllabus-PDF
  imports — both use MD5 hashing so duplicate imports are idempotent).
- Periodic refresh of iCal subscription URLs (`_refresh_subscription`),
  called from the `/subscriptions/{id}/refresh` route and the lifespan
  background loop in main.py.

Extracted from main.py in Stage 1 (substep 1A.4). No LLM dependency.
"""
from __future__ import annotations

import hashlib
from datetime import datetime

from sqlalchemy.orm import Session

from database import models
from loom_logger import get_logger


logger = get_logger("integrations.ics")


def _ical_uid(url: str, uid: str) -> str:
    """Stable external_uid for subscription events: sub-<url_hash>-<uid>."""
    url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
    return f"sub-{url_hash}-{uid}"


def generate_event_uid(title: str, date_str: str) -> str:
    """Stable external_uid for syllabus-PDF imports: loom-pdf-<hash>.

    Hash is based on (title, first-10-chars-of-date) so re-importing the same
    syllabus PDF produces matching UIDs and the duplicate check in
    /documents/save-approved-events/ skips already-imported events.
    """
    raw = f"{title.strip().lower()}{date_str[:10]}"
    return 'loom-pdf-' + hashlib.md5(raw.encode()).hexdigest()[:16]


async def _refresh_subscription(sub: models.Subscription, db: Session) -> None:
    """Fetch + upsert events from a subscription URL. Updates last_synced / last_error."""
    import httpx as _httpx
    from icalendar import Calendar as ICalCalendar
    try:
        async with _httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(sub.url)
            resp.raise_for_status()

        cal = ICalCalendar.from_ical(resp.content)
        upserted = 0
        for component in cal.walk():
            if component.name != "VEVENT":
                continue
            uid      = str(component.get("UID", ""))
            summary  = str(component.get("SUMMARY", "Imported Event"))
            dtstart  = component.get("DTSTART")
            dtend    = component.get("DTEND") or component.get("DTSTART")
            if not dtstart:
                continue
            try:
                start_dt = dtstart.dt
                end_dt   = dtend.dt
                if hasattr(start_dt, "isoformat"):
                    start_iso = start_dt.isoformat()
                    end_iso   = end_dt.isoformat()
                else:
                    # all-day date
                    from datetime import datetime as _dt
                    start_iso = _dt.combine(start_dt, _dt.min.time()).isoformat()
                    end_iso   = _dt.combine(end_dt,   _dt.min.time()).isoformat()
            except Exception:
                continue

            ext_uid = _ical_uid(sub.url, uid or summary + start_iso)
            existing = db.query(models.Event).filter(models.Event.external_uid == ext_uid).first()
            if existing:
                existing.title      = summary
                existing.start_time = start_iso
                existing.end_time   = end_iso
            else:
                ev = models.Event(
                    title=summary,
                    start_time=start_iso,
                    end_time=end_iso,
                    calendar_id=sub.timeline_id,
                    external_uid=ext_uid,
                    reminder_source="none",
                )
                db.add(ev)
            upserted += 1

        db.commit()
        sub.last_synced = datetime.now().isoformat()
        sub.last_error  = None
        db.commit()
        logger.info(f"Subscription {sub.id} synced: {upserted} events")
    except Exception as e:
        sub.last_error  = str(e)[:500]
        sub.last_synced = datetime.now().isoformat()
        try:
            db.commit()
        except Exception:
            pass
        logger.warning(f"Subscription {sub.id} sync error: {e}")
