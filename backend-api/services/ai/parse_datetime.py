"""Natural-language datetime parser via Llama 3.2. Backs POST /parse/datetime.

Returns a plain `{"iso", "display"}` dict on success; raises `ValueError` if
the LLM response is not a valid ISO datetime. The route handler in main.py
converts ValueError into HTTP 422.

Extracted from main.py in Stage 1 (substep 1A.7a).
"""
from __future__ import annotations

from datetime import datetime

from services.ai.ollama_client import chat


_PROMPT_TEMPLATE = (
    'Today is {now_str}.\n'
    'The user typed: "{user_input}"\n\n'
    'Parse this into an ISO 8601 datetime string (YYYY-MM-DDTHH:MM:SS).\n'
    'If no time is specified, use 09:00:00.\n'
    '"afternoon" = 14:00, "morning" = 09:00, "evening" = 18:00, "night" = 20:00.\n'
    'Respond with ONLY the ISO datetime string. No explanation.'
)


def parse_nl_datetime(user_input: str) -> dict:
    """Parse a natural-language datetime via Llama 3.2.

    Returns `{"iso": "<ISO 8601>", "display": "<human-friendly>"}` on success.
    Raises `ValueError` if the LLM response is not a valid ISO datetime.
    """
    now_str = datetime.now().isoformat()
    prompt = _PROMPT_TEMPLATE.format(now_str=now_str, user_input=user_input)
    raw = chat(prompt).strip()
    parsed = datetime.fromisoformat(raw)  # raises ValueError if malformed
    display = parsed.strftime("%a %b %d, %Y at %I:%M %p")
    return {"iso": parsed.isoformat(), "display": display}
