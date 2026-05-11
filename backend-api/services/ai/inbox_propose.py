"""LLM-driven inbox-item time-slot proposal. Backs POST /inbox/{item_id}/propose.

Given an inbox text and a candidate list of free slots (pre-computed by
``_find_free_slots_internal``), asks Llama to pick the best one and estimate
duration. Falls back to the first candidate slot + 60 min on LLM failure.

Returns a plain ``{proposed_start, proposed_duration, rationale}`` dict;
the route handler writes proposed_start/proposed_duration back to the
InboxItem row and wraps in ``InboxProposeResponse``.

Extracted from main.py in Stage 1 (substep 1A.7b).
"""
from __future__ import annotations

import json
import re

from loom_logger import get_logger

from services.ai.ollama_client import chat


logger = get_logger("ai.inbox_propose")


# Note: literal `{...}` in the JSON example is escaped to `{{...}}` for .format().
_PROMPT_TEMPLATE = (
    'Schedule this task: "{item_text}"\n'
    "Available slots (next 7 days, during working hours):\n{slots_text}\n"
    'Pick the most appropriate slot and estimate duration. '
    'Respond ONLY as JSON: {{"proposed_start":"ISO","proposed_duration":60,"rationale":"one sentence"}}. '
    "No markdown."
)


def propose_inbox_slot(item_text: str, candidates: list[dict]) -> dict:
    """Pick the best slot for an inbox item; estimate duration.

    Args:
        item_text: the user's inbox text.
        candidates: free-slot dicts with a ``start`` key (output of
            ``_find_free_slots_internal``). May be empty.

    Returns:
        ``{proposed_start: str | None, proposed_duration: int, rationale: str}``.
        ``proposed_start`` is ``None`` only when no candidates were supplied
        *and* the LLM didn't echo back a valid start.
    """
    slots_text = (
        "\n".join(f'{i+1}. {s["start"]}' for i, s in enumerate(candidates[:3]))
        if candidates else "no candidates"
    )
    prompt = _PROMPT_TEMPLATE.format(item_text=item_text, slots_text=slots_text)

    try:
        content = chat(prompt).strip()
        match = re.search(r'\{.*?\}', content, re.DOTALL)
        if not match:
            raise ValueError("no JSON in response")
        data = json.loads(match.group(0))
        proposed_start    = data.get("proposed_start") or (candidates[0]["start"] if candidates else None)
        proposed_duration = int(data.get("proposed_duration") or 60)
        rationale         = data.get("rationale", "Best available slot")
    except Exception as e:
        logger.warning(f"inbox propose LLM error: {e}")
        proposed_start    = candidates[0]["start"] if candidates else None
        proposed_duration = 60
        rationale         = "First available slot"

    return {
        "proposed_start": proposed_start,
        "proposed_duration": proposed_duration,
        "rationale": rationale,
    }
