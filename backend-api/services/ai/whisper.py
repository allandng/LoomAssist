"""Faster-Whisper STT singleton with lazy load + lifespan teardown.

Owns the WhisperModel instance. Replaces `main.py`'s module-level `model =
WhisperModel(...)` eager-load. The lifespan calls `get_model()` once at
startup (preserving eager-load semantics) and `release_model()` at shutdown
so CTranslate2's worker pool can be GC'd on uvicorn --reload / app quit.

Extracted from main.py in Stage 1 (substep 1A.6). No prompt logic here —
just the model singleton; transcription routes live in main.py and call
get_model() to get a reference.
"""
from __future__ import annotations


_model = None


def get_model():
    """Return the WhisperModel singleton, lazy-loading on first call.

    base.en, int8, CPU. The import of `faster_whisper` stays inside this
    function so module import is cheap and tests that stub the package via
    `sys.modules.setdefault("faster_whisper", MagicMock())` continue to work.
    """
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        _model = WhisperModel("base.en", device="cpu", compute_type="int8")
    return _model


def release_model() -> None:
    """Null the singleton so CTranslate2's worker pool can be GC'd. Idempotent."""
    global _model
    _model = None


def is_loaded() -> bool:
    """True iff the WhisperModel singleton has been instantiated. Public-facing
    accessor used by `test_lifespan_stage0` to assert lifespan startup loaded
    the model and shutdown released it, without reaching into ``_model``.
    """
    return _model is not None
