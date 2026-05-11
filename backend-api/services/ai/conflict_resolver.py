"""LLM-driven conflict-resolution suggestions. Backs POST /schedule/resolve-conflict.

Given an event being rescheduled, its conflicting events, and a candidate
list of free slots (pre-computed by ``_find_free_slots_internal``), asks
Llama to pick the best 3 alternatives with one-sentence rationales.

Returns a list of plain dicts shaped like the route's ``Suggestion`` Pydantic
class so the route can wrap via ``Suggestion(**s)``. Falls back to top-3 raw
candidates with a generic rationale on LLM failure — never raises.

Extracted from main.py in Stage 1 (substep 1A.7b).
"""
from __future__ import annotations

import json
import re

from loom_logger import get_logger

from services.ai.ollama_client import chat


logger = get_logger("ai.conflict_resolver")


# Note: literal `{...}` in the JSON example are escaped to `{{...}}` for .format().
_PROMPT_TEMPLATE = (
    'Event "{event_title}" conflicts with: {conflict_titles}.\n'
    "Pick the best 3 alternatives from these free slots and explain each in one sentence:\n"
    "{slots_text}\n"
    'Respond ONLY as JSON array: [{{"start":"ISO","end":"ISO","rationale":"..."}},...]. '
    "No markdown, no extra text. Limit to 3 items."
)


def resolve_conflict_suggestions(event_title: str, conflict_titles: list[str], candidates: list[dict]) -> list[dict]:
    """Pick 3 best alternative slots via LLM; fall back to top candidates.

    Args:
        event_title: title of the event being rescheduled.
        conflict_titles: titles of events currently conflicting.
        candidates: list of free-slot dicts with ``{start, end}`` keys
            (output of ``_find_free_slots_internal``).

    Returns:
        list of ``{start, end, rationale}`` dicts (≤3 items). Empty list if
        no candidates were supplied. On LLM failure, returns the first 3
        candidates with a generic "Available slot" rationale.
    """
    if not candidates:
        return []

    conflict_titles_str = ", ".join(conflict_titles)
    slots_text = "\n".join(
        f'{i+1}. {s["start"]} — {s["end"]}' for i, s in enumerate(candidates[:5])
    )
    prompt = _PROMPT_TEMPLATE.format(
        event_title=event_title,
        conflict_titles=conflict_titles_str,
        slots_text=slots_text,
    )

    try:
        content = chat(prompt).strip()
        match = re.search(r'\[.*\]', content, re.DOTALL)
        if not match:
            raise ValueError("no JSON array in response")
        raw = json.loads(match.group(0))
        return [
            {"start": item["start"], "end": item["end"], "rationale": item.get("rationale", "")}
            for item in raw[:3] if "start" in item and "end" in item
        ]
    except Exception as e:
        logger.warning(f"resolve-conflict LLM error, falling back to top slots: {e}")
        return [
            {"start": s["start"], "end": s["end"], "rationale": "Available slot"}
            for s in candidates[:3]
        ]
