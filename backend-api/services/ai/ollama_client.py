"""Shared Ollama client wrapper.

Centralizes ``MODEL = "llama3.2"`` so the 8 LLM call-sites across the
backend don't each duplicate the model-name string. Future per-feature
model selection or a Stage 7 "cloud-boost" toggle (roadmap §5) would route
through this single choke-point.

Dispatch convention: ``import ollama`` (not ``from ollama import chat``)
so attribute lookup happens at *call* time, not import time. This lets
tests use ``unittest.mock.patch("ollama.chat", ...)`` and have the patch
visible through the wrapper. The existing ``_ollama_mod.chat.return_value
= ...`` pattern used by most test files keeps working too — both patterns
target the same module attribute.
"""
from __future__ import annotations

import ollama


MODEL = "llama3.2"


def chat(prompt: str) -> str:
    """Send a single user message to Llama 3.2; return raw assistant text content.

    Mirrors the ``ollama.chat(model=..., messages=[{...}])`` pattern that
    every call-site in the backend repeats. Response-shape parsing
    (regex / ``json.loads``) stays in each caller because prompt formats
    differ.

    Dispatched via ``ollama.chat(...)`` attribute lookup (NOT an aliased
    import like ``from ollama import chat``) so it remains patchable under
    ``unittest.mock.patch("ollama.chat", ...)``. Do NOT "optimize" this
    back to an aliased import — `test_weekly_review.py` and any future
    ``patch("ollama.chat", ...)``-style test will silently bypass the
    wrapper if the binding happens at import time.
    """
    response = ollama.chat(model=MODEL, messages=[{"role": "user", "content": prompt}])
    return response["message"]["content"]
