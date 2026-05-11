"""Timeline export — build JSON and ICS payloads for /export/timelines.

The route handler in main.py keeps the HTTP concerns (input parsing, DB
query, content-type dispatch); these pure-function builders produce the
serialized body. No LLM dependency.

Extracted from main.py in Stage 1 (substep 1A.4).
"""
from __future__ import annotations

from datetime import datetime


_ICS_DAY_MAP = {"0": "SU", "1": "MO", "2": "TU", "3": "WE", "4": "TH", "5": "FR", "6": "SA"}


def build_json_export(calendars, skipped_ids: list[int]) -> dict:
    """JSON payload listing each calendar + its events. `calendars` is a list of
    SQLModel `Calendar` instances with `.events` loaded."""
    data = {
        "exported_at": datetime.now().isoformat(),
        "timelines": [],
        "skipped_ids": skipped_ids,
    }
    for cal in calendars:
        cal_data = {
            "id": cal.id,
            "name": cal.name,
            "color": cal.color,
            "description": cal.description,
            "events": [],
        }
        for ev in cal.events:
            cal_data["events"].append({
                "id": ev.id,
                "title": ev.title,
                "start_time": ev.start_time,
                "end_time": ev.end_time,
                "is_recurring": ev.is_recurring,
                "recurrence_days": ev.recurrence_days,
                "recurrence_end": ev.recurrence_end,
                "description": ev.description,
                "unique_description": ev.unique_description,
            })
        data["timelines"].append(cal_data)
    return data


def build_ics_export(calendars) -> str:
    """RFC 5545-ish iCal text. Floating-local datetimes (no TZID yet — flagged
    in main.py's original 'FUTURE IMPROVEMENT' comment). CRLF line endings."""
    lines: list[str] = []
    lines.append("BEGIN:VCALENDAR")
    lines.append("VERSION:2.0")
    lines.append("PRODID:-//Loom Assistant//EN")

    for cal in calendars:
        for ev in cal.events:
            lines.append("BEGIN:VEVENT")
            lines.append(f"UID:loom-{ev.id}@loom-assist")

            # FUTURE IMPROVEMENT: Proper timezone support (Z or specific TZID). Currently treating as floating local time.
            start_dt = ev.start_time.replace("-", "").replace(":", "")[:15]
            end_dt = ev.end_time.replace("-", "").replace(":", "")[:15]
            lines.append(f"DTSTART:{start_dt}")
            lines.append(f"DTEND:{end_dt}")

            summary = (ev.title or "Untitled").replace("\n", " ").replace(",", "\\,")
            lines.append(f"SUMMARY:{summary}")

            desc_parts = []
            if ev.description: desc_parts.append(ev.description)
            if ev.unique_description:
                if desc_parts: desc_parts.append("---")
                desc_parts.append(ev.unique_description)

            if desc_parts:
                full_desc = "\\n".join(desc_parts).replace("\n", "\\n").replace(",", "\\,")
                lines.append(f"DESCRIPTION:{full_desc}")

            lines.append(f"X-LOOM-CALENDAR:{cal.name}")

            if ev.is_recurring and ev.recurrence_days:
                days = [_ICS_DAY_MAP.get(d.strip()) for d in ev.recurrence_days.split(",") if d.strip() in _ICS_DAY_MAP]
                if days:
                    rrule = f"FREQ=WEEKLY;BYDAY={','.join(days)}"
                    if ev.recurrence_end:
                        until_dt = ev.recurrence_end.replace("-", "").replace(":", "")[:8] + "T235959"
                        rrule += f";UNTIL={until_dt}"
                    lines.append(f"RRULE:{rrule}")

            lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")

    # Mandatory CRLF line endings for standard ICS
    return "\r\n".join(lines) + "\r\n"
