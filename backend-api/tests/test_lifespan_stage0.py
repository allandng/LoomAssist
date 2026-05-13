"""Stage 0 — verify the FastAPI lifespan starts and stops the sync runner task.

Without proper shutdown, fire-and-forget asyncio tasks accumulate across
uvicorn --reload cycles and contribute to the leaked-semaphore warning the
user sees on quit. This test exercises the lifespan context manager directly
(not via TestClient) and asserts the runner task is created on entry and
cancelled on exit.
"""
import sys
import asyncio
from unittest.mock import MagicMock

# ── 1. Redirect DB to in-memory SQLite before anything app-related imports ──
from sqlmodel import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

import database.database as _db

_TEST_ENGINE = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_db.engine = _TEST_ENGINE
_db.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_TEST_ENGINE)

# ── 2. Stub heavy C-extension imports the same way other test files do ──
for _mod in ("faster_whisper", "ollama", "pypdf", "sentence_transformers", "zeroconf", "caldav"):
    sys.modules.setdefault(_mod, MagicMock())
sys.modules["faster_whisper"].WhisperModel = MagicMock(return_value=MagicMock())
sys.modules["pypdf"].PdfReader = MagicMock()

# ── 3. Now it's safe to import main + the runner ──
from main import app  # noqa: E402
from services.sync import runner as _sync_runner  # noqa: E402


def test_lifespan_starts_and_stops_runner_task():
    """The runner task must be live during lifespan and torn down on exit."""

    async def go():
        assert _sync_runner._runner_task is None, "precondition: no task yet"

        async with app.router.lifespan_context(app):
            # Startup ran
            assert _sync_runner._runner_task is not None
            assert not _sync_runner._runner_task.done()

        # Shutdown ran — runner.stop() resets the global to None
        assert _sync_runner._runner_task is None

    asyncio.run(go())


def test_lifespan_loads_and_releases_whisper_model():
    """The lifespan must eagerly load the WhisperModel singleton at startup
    (so /transcribe doesn't pay first-request latency) and release it at
    shutdown so CTranslate2's worker pool can be GC'd on uvicorn --reload /
    app quit."""
    from services.ai import whisper

    async def go():
        # Precondition: model not loaded. Test isolation — a previous test's
        # shutdown should already have released it, but be defensive.
        whisper.release_model()
        assert not whisper.is_loaded()

        async with app.router.lifespan_context(app):
            # Startup eagerly loaded the model
            assert whisper.is_loaded()

        # Shutdown released the model
        assert not whisper.is_loaded()

    asyncio.run(go())
