"""Weekly review service. Backs POST /ai/weekly-review and POST /reviews/weekly.

Two public functions, kept in the same file because they are tightly coupled
by the cache-write flow (the /reviews/weekly cache route computes metrics
*and* triggers the LLM narrative within a single request):

- ``compute_weekly_metrics(week_start, db)`` — pure aggregation. No LLM.
  Iterates Events + Tasks in the [week_start, week_start+7d) window and
  returns ``{total_hours, busiest_day, completion_rate, completed_tasks,
  total_tasks, hours_per_timeline}``.

- ``generate_weekly_narrative(week_start, db)`` — LLM body. Pulls past +
  upcoming events and journal entries, builds the prompt, calls Ollama,
  returns ``{summary, past_count, upcoming_count}``. Raises bare Exception
  on LLM failure; the route handler in main.py translates to HTTP 503.

Extracted from main.py in Stage 1 (substep 1A.7b).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

import database.models as models

from services.ai.ollama_client import chat


# Note: the conditional reflections line is interpolated as a single string
# parameter (``reflections_line``) rather than embedded as a conditional
# expression in an f-string, so this template can be a module-level constant.
_PROMPT_TEMPLATE = """You are a friendly productivity assistant for a student/developer using a local calendar app.

Last week's events:
{past_summary}

Upcoming week's events:
{upcoming_summary}{journal_block}

Write a SHORT weekly review (3-5 sentences max). Include:
1. One sentence summarising what last week looked like (themes, workload).
2. One observation — e.g. busiest day, a recurring topic, or if it was light.
3. One sentence previewing the week ahead with a practical focus tip.
{reflections_line}

Keep the tone warm and motivating. Do not list every event. Plain text only, no markdown."""


_WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def compute_weekly_metrics(week_start: datetime, db: Session) -> dict:
    """Aggregate hours, busiest day, task completion, and per-timeline hours.

    Pure-function aggregation — no LLM, no external calls. Used by the cache
    route POST /reviews/weekly.
    """
    week_end = week_start + timedelta(days=7)
    events = db.query(models.Event).filter(
        models.Event.start_time >= week_start.isoformat(),
        models.Event.start_time <  week_end.isoformat(),
    ).all()

    total_minutes = 0
    minutes_per_day: dict[int, int] = {}
    minutes_per_timeline: dict[int, int] = {}
    for ev in events:
        try:
            s = datetime.fromisoformat(ev.start_time)
            e = datetime.fromisoformat(ev.end_time)
        except ValueError:
            continue
        mins = max(0, int((e - s).total_seconds() / 60))
        total_minutes += mins
        minutes_per_day[s.weekday()] = minutes_per_day.get(s.weekday(), 0) + mins
        minutes_per_timeline[ev.calendar_id] = minutes_per_timeline.get(ev.calendar_id, 0) + mins

    busiest_day = None
    if minutes_per_day:
        idx = max(minutes_per_day, key=minutes_per_day.get)
        busiest_day = {"weekday": _WEEKDAY_NAMES[idx], "hours": round(minutes_per_day[idx] / 60, 1)}

    tasks_total = db.query(models.Task).filter(
        models.Task.added_at >= week_start.isoformat(),
        models.Task.added_at <  week_end.isoformat(),
    ).all()
    completed = sum(1 for t in tasks_total if t.is_complete)
    total = len(tasks_total)
    completion_rate = round(completed / total, 2) if total else None

    timeline_names = {c.id: c.name for c in db.query(models.Calendar).all()}
    hours_per_timeline = {
        timeline_names.get(tid, f"#{tid}"): round(m / 60, 1)
        for tid, m in minutes_per_timeline.items()
    }

    return {
        "total_hours": round(total_minutes / 60, 1),
        "busiest_day": busiest_day,
        "completion_rate": completion_rate,
        "completed_tasks": completed,
        "total_tasks": total,
        "hours_per_timeline": hours_per_timeline,
    }


def generate_weekly_narrative(week_start: datetime, db: Session) -> dict:
    """Build the prompt and call Ollama for a 3–5 sentence narrative.

    Returns ``{summary, past_count, upcoming_count}``. Raises bare Exception
    on LLM failure — the route handler in main.py translates to HTTP 503.
    """
    week_end = week_start + timedelta(days=7)
    next_end = week_end + timedelta(days=7)

    past_events = db.query(models.Event).filter(
        models.Event.start_time >= week_start.isoformat(),
        models.Event.start_time <  week_end.isoformat(),
    ).all()
    upcoming_events = db.query(models.Event).filter(
        models.Event.start_time >= week_end.isoformat(),
        models.Event.start_time <  next_end.isoformat(),
    ).all()

    past_summary     = [{"title": e.title, "start": e.start_time} for e in past_events]
    upcoming_summary = [{"title": e.title, "start": e.start_time} for e in upcoming_events]

    journal_entries = db.query(models.JournalEntry).filter(
        models.JournalEntry.date >= week_start.strftime("%Y-%m-%d"),
        models.JournalEntry.date <  week_end.strftime("%Y-%m-%d"),
    ).all()
    journal_block = ""
    if journal_entries:
        transcripts = [f"- [{e.date}] {e.transcript}" for e in journal_entries]
        journal_block = "\n\nJournal reflections from last week:\n" + "\n".join(transcripts)

    reflections_line = (
        "4. A brief 'Reflections' note drawn from the journal entries."
        if journal_entries else ""
    )

    prompt = _PROMPT_TEMPLATE.format(
        past_summary=json.dumps(past_summary, indent=2),
        upcoming_summary=json.dumps(upcoming_summary, indent=2),
        journal_block=journal_block,
        reflections_line=reflections_line,
    )

    summary = chat(prompt).strip()
    return {
        "summary": summary,
        "past_count": len(past_events),
        "upcoming_count": len(upcoming_events),
    }
