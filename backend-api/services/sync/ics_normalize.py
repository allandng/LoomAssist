"""Phase v3.0 — iCalendar (RFC 5545) ↔ LoomAssist event payload conversion.

Used by:
  - CalDAV pull/push (the wire format is iCal text).
  - Google Calendar's `iCalUID` field (informational, not authoritative).
  - The existing ICS importer in main.py — Phase 2 should consolidate that
    code path through this module so dedup decisions become consistent.

Pure functions; no DB, no network. The runner constructs IncomingEvent
instances from the dicts returned here.
"""
from __future__ import annotations

import logging
from datetime import datetime, date
from typing import Optional

from icalendar import Calendar as ICalCalendar, Event as ICalEvent


def parse_ics(ics_text: str) -> list[dict]:
    """Parse an iCalendar .ics blob into a list of LoomAssist event dicts.

    Each dict has keys: title, start_time, end_time, location, description,
    is_all_day, external_uid, external_etag.

    Skips VEVENT components without DTSTART or SUMMARY.
    """
    cal = ICalCalendar.from_ical(ics_text)
    out: list[dict] = []
    for comp in cal.walk("VEVENT"):
        try:
            ev = _vevent_to_dict(comp)
            if ev:
                out.append(ev)
        except Exception as e:
            logging.warning(f"ics_normalize: skip VEVENT due to parse error: {e}")
    return out


def _vevent_to_dict(comp) -> Optional[dict]:
    summary = comp.get("SUMMARY")
    dtstart = comp.get("DTSTART")
    dtend   = comp.get("DTEND")
    if not summary or not dtstart:
        return None

    title = str(summary).strip() or "(Untitled)"
    start_dt = dtstart.dt if hasattr(dtstart, "dt") else dtstart
    is_all_day = isinstance(start_dt, date) and not isinstance(start_dt, datetime)

    if is_all_day:
        start_iso = _date_to_iso_midnight(start_dt)
        if dtend and hasattr(dtend, "dt"):
            end_dt = dtend.dt
            if isinstance(end_dt, date) and not isinstance(end_dt, datetime):
                end_iso = _date_to_iso_midnight(end_dt)
            else:
                end_iso = _datetime_to_iso(end_dt)
        else:
            end_iso = start_iso
    else:
        start_iso = _datetime_to_iso(start_dt)
        if dtend and hasattr(dtend, "dt"):
            end_dt = dtend.dt
            end_iso = _datetime_to_iso(end_dt) if isinstance(end_dt, datetime) else _date_to_iso_midnight(end_dt)
        else:
            duration = comp.get("DURATION")
            if duration and hasattr(duration, "dt"):
                end_iso = _datetime_to_iso(start_dt + duration.dt)
            else:
                # Default 30 minutes if neither DTEND nor DURATION is given.
                from datetime import timedelta
                end_iso = _datetime_to_iso(start_dt + timedelta(minutes=30))

    description = comp.get("DESCRIPTION")
    location    = comp.get("LOCATION")
    uid         = comp.get("UID")

    return {
        "title":         title,
        "start_time":    start_iso,
        "end_time":      end_iso,
        "is_all_day":    is_all_day,
        "description":   str(description).strip() if description else None,
        "location":      str(location).strip() if location else None,
        "external_uid":  str(uid).strip() if uid else None,
    }


def to_ics(event: dict) -> str:
    """Serialize a LoomAssist event dict to a single-VEVENT iCalendar blob.

    Used by CalDAV PUT (one VEVENT per resource href). Required keys:
    title, start_time, end_time. Optional: description, location,
    external_uid, is_all_day.
    """
    cal = ICalCalendar()
    cal.add("prodid", "-//LoomAssist v3//loomassist.local//EN")
    cal.add("version", "2.0")

    ve = ICalEvent()
    ve.add("summary", event["title"])

    start_iso = event["start_time"]
    end_iso   = event["end_time"]
    is_all_day = bool(event.get("is_all_day"))

    if is_all_day:
        ve.add("dtstart", _iso_to_date(start_iso))
        ve.add("dtend",   _iso_to_date(end_iso))
    else:
        ve.add("dtstart", _iso_to_datetime(start_iso))
        ve.add("dtend",   _iso_to_datetime(end_iso))

    if event.get("description"):
        ve.add("description", event["description"])
    if event.get("location"):
        ve.add("location", event["location"])
    if event.get("external_uid"):
        ve.add("uid", event["external_uid"])
    else:
        # CalDAV servers expect a UID. Synthesize one if missing.
        import uuid as _uuid
        ve.add("uid", f"loomassist-{_uuid.uuid4()}@loomassist.local")

    ve.add("dtstamp", datetime.utcnow())

    cal.add_component(ve)
    return cal.to_ical().decode("utf-8")


# ── Internals ────────────────────────────────────────────────────────────────

def _datetime_to_iso(dt) -> str:
    if isinstance(dt, datetime):
        # Drop tzinfo to keep parity with the rest of the codebase, which
        # treats `start_time` / `end_time` as naive ISO strings (timezone
        # column on Event handles the per-event display tz).
        if dt.tzinfo is not None:
            dt = dt.replace(tzinfo=None)
        return dt.isoformat()
    return str(dt)


def _date_to_iso_midnight(d) -> str:
    return datetime(d.year, d.month, d.day).isoformat()


def _iso_to_datetime(s: str) -> datetime:
    return datetime.fromisoformat(s.rstrip("Z"))


def _iso_to_date(s: str) -> date:
    return _iso_to_datetime(s).date()
