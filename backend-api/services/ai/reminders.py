"""Reminder lead-time inference via Llama 3.2. Backs POST /ai/infer-reminder.

Also called inline from /events/ (create + update) and /inbox/{id}/propose
when reminder_minutes is not provided by the caller.

Returns a plain `{"minutes", "rationale"}` dict; route handler wraps in
InferReminderResponse. Output is snapped to a fixed allowed-minutes set so
the LLM can't surface arbitrary values.

Extracted from main.py in Stage 1 (substep 1A.7a).
"""
from __future__ import annotations

import json
import re

from services.ai.ollama_client import chat


# Snap LLM-suggested minutes to one of these values.
_ALLOWED_MINUTES = {0, 5, 10, 15, 30, 60, 1440}


# Note: literal `{...}` in the JSON example is escaped to `{{...}}` for .format().
_PROMPT_TEMPLATE = (
    "Given an event titled '{title}'.{desc_part} "
    "Suggest a reminder lead time in minutes from this fixed list: "
    "0, 5, 10, 15, 30, 60, 1440. "
    'Respond ONLY as JSON {{"minutes": <int>, "rationale": "<one sentence>"}}. '
    "No markdown, no extra text."
)


def infer_reminder(title: str, description: str | None) -> dict:
    """Call Ollama to suggest a reminder lead time. Returns {minutes, rationale}."""
    desc_part = f" Description: {description}" if description else ""
    prompt = _PROMPT_TEMPLATE.format(title=title, desc_part=desc_part)
    content = chat(prompt).strip()
    match = re.search(r'\{.*?\}', content, re.DOTALL)
    if not match:
        return {"minutes": 15, "rationale": "Default reminder"}
    data = json.loads(match.group(0))
    minutes = int(data.get("minutes", 15))
    if minutes not in _ALLOWED_MINUTES:
        # Snap to nearest allowed value
        minutes = min(_ALLOWED_MINUTES, key=lambda x: abs(x - minutes))
    return {"minutes": minutes, "rationale": data.get("rationale", "")}
