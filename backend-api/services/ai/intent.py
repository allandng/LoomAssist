"""Voice/text intent extraction + execution.

Two public functions:

- ``extract_intent(sentence)`` — LLM classification of a natural-language command
  into a structured ``{action, parameters}`` dict. Used by POST /intent and the
  /transcribe pipeline.

- ``execute_intent(intent, db)`` — pure DB/orchestration. For ``create_event``
  writes immediately; for ``move_event`` / ``cancel_event`` / ``resize_event``
  resolves the target via ``event_resolver`` and returns either
  ``pending_confirm`` (single match), ``ambiguous`` (multiple), or ``not_found``.
  No LLM call inside this function — it's grouped here for cohesion since the
  two are always used together by the /intent and /transcribe call-sites.

The ``apply_intent`` *route handler* (POST /intent/apply) is a thin DB-mutation
endpoint that stays in main.py.

Extracted from main.py in Stage 1 (substep 1A.7b).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

import database.models as models
from loom_logger import get_logger

from services.ai.ollama_client import chat
from services.event_resolver import resolve_event_by_query


logger = get_logger("ai.intent")


# Note: literal `{...}` in the JSON examples are escaped to `{{...}}` for .format().
_PROMPT_TEMPLATE = (
    "Current time: {current_time}\n"
    "Classify the following command and extract parameters.\n"
    "Return ONLY JSON (no markdown) matching one of:\n"
    '  {{"action":"create_event","parameters":{{"title":"...","date":"YYYY-MM-DD","time":"HH:MM","duration_minutes":60}}}}\n'
    '  {{"action":"move_event","parameters":{{"event_query":"...","new_start":"ISO datetime"}}}}\n'
    '  {{"action":"cancel_event","parameters":{{"event_query":"..."}}}}\n'
    '  {{"action":"resize_event","parameters":{{"event_query":"...","new_duration_minutes":30}}}}\n'
    'Command: "{sentence}"'
)


def extract_intent(sentence: str) -> dict:
    """Ask Llama to classify the user's voice/text command into a structured intent."""
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    prompt = _PROMPT_TEMPLATE.format(current_time=current_time, sentence=sentence)
    try:
        content = chat(prompt).strip()
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        return {"action": "parse_error", "detail": "No JSON in LLM response"}
    except Exception as e:
        logger.error(f"LLM intent extraction error: {e}")
        return {"action": "parse_error", "detail": str(e)}


def execute_intent(intent: dict, db: Session) -> dict:
    """Apply or resolve an extracted intent.

    For ``create_event``: writes the event immediately and returns
    ``{status: 'created', event_id, event}``.

    For ``move_event`` / ``cancel_event`` / ``resize_event``: resolves the
    event-query → returns ``pending_confirm`` (single match), ``ambiguous``
    (multiple), or ``not_found``.
    """
    action = intent.get("action")
    params = intent.get("parameters", {})

    if action == "create_event":
        title    = params.get("title", "New Event")
        date_str = params.get("date", datetime.now().strftime("%Y-%m-%d"))
        time_str = params.get("time", "09:00")
        dur      = int(params.get("duration_minutes") or 60)
        try:
            start_dt = datetime.fromisoformat(f"{date_str}T{time_str}")
        except ValueError:
            start_dt = datetime.now()
        end_dt = start_dt + timedelta(minutes=dur)
        cal = db.query(models.Calendar).first()
        if not cal:
            return {"action": action, "status": "error", "detail": "No calendar found"}
        db_event = models.Event(
            title=title,
            start_time=start_dt.isoformat(),
            end_time=end_dt.isoformat(),
            calendar_id=cal.id,
            reminder_source="none",
        )
        db.add(db_event)
        db.commit()
        db.refresh(db_event)
        return {"action": action, "status": "created", "event_id": db_event.id, "event": db_event.model_dump()}

    if action in ("move_event", "cancel_event", "resize_event"):
        query     = params.get("event_query", "")
        when_hint = params.get("new_start") or None
        best, candidates = resolve_event_by_query(query, when_hint, db)

        if not candidates:
            return {"action": action, "status": "not_found", "detail": f"No event matching '{query}'"}

        if best is None:
            return {
                "action": action, "status": "ambiguous",
                "candidates": [{"id": e.id, "title": e.title, "start_time": e.start_time} for e in candidates[:5]],
            }

        proposed_change: dict = {}
        if action == "move_event":
            new_start_str = params.get("new_start", "")
            try:
                new_start = datetime.fromisoformat(new_start_str)
                orig_dur  = (datetime.fromisoformat(best.end_time) - datetime.fromisoformat(best.start_time))
                proposed_change = {"start_time": new_start.isoformat(), "end_time": (new_start + orig_dur).isoformat()}
            except ValueError:
                return {"action": action, "status": "error", "detail": "Could not parse new_start"}

        elif action == "cancel_event":
            proposed_change = {"delete": True}

        elif action == "resize_event":
            new_dur = int(params.get("new_duration_minutes") or 30)
            new_end = datetime.fromisoformat(best.start_time) + timedelta(minutes=new_dur)
            proposed_change = {"end_time": new_end.isoformat()}

        return {
            "action": action,
            "status": "pending_confirm",
            "resolved_event_id": best.id,
            "resolved_event": {"id": best.id, "title": best.title, "start_time": best.start_time, "end_time": best.end_time},
            "proposed_change": proposed_change,
        }

    return {"action": action, "status": "error", "detail": f"Unknown action '{action}'"}
