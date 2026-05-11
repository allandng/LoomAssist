"""LLM-driven syllabus event extraction. Backs POST /documents/extract-syllabus.

Called from main.py's extract_syllabus route after PdfReader yields text.
Returns a plain list of {title, date} dicts; route maps them into events the
user reviews + approves via POST /documents/save-approved-events.

Extracted from main.py in Stage 1 (substep 1A.7b — deferred from 1A.4 because
it calls Ollama, not a pure file-format adapter).
"""
from __future__ import annotations

import json
import re
from datetime import datetime

from loom_logger import get_logger

from services.ai.ollama_client import chat


logger = get_logger("ai.syllabus")


_PROMPT_TEMPLATE = (
    "Today is {today}. Extract all assignments, exams, and due dates from this syllabus text.\n"
    "Return ONLY a JSON array of objects with 'title' and 'date' (YYYY-MM-DD format).\n"
    "Do not include preamble or markdown formatting.\n"
    "Syllabus text: {text}"
)


def extract_syllabus_events(text: str) -> list:
    """Call Ollama to extract due dates and assignments from a syllabus.

    Returns a list of dicts with 'title' and 'date' keys.
    Returns [] on LLM failure or invalid JSON — never raises.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    prompt = _PROMPT_TEMPLATE.format(today=today, text=text)
    try:
        content = chat(prompt).strip()
        match = re.search(r'\[.*\]', content, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        return []
    except Exception as e:
        logger.error(f"Syllabus LLM extraction error: {str(e)}")
        return []
