"""LLM-driven schedule wellness analysis. One of two analyses behind
POST /schedule/analyze (the other, `_exam_cluster_warnings`, is deterministic
and stays in main.py).

Returns plain dicts shaped like the route's `WellnessWarning` Pydantic class
so the route can wrap them via `WellnessWarning(**w)` — same pattern as the
1A.2 scheduling extractions.

Extracted from main.py in Stage 1 (substep 1A.7a).
"""
from __future__ import annotations

import json
import re

from loom_logger import get_logger

from services.ai.ollama_client import chat


logger = get_logger("ai.wellness")


_PROMPT_TEMPLATE = (
    "You are a wellness assistant reviewing a daily schedule.\n"
    "Schedule:\n{schedule_text}\n"
    "Identify any of these issues (only if clearly present):\n\n"
    "No meal break (no 30+ min gap between 11am-2pm)\n"
    "Back-to-back events with no buffer (events end and start within 5 minutes)\n"
    "No commute time before first event if it starts before 9am\n"
    "No break in 4+ consecutive hours of events\n\n"
    "Respond ONLY as a JSON array of short warning strings (max 12 words each).\n"
    "If no issues found, respond with: []\n"
    'Example: ["No lunch break planned between 11am and 2pm"]'
)


def compute_llm_wellness_warnings(events) -> list[dict]:
    """Return LLM-detected schedule issues as plain dicts.

    Each dict has shape `{"message": str, "kind": "other"}`. The route handler
    wraps these in the `WellnessWarning` Pydantic model.

    `events` is a list of `ScheduleEvent`-shaped objects (any object with
    `start_time`, `end_time`, `title` attributes). Returns [] on LLM failure
    or invalid JSON — never raises.
    """
    try:
        sorted_events = sorted(events, key=lambda e: e.start_time)
        schedule_text = "\n".join(
            f"{e.start_time[11:16]}-{e.end_time[11:16]}: {e.title}"
            for e in sorted_events
        )
        prompt = _PROMPT_TEMPLATE.format(schedule_text=schedule_text)
        content = chat(prompt).strip()
        match = re.search(r'\[.*\]', content, re.DOTALL)
        if not match:
            return []
        raw = json.loads(match.group(0))
        return [{"message": str(m), "kind": "other"} for m in raw if str(m).strip()]
    except Exception as e:
        logger.warning(f"Schedule analysis failed: {str(e)}")
        return []
