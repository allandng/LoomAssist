import _runtime_env  # noqa: F401  MUST be first import — sets env vars before torch/CT2/tokenizers load
from loom_logger import get_logger, write_crash_snapshot, LOG_FILE, CRASH_FLAG
import logging
logging.basicConfig(handlers=[])  # suppress root handler noise

from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List
from sqlalchemy.orm import Session
from pydantic import BaseModel
import asyncio
import gc
from contextlib import asynccontextmanager
# Test-only rebind: tests/test_backup.py patches main.os.path.exists and
# main.os.environ.get. The os module is no longer used by main.py directly
# (transcribe migrated to routers/intelligence.py in 1B.6), but the import
# keeps the test's patch target resolvable until Stage 1.5 rewrites the
# test to patch the canonical call sites in services/crypto/backup.py.
import os  # noqa: F401
import re
from datetime import datetime, timedelta
from sqlmodel import select
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
import shutil
from pathlib import Path
from database.database import SessionLocal, engine, create_db_and_tables, run_migrations, migrate_todo_to_task
from database import models
from core.deps import get_db, _check_rate
from core.middleware import CrashMiddleware
from services.integrations.ics import _refresh_subscription
# Test-only rebind: tests/test_backup.py imports `_encrypt_backup`/`_decrypt_backup`
# directly from `main`. The router now uses these via services.crypto.backup,
# but the rebind keeps the test's import path working until Stage 1.5 cleanup.
from services.crypto.backup import _encrypt_backup, _decrypt_backup  # noqa: F401
# Test-only rebind: tests/test_sync.py mutates `main._pairing_codes` directly
# (`_m._pairing_codes[code]["expires"] = ...`). The router uses _pairing_codes
# from services.lan.pairing; the dict is shared by reference. Until the test
# is rewritten to reference the canonical location (post-Stage-1 cleanup),
# the import here keeps `main._pairing_codes` resolvable.
from services.lan.pairing import _pairing_codes  # noqa: F401
from services.lan.discovery import _maybe_start_mdns, stop_mdns
from services.lan.exchange import _auto_sync_loop
from services.ai import whisper, embedder
# Test-only rebind: tests/test_voice_edit.py imports `execute_intent` directly
# from `main`. The router uses this lazy inside the handler now, but the rebind
# keeps the test's import path working until Stage 1.5 cleanup rewrites the
# test to import from services.ai.intent.
from services.ai.intent import execute_intent  # noqa: F401
# Cloud-sync (v2.2) — call-sites use the `_sync_*` / `_kb` aliases throughout;
# `_json_sync` / `_uuid_sync` are aliased duplicates of `json` / `uuid` retained
# to keep the cloud-sync section's "this is sync namespace" markers at call sites.
from services.sync import dedup as _sync_dedup  # noqa: F401  (imported for tests / future use)
from services.sync import runner as _sync_runner

# 1B routers — each module owns its own APIRouter; included after CORS below.
from routers import system
from routers import calendars
from routers import pomodoro
from routers import task_templates
from routers import habits
from routers import search
from routers import subscriptions
from routers import templates
from routers import tasks
from routers import journal
from routers import study_blocks
from routers import availability
from routers import inbox
from routers import courses
from routers import backup
from routers import integrations
from routers import lan_sync
from routers import auth
from routers import sync_review
from routers import connections
from routers import cloud_sync
from routers import events
from routers import scheduling
from routers import intelligence

# Run column migrations FIRST (adds missing columns to existing DB)
run_migrations()

# Drop legacy todo table and create task table if needed
migrate_todo_to_task()

# Then create any brand-new tables (including task)
create_db_and_tables()

# Wire the cloud-sync runner with the SessionLocal factory. The actual
# runner.start() call lives in the FastAPI lifespan below so it pairs with
# runner.stop() on shutdown.
_sync_runner.configure(SessionLocal)

# ── Stage 0: lifespan-managed background tasks ──────────────────────────────
# Long-running asyncio task handles, stored at module scope so the lifespan
# finally-block can cancel them. Without this, fire-and-forget tasks
# accumulate across uvicorn --reload cycles and contribute to leaked-semaphore
# warnings on quit.
_subscription_task: "Optional[asyncio.Task]" = None
_auto_sync_task: "Optional[asyncio.Task]" = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Single source for startup + shutdown logic. Replaces the deprecated
    @app.on_event handlers. See CLAUDE.md → Backend lifecycle.

    Startup: eagerly load the WhisperModel singleton (so /transcribe doesn't
    pay first-request latency), then spawn the subscription-refresher and
    LAN auto-sync background tasks, start the cloud-sync runner, register
    mDNS. Shutdown runs in reverse: stop mDNS, stop the runner, cancel the
    two background tasks, release the embedder + Whisper singletons, gc."""
    global _subscription_task, _auto_sync_task

    # ── Startup ──────────────────────────────────────────────────────────────
    whisper.get_model()  # eager-load so /transcribe avoids first-request latency
    _subscription_task = asyncio.create_task(_subscription_refresher_loop())
    _auto_sync_task    = asyncio.create_task(_auto_sync_loop())
    _sync_runner.start()
    _maybe_start_mdns()

    try:
        yield
    finally:
        # ── Shutdown (reverse order) ────────────────────────────────────────
        stop_mdns()
        await _sync_runner.stop()

        for t in (_subscription_task, _auto_sync_task):
            if t is not None:
                t.cancel()
        await asyncio.gather(
            *(t for t in (_subscription_task, _auto_sync_task) if t is not None),
            return_exceptions=True,
        )
        _subscription_task = None
        _auto_sync_task = None

        # Release on-device AI singletons so CTranslate2's worker pool and
        # the sentence-transformers model can be GC'd on uvicorn --reload / quit.
        embedder.release_model()
        whisper.release_model()
        gc.collect()


app = FastAPI(title="Loom Backend API", lifespan=lifespan)

logger = get_logger("main")


async def _subscription_refresher_loop():
    """Background loop: refresh iCal subscriptions on schedule (Phase 9).
    Started + cancelled by the FastAPI lifespan in this file."""
    while True:
        await asyncio.sleep(60)  # check every minute
        try:
            with SessionLocal() as db:
                subs = db.query(models.Subscription).filter(models.Subscription.enabled == True).all()  # noqa: E712
                for sub in subs:
                    if not sub.last_synced:
                        should_refresh = True
                    else:
                        try:
                            last = datetime.fromisoformat(sub.last_synced)
                            should_refresh = (datetime.now() - last).total_seconds() >= sub.refresh_minutes * 60
                        except ValueError:
                            should_refresh = True
                    if should_refresh:
                        await _refresh_subscription(sub, db)
        except Exception as e:
            logger.error(f"Subscription refresher loop error: {e}")


app.add_middleware(CrashMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "tauri://localhost",
        "http://tauri.localhost",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1B router includes — grows as each leaf migration lands.
app.include_router(system.router)
app.include_router(calendars.router)
app.include_router(pomodoro.router)
app.include_router(task_templates.router)
app.include_router(habits.router)
app.include_router(search.router)
app.include_router(subscriptions.router)
app.include_router(templates.router)
app.include_router(tasks.router)
app.include_router(journal.router)
app.include_router(study_blocks.router)
app.include_router(availability.router)
app.include_router(inbox.router)
app.include_router(courses.router)
app.include_router(backup.router)
app.include_router(integrations.router)
app.include_router(lan_sync.router)
app.include_router(auth.router)
app.include_router(sync_review.router)
app.include_router(connections.router)
app.include_router(cloud_sync.router)
app.include_router(events.router)
app.include_router(scheduling.router)
app.include_router(intelligence.router)

