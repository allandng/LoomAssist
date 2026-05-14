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
import os
import tempfile
import json
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
from services.ai.briefing import compute_briefing
from services.ai.parse_datetime import parse_nl_datetime
from services.ai.reminders import infer_reminder as _infer_reminder  # alias avoids shadowing the route handler `infer_reminder(req)` below
from services.ai.intent import extract_intent, execute_intent
from services.ai.weekly_review import compute_weekly_metrics as _compute_weekly_metrics, generate_weekly_narrative
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

# ==========================================
# NATURAL LANGUAGE DATETIME PARSER
# ==========================================

class DatetimeParseRequest(BaseModel):
    input: str

@app.post("/parse/datetime")
async def parse_datetime_nl(req: DatetimeParseRequest):
    try:
        return parse_nl_datetime(req.input)
    except (ValueError, KeyError):
        raise HTTPException(status_code=422,
            detail={"error": {"code": "parse_failed", "detail": f"Could not parse: {req.input!r}"}})
    except Exception as e:
        logger.warning(f"NL datetime parse error: {e}")
        raise HTTPException(status_code=422,
            detail={"error": {"code": "llm_unavailable", "detail": "LLM returned an invalid response."}})

# ==========================================
# INTENT ENGINE
# ==========================================
# ==========================================
# QUICK-ADD INTENT ROUTE (Phase 5 extended)
# ==========================================
class IntentRequest(BaseModel):
    text: str
    calendar_id: Optional[int] = None

@app.post('/intent')
def process_intent(request: IntentRequest, db: Session = Depends(get_db)):
    try:
        intent_data = extract_intent(request.text)
        result = execute_intent(intent_data, db)
        return {"status": "success", "result": result, "intent": intent_data}
    except Exception as e:
        logger.error(f"Intent processing failed: {e}")
        raise HTTPException(status_code=500,
            detail={'error': {'code': 'intent_failed', 'detail': str(e)}})

# ==========================================
# WEEKLY REVIEW ROUTE
# ==========================================

# ── Phase 1: Adaptive Reminders ──────────────────────────────────────────────

class InferReminderRequest(BaseModel):
    title: str
    description: Optional[str] = None

class InferReminderResponse(BaseModel):
    minutes: int
    rationale: str

@app.post("/ai/infer-reminder", response_model=InferReminderResponse)
def infer_reminder(req: InferReminderRequest):
    try:
        result = _infer_reminder(req.title, req.description)
        return InferReminderResponse(**result)
    except Exception as e:
        logger.error(f"infer-reminder error: {e}")
        return InferReminderResponse(minutes=15, rationale="Default reminder")

# ─────────────────────────────────────────────────────────────────────────────


class WeeklyReviewRequest(BaseModel):
    week_start: str  # ISO datetime — the Monday 00:00:00 of the week to review

# DEPRECATED: prefer POST /reviews/weekly which persists the result. This route
# is retained for backwards compatibility — frontend uses it as the one-shot
# fallback when no cached row exists yet.
@app.post("/ai/weekly-review")
async def weekly_review(req: WeeklyReviewRequest, db: Session = Depends(get_db)):
    week_start = datetime.fromisoformat(req.week_start)
    try:
        return generate_weekly_narrative(week_start, db)
    except Exception as e:
        logger.warning(f"Weekly review LLM error: {e}")
        raise HTTPException(status_code=503,
            detail={"error": {"code": "llm_unavailable", "detail": "Could not generate weekly review."}})

# ─────────────────────────────────────────────────────────────────────────────
# Cached weekly reviews — persistent storage of generated reviews

class WeeklyReviewGenRequest(BaseModel):
    week_start: Optional[str] = None  # ISO date for the Monday; defaults to last Monday

def _last_monday_iso() -> str:
    today = datetime.now()
    dow = today.weekday()  # Mon=0, Sun=6
    days_back = 7 if dow == 0 else dow
    last_mon = (today - timedelta(days=days_back)).replace(hour=0, minute=0, second=0, microsecond=0)
    return last_mon.date().isoformat()

@app.get("/reviews/weekly")
def get_cached_weekly_review(week_start: str, db: Session = Depends(get_db)):
    # Accept ISO datetime or ISO date — normalise to date for the index lookup.
    try:
        ws_date = datetime.fromisoformat(week_start).date().isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": {"code": "bad_week_start"}})
    row = db.query(models.WeeklyReview).filter(models.WeeklyReview.week_start == ws_date).first()
    if not row:
        raise HTTPException(status_code=404, detail={"error": {"code": "no_review", "detail": "No cached review for this week."}})
    return {
        "id": row.id,
        "week_start": row.week_start,
        "markdown": row.markdown,
        "metrics": json.loads(row.metrics) if row.metrics else {},
        "generated_at": row.generated_at,
    }

@app.post("/reviews/weekly")
async def generate_and_cache_weekly_review(req: WeeklyReviewGenRequest, db: Session = Depends(get_db)):
    week_start_str = req.week_start or _last_monday_iso()
    try:
        ws = datetime.fromisoformat(week_start_str)
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": {"code": "bad_week_start"}})
    ws_date = ws.date().isoformat()

    metrics = _compute_weekly_metrics(ws, db)

    inner = WeeklyReviewRequest(week_start=ws.isoformat())
    one_shot = await weekly_review(inner, db)
    markdown = one_shot.get("summary", "")

    existing = db.query(models.WeeklyReview).filter(models.WeeklyReview.week_start == ws_date).first()
    now_iso = datetime.now().isoformat()
    if existing:
        existing.markdown = markdown
        existing.metrics = json.dumps(metrics)
        existing.generated_at = now_iso
    else:
        existing = models.WeeklyReview(
            week_start=ws_date,
            markdown=markdown,
            metrics=json.dumps(metrics),
            generated_at=now_iso,
        )
        db.add(existing)
    db.commit()
    db.refresh(existing)
    return {
        "id": existing.id,
        "week_start": existing.week_start,
        "markdown": existing.markdown,
        "metrics": metrics,
        "generated_at": existing.generated_at,
    }

# ==========================================
# TRANSCRIPTION ROUTE
# ==========================================

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...), db: Session = Depends(get_db)):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:
        temp_audio.write(await file.read())
        temp_file_path = temp_audio.name

    try:
        segments, info = whisper.get_model().transcribe(temp_file_path, beam_size=5)
        raw_text = "".join([segment.text for segment in segments]).strip()
        sentences = [sentence.strip() + "." for sentence in raw_text.split(".") if sentence.strip()]
        
        intents = []
        execution_results = []
        
        for sentence in sentences:
            try:
                intent_data = extract_intent(sentence)
                intents.append({"sentence": sentence, "intent": intent_data})
                result = execute_intent(intent_data, db)
                # For non-create intents that need confirmation, include the full result
                # so the frontend can surface a confirmation toast instead of auto-applying
                execution_results.append(result)
            except Exception as e:
                logger.error(f"Voice intent processing error: {e}")
                execution_results.append({"error": {"code": "llm_unavailable", "detail": "Local LLM engine is offline."}})

        return {
            "status": "success",
            "raw_text": raw_text,
            "parsed_data": intents,
            "execution_results": execution_results,
        }
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)


# ── Phase 5: Apply confirmed voice intent ────────────────────────────────────

class ApplyIntentRequest(BaseModel):
    action: str          # "move_event" | "cancel_event" | "resize_event"
    event_id: int
    proposed_change: dict

@app.post("/intent/apply")
def apply_intent(req: ApplyIntentRequest, db: Session = Depends(get_db)):
    ev = db.query(models.Event).filter(models.Event.id == req.event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    if req.action == "cancel_event":
        db.delete(ev)
        db.commit()
        return {"status": "deleted", "event_id": req.event_id}

    change = req.proposed_change
    if "start_time" in change:
        ev.start_time = change["start_time"]
    if "end_time" in change:
        ev.end_time = change["end_time"]
    db.commit()
    db.refresh(ev)
    return {"status": "updated", "event": ev.model_dump()}

# ─────────────────────────────────────────────────────────────────────────────


# ==========================================
# AI BRIEFING (Future-features 2C)
# ==========================================

@app.post("/ai/briefing")
def ai_briefing(db: Session = Depends(get_db)):
    """Plain-text summary of today's events, suitable for TTS."""
    return compute_briefing(db)

# ─────────────────────────────────────────────────────────────────────────────