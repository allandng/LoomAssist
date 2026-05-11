"""Shared Ollama client wrapper.

Centralizes `MODEL = "llama3.2"` so the 8 LLM call-sites across the backend
don't each duplicate the model name string. Future per-feature model
selection or a Stage 7 "cloud-boost" toggle (roadmap §5) would route through
this single choke-point.

Naming convention (per Stage 1 design):
- `from ollama import chat as _ollama_chat` inside this module — the
  underlying package function is renamed for clarity, eliminating shadow
  collisions when callers `from services.ai.ollama_client import chat`.
- The wrapper's public name is `chat`.
"""
from __future__ import annotations

from ollama import chat as _ollama_chat


MODEL = "llama3.2"


def chat(prompt: str) -> str:
    """Send a single user message to Llama 3.2; return raw assistant text content.

    Mirrors the `ollama.chat(model=..., messages=[{...}])` pattern that
    every call-site in the backend repeats. Response-shape parsing
    (regex / json.loads) stays in each caller because prompt formats differ.
    """
    response = _ollama_chat(model=MODEL, messages=[{"role": "user", "content": prompt}])
    return response["message"]["content"]
