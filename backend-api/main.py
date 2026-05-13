import _runtime_env  # noqa: F401  MUST be first import — sets env vars before torch/CT2/tokenizers load
from loom_logger import get_logger, write_crash_snapshot, LOG_FILE, CRASH_FLAG
import logging
logging.basicConfig(handlers=[])  # suppress root handler noise

from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, Form, Request
from fastapi.responses import JSONResponse, Response, HTMLResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List, Literal
from sqlalchemy.orm import Session
from pydantic import BaseModel
from services import scraper
from services.exam_cluster import detect_exam_clusters as _detect_exam_clusters
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
from pypdf import PdfReader
import shutil
import hashlib
import uuid
from pathlib import Path
from database.database import SessionLocal, engine, create_db_and_tables, run_migrations, migrate_todo_to_task
from database import models
from core.deps import get_db, _check_rate
from core.middleware import CrashMiddleware
from core.validation import validate_event_times, validate_calendar_exists, _detect_circular
from services.scheduling.conflicts import get_conflicts
from services.scheduling.find_free import _find_free_slots_internal
from services.scheduling.autopilot import compute_autopilot_proposals
from services.scheduling.procrastination import compute_procrastination_warnings
from services.scheduling.duration_stats import compute_duration_stats
from services.crypto.backup import _encrypt_backup, _decrypt_backup
from services.integrations.ics import generate_event_uid, _refresh_subscription
from services.integrations.timeline_export import build_json_export, build_ics_export
from services.lan.certs import _generate_self_signed_cert, _cert_fingerprint
from services.lan.pairing import _pairing_codes, _get_or_create_device_id
from services.lan.discovery import _maybe_start_mdns, stop_mdns, _discovered_peers
from services.lan.exchange import _auto_sync_loop
from services.ai import whisper, embedder
from services.ai.embedder import try_upsert_event_embedding
from services.ai.briefing import compute_briefing
from services.ai.parse_datetime import parse_nl_datetime
from services.ai.reminders import infer_reminder as _infer_reminder  # alias avoids shadowing the route handler `infer_reminder(req)` below
from services.ai.wellness import compute_llm_wellness_warnings
from services.ai.syllabus import extract_syllabus_events
from services.ai.intent import extract_intent, execute_intent
from services.ai.conflict_resolver import resolve_conflict_suggestions
from services.ai.weekly_review import compute_weekly_metrics as _compute_weekly_metrics, generate_weekly_narrative
from services.ai.inbox_propose import propose_inbox_slot
# Cloud-sync (v2.2) — call-sites use the `_sync_*` / `_kb` aliases throughout;
# `_json_sync` / `_uuid_sync` are aliased duplicates of `json` / `uuid` retained
# to keep the cloud-sync section's "this is sync namespace" markers at call sites.
import json as _json_sync
import uuid as _uuid_sync
from services.sync import dedup as _sync_dedup  # noqa: F401  (imported for tests / future use)
from services.sync import google as _sync_google
from services.sync import caldav as _sync_caldav
from services.sync import ics_normalize as _sync_ics
from services.sync import runner as _sync_runner
from services.sync import keychain_bridge as _kb

# 1B routers — each module owns its own APIRouter; included after CORS below.
from routers import system
from routers import calendars
from routers import pomodoro
from routers import task_templates
from routers import habits
from routers import search
from routers import subscriptions
from routers import templates

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

# ==========================================
# EVENT ROUTES
# ==========================================

class ConflictCheckRequest(BaseModel):
    start_time: str
    end_time: str
    calendar_id: int
    exclude_event_id: int | None = None

@app.post("/events/check-conflicts")
def check_conflicts(payload: ConflictCheckRequest, db: Session = Depends(get_db)):
    conflicts = get_conflicts(
        payload.start_time, payload.end_time,
        payload.calendar_id, payload.exclude_event_id, db,
    )
    return {"conflicts": [{"id": c.id, "title": c.title, "conflict_type": ct} for c, ct in conflicts]}

@app.post("/events/")
def create_event(event: models.EventBase, db: Session = Depends(get_db)):
    validate_calendar_exists(event.calendar_id, db)
    validate_event_times(event.start_time, event.end_time)

    if event.reminder_minutes is None:
        try:
            inferred = _infer_reminder(event.title, event.description)
            event.reminder_minutes = inferred["minutes"]
            event.reminder_source = "inferred"
        except Exception as e:
            logger.warning(f"Reminder inference failed, skipping: {e}")
            event.reminder_source = "none"
    else:
        event.reminder_source = "user"

    # Phase 10: guard circular dependency
    if event.depends_on_event_id is not None:
        dep_ev = db.query(models.Event).filter(models.Event.id == event.depends_on_event_id).first()
        if dep_ev and dep_ev.is_recurring:
            raise HTTPException(status_code=400, detail={"error": {"code": "recurring_parent", "detail": "Recurring events cannot be dependency parents."}})

    db_event = models.Event.model_validate(event)
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    try_upsert_event_embedding(db_event.id, db_event.title, db_event.description, db)
    conflicts = get_conflicts(db_event.start_time, db_event.end_time, db_event.calendar_id, db_event.id, db)
    return {
        "event": db_event,
        "conflicts": [{"id": c.id, "title": c.title, "conflict_type": ct} for c, ct in conflicts],
    }

@app.get("/events/", response_model=list[models.EventRead])
def read_events(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(models.Event).offset(skip).limit(limit).all()

@app.put("/events/{event_id}")
def update_event(event_id: int, event: models.EventBase, db: Session = Depends(get_db)):
    db_event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not db_event:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "not_found", "detail": "Event not found"}}
        )

    validate_event_times(event.start_time, event.end_time)

    if event.reminder_minutes is None and event.reminder_source != "user":
        try:
            inferred = _infer_reminder(event.title, event.description)
            event.reminder_minutes = inferred["minutes"]
            event.reminder_source = "inferred"
        except Exception as e:
            logger.warning(f"Reminder inference failed on update, skipping: {e}")
            event.reminder_source = "none"
    elif event.reminder_minutes is not None and event.reminder_source not in ("user", "inferred"):
        event.reminder_source = "user"

    for key, value in event.model_dump().items():
        setattr(db_event, key, value)

    # Phase 10: guard circular dependency and recurring parent
    new_dep_id = event.depends_on_event_id
    if new_dep_id is not None:
        dep_ev = db.query(models.Event).filter(models.Event.id == new_dep_id).first()
        if dep_ev and dep_ev.is_recurring:
            raise HTTPException(status_code=400, detail={"error": {"code": "recurring_parent", "detail": "Recurring events cannot be dependency parents."}})
        if _detect_circular(event_id, new_dep_id, db):
            raise HTTPException(status_code=400, detail={"error": {"code": "circular_dependency", "detail": "This would create a circular dependency."}})

    db.commit()
    db.refresh(db_event)
    try_upsert_event_embedding(db_event.id, db_event.title, db_event.description, db)
    conflicts = get_conflicts(db_event.start_time, db_event.end_time, db_event.calendar_id, db_event.id, db)

    # Return any dependents so frontend can offer cascade
    dependents = db.query(models.Event).filter(
        models.Event.depends_on_event_id == event_id
    ).all()

    return {
        "event": db_event,
        "conflicts": [{"id": c.id, "title": c.title, "conflict_type": ct} for c, ct in conflicts],
        "dependents": [{"id": d.id, "title": d.title, "start_time": d.start_time, "end_time": d.end_time} for d in dependents],
    }

@app.delete("/events/{event_id}")
def delete_event(event_id: int, db: Session = Depends(get_db)):
    db_event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not db_event:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "not_found", "detail": "Event not found"}}
        )

    event_id_to_delete = db_event.id
    # Phase 10: nullify depends_on for children — never cascade-delete
    db.query(models.Event).filter(
        models.Event.depends_on_event_id == event_id_to_delete
    ).update({"depends_on_event_id": None}, synchronize_session=False)
    db.delete(db_event)
    db.commit()
    try:
        from services.ai.embedder import delete_event_embedding
        delete_event_embedding(event_id_to_delete, db)
    except Exception:
        pass
    return {"status": "success", "message": "Event deleted"}

# H4: Pydantic model for skip-date request body
class SkipDateRequest(BaseModel):
    date: str

@app.post("/events/{event_id}/skip-date")
def skip_event_date(event_id: int, body: SkipDateRequest, db: Session = Depends(get_db)):
    """Append a YYYY-MM-DD date to skipped_dates for a recurring event."""
    db_event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not db_event:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "not_found", "detail": "Event not found"}}
        )
    existing = db_event.skipped_dates or ""
    dates = [d for d in existing.split(",") if d]
    if body.date not in dates:
        dates.append(body.date)
    db_event.skipped_dates = ",".join(dates)
    db.commit()
    db.refresh(db_event)
    return {"status": "success", "skipped_dates": db_event.skipped_dates}

@app.delete("/events/{event_id}/skip-date")
def unskip_event_date(event_id: int, body: SkipDateRequest, db: Session = Depends(get_db)):
    """Remove a previously skipped date from a recurring event."""
    db_event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not db_event:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "not_found", "detail": "Event not found"}}
        )
    existing = db_event.skipped_dates or ""
    dates = [d for d in existing.split(",") if d and d != body.date]
    db_event.skipped_dates = ",".join(dates) if dates else None
    db.commit()
    db.refresh(db_event)
    return {"status": "success", "skipped_dates": db_event.skipped_dates}

# ------------------------------------------
# MISSED EVENTS
# ------------------------------------------
# Users explicitly opt-in mark a past event as missed via the EventEditorModal
# footer; the mark is the nullable Event.missed_at ISO timestamp. Marking is
# done via the normal full-payload PUT /events/{id} — no dedicated PATCH route,
# because the editor already round-trips every field on save and the
# auto-clear-on-save rule (a regular Save clears missed_at) means missed_at
# was already on the wire either way.

class MissedEventsResponse(BaseModel):
    items: list[models.EventRead]
    truncated: bool

@app.get("/events/missed", response_model=MissedEventsResponse)
def list_missed_events(db: Session = Depends(get_db)):
    """Return events the user has marked as missed.

    Filter:
      - missed_at IS NOT NULL          opt-in marker present
      - deleted_at IS NULL             not tombstoned
      - connection_calendar_id IS NULL local-only (synced rescheduling would
                                       push a unilateral move to the provider —
                                       out of scope for v1)
      - NOT is_recurring               editor cannot move a single occurrence
                                       (the only instanceDate-aware path is
                                       Skip this date) — recurring is a separate
                                       follow-up feature
      - NOT is_all_day                 no clock-in semantics; find-free returns
                                       hour-precision slots

    Legacy rows pre-dating those boolean columns store NULL. SQL three-valued
    logic makes `NULL != True` evaluate to NULL (so such rows would be silently
    excluded by `!= True`). We OR with `IS NULL` to include them explicitly.

    Sorted by start_time ascending. Capped at 20; `truncated` flag tells the
    frontend to render an "and N more" footnote.
    """
    from sqlalchemy import or_
    rows = (
        db.query(models.Event)
        .filter(models.Event.missed_at.isnot(None))
        .filter(models.Event.deleted_at.is_(None))
        .filter(models.Event.connection_calendar_id.is_(None))
        .filter(or_(models.Event.is_recurring == False, models.Event.is_recurring.is_(None)))  # noqa: E712
        .filter(or_(models.Event.is_all_day   == False, models.Event.is_all_day.is_(None)))    # noqa: E712
        .order_by(models.Event.start_time.asc())
        .limit(21)
        .all()
    )
    truncated = len(rows) > 20
    return {"items": rows[:20], "truncated": truncated}

# ==========================================
# INTEGRATION ROUTES
# ==========================================

# REPLACE the existing ApprovedEvent class with:
class ApprovedEvent(BaseModel):
    title: str
    start_time: str
    end_time: str
    is_recurring: Optional[bool] = False
    recurrence_days: Optional[str] = None
    recurrence_end: Optional[str] = None
    description: Optional[str] = None
    unique_description: Optional[str] = None
    timezone: Optional[str] = 'local'

class SaveApprovedEventsRequest(BaseModel):
    calendar_id: int
    events: list[ApprovedEvent]
    course_id: Optional[int] = None  # Phase 8: if set, also create Assignment rows

@app.post("/integrations/import-ics-file/")
async def import_ics_file(
    file: UploadFile = File(...),
    calendar_id: int = Form(...),
    db: Session = Depends(get_db)
):
    validate_calendar_exists(calendar_id, db)

    try:
        content = await file.read()
        raw_events = scraper.parse_ics_bytes(content)
        
        events_added = 0
        events_skipped = 0
        
        for ev_data in raw_events:
            # Duplicate Check
            if ev_data.get("external_uid"):
                existing = db.query(models.Event).filter(
                    models.Event.calendar_id == calendar_id,
                    models.Event.external_uid == ev_data["external_uid"]
                ).first()
                
                if existing:
                    events_skipped += 1
                    continue
                    
            new_event = models.Event(
                title=ev_data["title"],
                start_time=ev_data["start_time"],
                end_time=ev_data["end_time"],
                calendar_id=calendar_id,
                external_uid=ev_data.get("external_uid")
            )
            db.add(new_event)
            events_added += 1
            
        db.commit()
        return {"status": "success", "events_added": events_added, "events_skipped": events_skipped}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/export/timelines/")
def export_timelines(calendar_ids: str, format: str = "json", db: Session = Depends(get_db)):
    if not calendar_ids:
        raise HTTPException(status_code=400, detail={"error": {"code": "export_failed", "detail": "calendar_ids cannot be empty."}})
    try:
        id_list = [int(cid.strip()) for cid in calendar_ids.split(',')]
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": {"code": "export_failed", "detail": "calendar_ids must be a comma-separated list of integers."}})

    calendar_list = db.query(models.Calendar).filter(models.Calendar.id.in_(id_list)).all()
    found_ids = [cal.id for cal in calendar_list]
    skipped_ids = [cid for cid in id_list if cid not in found_ids]

    if format.lower() == "json":
        return JSONResponse(content=build_json_export(calendar_list, skipped_ids))
    elif format.lower() == "ics":
        return Response(
            content=build_ics_export(calendar_list),
            media_type="text/calendar",
            headers={"Content-Disposition": 'attachment; filename="loom-export.ics"'},
        )
    else:
        raise HTTPException(status_code=400, detail={"error": {"code": "export_failed", "detail": "Format must be json or ics."}})

@app.post("/documents/extract-syllabus/")
async def extract_syllabus(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_pdf:
        temp_pdf.write(await file.read())
        temp_file_path = temp_pdf.name

    try:
        reader = PdfReader(temp_file_path)
        extracted_text = ""
        for page in reader.pages:
            text = page.extract_text()
            if text:
                extracted_text += text + "\n"
        
        if len(extracted_text.strip()) < 100:
            raise HTTPException(
                status_code=400,
                detail={"error": {"code": "pdf_unreadable", "detail": "PDF appears to be scanned or image-based. Digital PDFs only."}}
            )
            
        # FUTURE IMPROVEMENT: Implement proper chunking for massive PDFs
        truncated_text = extracted_text[:8000] 
        events = extract_syllabus_events(truncated_text)
        
        return {"status": "success", "events": events}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Syllabus parse failed: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "syllabus_parse_failed", "detail": str(e)}}
        )
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

@app.post("/documents/save-approved-events/")
def save_approved_events(request: SaveApprovedEventsRequest, db: Session = Depends(get_db)):
    validate_calendar_exists(request.calendar_id, db)
        
    try:
        events_added = 0
        events_skipped = 0
        created_ids = []
        
        for ev in request.events:
            # Generate deterministic hash for PDF events using start_time
            uid = generate_event_uid(ev.title, ev.start_time)
            
            # Duplicate Check
            existing = db.query(models.Event).filter(
                models.Event.calendar_id == request.calendar_id,
                models.Event.external_uid == uid
            ).first()
            
            if existing:
                events_skipped += 1
                continue
                
            new_event = models.Event(
                title=ev.title,
                start_time=ev.start_time,
                end_time=ev.end_time,
                calendar_id=request.calendar_id,
                is_recurring=ev.is_recurring,
                recurrence_days=ev.recurrence_days,
                recurrence_end=ev.recurrence_end,
                description=ev.description,
                unique_description=ev.unique_description,
                external_uid=uid,
                timezone=ev.timezone
            )
            db.add(new_event)
            db.flush() # Populate ID
            created_ids.append(new_event.id)
            events_added += 1

            # Phase 8: if a course_id was provided, also create an Assignment row
            if request.course_id:
                assignment = models.Assignment(
                    course_id=request.course_id,
                    title=ev.title,
                    due_date=ev.start_time[:10],  # YYYY-MM-DD
                    event_id=new_event.id,
                )
                db.add(assignment)

        db.commit()
        return {
            "status": "success",
            "events_added": events_added,
            "events_skipped": events_skipped,
            "event_ids": created_ids,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
# ==========================================
# DATABASE ADMIN ROUTES
# ==========================================
# NOTE: This endpoint has no authentication — it is designed for local desktop use only.
# Do not expose this endpoint over a network without adding auth.
@app.get('/admin/backup')
def backup_database():
    db_path = os.environ.get('LOOM_DB_PATH', './loom.sqlite3')
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404,
            detail={'error': {'code': 'db_not_found', 'detail': 'Database file not found.'}})
    with open(db_path, 'rb') as f:
        content = f.read()
    return Response(content=content, media_type='application/octet-stream',
        headers={'Content-Disposition': 'attachment; filename=loom-backup.sqlite3'})

SQLITE_HEADER = b'SQLite format 3\x00'

@app.post('/admin/restore')
async def restore_database(file: UploadFile = File(...)):
    content = await file.read()
    # Validate SQLite magic bytes
    if len(content) < 16 or content[:16] != SQLITE_HEADER:
        raise HTTPException(status_code=400,
            detail={'error': {'code': 'invalid_db_file',
                              'detail': 'File is not a valid SQLite database.'}})
    
    # Write to temp and verify it opens
    with tempfile.NamedTemporaryFile(delete=False, suffix='.sqlite3') as tmp:
        tmp.write(content)
        tmp_path = tmp.name
        
    try:
        from sqlalchemy import create_engine as ce
        test_eng = ce(f'sqlite:///{tmp_path}')
        with test_eng.connect() as conn:
            conn.execute(text('SELECT 1'))
        test_eng.dispose()
    except Exception:
        os.remove(tmp_path)
        raise HTTPException(status_code=400,
            detail={'error': {'code': 'corrupt_db', 'detail': 'Backup file is corrupt.'}})
    
    # Replace live DB
    db_path = os.environ.get('LOOM_DB_PATH', './loom.sqlite3')
    engine.dispose()  # Close all pooled connections before replacing the file
    shutil.move(tmp_path, db_path)
    
    return {'status': 'success', 'message': 'Database restored. Reload your data.'}
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
# SMART SCHEDULING — FREE SLOT FINDER
# ==========================================

class FindFreeRequest(BaseModel):
    window_start: str           # ISO datetime
    window_end: str             # ISO datetime
    duration_minutes: int = 60
    working_hours_start: int = 9
    working_hours_end: int = 18

@app.post("/schedule/find-free")
def find_free_slots(req: FindFreeRequest, db: Session = Depends(get_db)):
    """Return up to 5 free slots of duration_minutes within the search window."""
    try:
        search_start = datetime.fromisoformat(req.window_start)
        search_end   = datetime.fromisoformat(req.window_end)
    except ValueError:
        raise HTTPException(status_code=422,
            detail={"error": {"code": "invalid_window",
                              "detail": "window_start and window_end must be ISO datetimes."}})

    duration     = timedelta(minutes=req.duration_minutes)
    work_start_h = req.working_hours_start
    work_end_h   = req.working_hours_end

    events = db.query(models.Event).all()
    busy = []
    for ev in events:
        try:
            ev_s = datetime.fromisoformat(ev.start_time)
            ev_e = datetime.fromisoformat(ev.end_time)
        except ValueError:
            continue
        if ev_s < search_end and ev_e > search_start:
            travel = timedelta(minutes=ev.travel_time_minutes or 0)
            prep   = timedelta(minutes=ev.prep_minutes or 0) if ev.event_type == "lecture" else timedelta(0)
            busy.append((ev_s - travel - prep, ev_e))
    busy.sort()

    free_slots = []
    cursor = search_start.replace(hour=work_start_h, minute=0, second=0, microsecond=0)
    if cursor < search_start:
        cursor = search_start

    # Snap cursor to next 15-minute boundary (:00, :15, :30, :45)
    remainder = cursor.minute % 15
    if remainder != 0:
        cursor += timedelta(minutes=(15 - remainder))
    cursor = cursor.replace(second=0, microsecond=0)

    while cursor + duration <= search_end and len(free_slots) < 5:
        slot_end = cursor + duration
        if cursor.hour < work_start_h or slot_end.hour > work_end_h:
            cursor += timedelta(minutes=15)
            continue
        overlaps = any(b_s < slot_end and b_e > cursor for b_s, b_e in busy)
        if not overlaps:
            free_slots.append({"start": cursor.isoformat(), "end": slot_end.isoformat()})
            cursor = slot_end
        else:
            cursor += timedelta(minutes=15)

    return {"slots": free_slots, "duration_minutes": req.duration_minutes}


# ── Phase 7: Time-Blocking Autopilot ─────────────────────────────────────────

class AutopilotRequest(BaseModel):
    window_start: str
    window_end: str
    working_hours_start: int = 9
    working_hours_end: int = 18

class AutopilotProposal(BaseModel):
    task_id: int
    task_title: str
    start: str
    end: str
    rationale: str

class AutopilotOverflow(BaseModel):
    task_id: int
    task_title: str
    reason: str

class AutopilotResponse(BaseModel):
    proposals: list[AutopilotProposal]
    overflow: list[AutopilotOverflow]

@app.post("/schedule/autopilot", response_model=AutopilotResponse)
def run_autopilot(req: AutopilotRequest, db: Session = Depends(get_db)):
    try:
        window_start = datetime.fromisoformat(req.window_start)
        window_end   = datetime.fromisoformat(req.window_end)
    except ValueError:
        raise HTTPException(status_code=422, detail={"error": {"code": "invalid_window"}})

    proposals_raw, overflow_raw = compute_autopilot_proposals(
        db, window_start, window_end,
        req.working_hours_start, req.working_hours_end,
    )
    return AutopilotResponse(
        proposals=[AutopilotProposal(**p) for p in proposals_raw],
        overflow=[AutopilotOverflow(**o) for o in overflow_raw],
    )

# ─────────────────────────────────────────────────────────────────────────────


# ── Phase 3: Smart Conflict Resolution ───────────────────────────────────────

class ConflictResolutionRequest(BaseModel):
    event: dict              # {title, start_time, end_time, calendar_id}
    conflicts: list[dict]    # [{id, title}, ...]
    working_hours_start: int = 9
    working_hours_end: int = 18

class Suggestion(BaseModel):
    start: str
    end: str
    rationale: str

class ConflictResolutionResponse(BaseModel):
    suggestions: list[Suggestion]

@app.post("/schedule/resolve-conflict", response_model=ConflictResolutionResponse)
def resolve_conflict(req: ConflictResolutionRequest, db: Session = Depends(get_db)):
    try:
        event_start = datetime.fromisoformat(req.event.get("start_time", ""))
        event_end   = datetime.fromisoformat(req.event.get("end_time", ""))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail={"error": {"code": "invalid_event_time"}})

    duration_minutes = int((event_end - event_start).total_seconds() / 60)
    window_start     = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    window_end       = window_start + timedelta(days=14)

    candidates = _find_free_slots_internal(
        db, window_start, window_end, duration_minutes,
        req.working_hours_start, req.working_hours_end,
    )

    raw = resolve_conflict_suggestions(
        req.event.get("title", "this event"),
        [c.get("title", "?") for c in req.conflicts],
        candidates,
    )
    return ConflictResolutionResponse(suggestions=[Suggestion(**s) for s in raw])

# ─────────────────────────────────────────────────────────────────────────────


# ==========================================
# SCHEDULE WELLNESS ANALYSIS (M2)
# ==========================================

class ScheduleEvent(BaseModel):
    id: Optional[int] = None
    title: str
    start_time: str
    end_time: str

class ScheduleAnalyzeRequest(BaseModel):
    events: list[ScheduleEvent]

WellnessWarningKind = Literal['exam_cluster', 'over_scheduled', 'other']

class WellnessWarning(BaseModel):
    # context shape by kind:
    #   exam_cluster:  {event_ids: list[int], titles: list[str],
    #                   window_start: str (YYYY-MM-DD), window_end: str (YYYY-MM-DD)}
    #   over_scheduled: (reserved, not yet emitted)
    #   other:          None
    message: str
    kind: WellnessWarningKind
    context: Optional[dict] = None

class WellnessAnalysisResponse(BaseModel):
    warnings: list[WellnessWarning]


def _exam_cluster_warnings(events: list[ScheduleEvent]) -> list[WellnessWarning]:
    """Deterministic rule. Pure, fast, LLM-independent."""
    detections = _detect_exam_clusters(events)
    warnings: list[WellnessWarning] = []
    for d in detections:
        n = len(d.titles)
        warnings.append(WellnessWarning(
            message=f"{n} exams within {(datetime.fromisoformat(d.window_end) - datetime.fromisoformat(d.window_start)).days + 1} days — consider rebalancing study time.",
            kind='exam_cluster',
            context={
                "event_ids": d.event_ids,
                "titles": d.titles,
                "window_start": d.window_start,
                "window_end": d.window_end,
            },
        ))
    return warnings


@app.post("/schedule/analyze", response_model=WellnessAnalysisResponse)
def analyze_schedule(request: ScheduleAnalyzeRequest):
    # Deterministic rules first — they don't depend on the LLM call and never fail.
    warnings = _exam_cluster_warnings(request.events)
    warnings.extend(WellnessWarning(**w) for w in compute_llm_wellness_warnings(request.events))
    return WellnessAnalysisResponse(warnings=warnings)


@app.post("/schedule/detect-clusters", response_model=WellnessAnalysisResponse)
def detect_clusters_only(request: ScheduleAnalyzeRequest):
    """Mutation-triggered deterministic detection. No LLM, fast, idempotent."""
    return WellnessAnalysisResponse(warnings=_exam_cluster_warnings(request.events))

# ==========================================
# PROCRASTINATION RADAR
# ==========================================

class ProcrastinationWarning(BaseModel):
    assignment_id: int
    title: str
    course_name: str
    due_date: str
    days_until: int
    message: str

class ProcrastinationRadarResponse(BaseModel):
    warnings: list[ProcrastinationWarning]

@app.get("/schedule/procrastination-radar", response_model=ProcrastinationRadarResponse)
def procrastination_radar(db: Session = Depends(get_db)):
    warnings_raw = compute_procrastination_warnings(db, datetime.now())
    return ProcrastinationRadarResponse(
        warnings=[ProcrastinationWarning(**w) for w in warnings_raw],
    )

# ==========================================
# TASK ROUTES (replaces M1 Todo)
# ==========================================

class TaskCreate(BaseModel):
    event_id: int
    note: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    is_complete: bool = False
    estimated_minutes: Optional[int] = None
    deadline: Optional[str] = None

class TaskUpdate(BaseModel):
    is_complete: bool
    note: Optional[str] = None
    status: Optional[str] = None    # backlog | doing | done
    priority: Optional[str] = None  # high | med | low
    due_date: Optional[str] = None  # ISO date string
    estimated_minutes: Optional[int] = None
    deadline: Optional[str] = None

@app.post("/tasks/", response_model=models.TaskRead)
def create_task(task: TaskCreate, db: Session = Depends(get_db)):
    # Idempotent — return existing task if this event is already pinned
    existing = db.query(models.Task).filter(models.Task.event_id == task.event_id).first()
    if existing:
        return existing
    try:
        db_task = models.Task(
            event_id=task.event_id,
            note=task.note,
            is_complete=task.is_complete,
            status=task.status or "backlog",
            priority=task.priority or "low",
            estimated_minutes=task.estimated_minutes,
            deadline=task.deadline,
            added_at=datetime.now().isoformat(),
        )
        db.add(db_task)
        db.commit()
        db.refresh(db_task)
        return db_task
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400,
            detail={"error": {"code": "task_create_failed", "detail": str(e)}})

@app.get("/tasks/", response_model=list[models.TaskRead])
def list_tasks(db: Session = Depends(get_db)):
    return db.query(models.Task).all()

@app.put("/tasks/{task_id}", response_model=models.TaskRead)
def update_task(task_id: int, task: TaskUpdate, db: Session = Depends(get_db)):
    db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "task_not_found", "detail": f"Task {task_id} does not exist."}})
    db_task.is_complete = task.is_complete
    db_task.note = task.note
    if task.status             is not None: db_task.status             = task.status
    if task.priority           is not None: db_task.priority           = task.priority
    if task.due_date           is not None: db_task.due_date           = task.due_date
    if task.estimated_minutes  is not None: db_task.estimated_minutes  = task.estimated_minutes
    if task.deadline           is not None: db_task.deadline           = task.deadline
    db.commit()
    db.refresh(db_task)
    return db_task

@app.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "task_not_found", "detail": f"Task {task_id} does not exist."}})
    db.delete(db_task)
    db.commit()
    return {"status": "success"}

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

# ── Phase 12: Voice Journal ───────────────────────────────────────────────────

_JOURNAL_AUDIO_DIR = Path(__file__).parent / "journal_audio"

class JournalCreateRequest(BaseModel):
    date: Optional[str] = None     # defaults to today
    mood: Optional[str] = None     # "great" | "ok" | "rough"
    save_audio: bool = False

@app.post("/journal", response_model=models.JournalEntryRead)
async def create_journal_entry(
    audio: Optional[UploadFile] = File(None),
    date: Optional[str] = Form(None),
    mood: Optional[str] = Form(None),
    save_audio: bool = Form(False),
    db: Session = Depends(get_db),
):
    entry_date = date or datetime.now().strftime("%Y-%m-%d")
    transcript = ""
    audio_path = None

    if audio:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
            tmp.write(await audio.read())
            tmp_path = tmp.name
        try:
            segments, _ = whisper.get_model().transcribe(tmp_path, beam_size=5)
            transcript = " ".join(seg.text for seg in segments).strip()
            if save_audio:
                _JOURNAL_AUDIO_DIR.mkdir(exist_ok=True)
                audio_dest = _JOURNAL_AUDIO_DIR / f"journal_{entry_date}_{int(datetime.now().timestamp())}.webm"
                import shutil as _shutil
                _shutil.copy(tmp_path, audio_dest)
                audio_path = str(audio_dest)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    entry = models.JournalEntry(
        date=entry_date,
        transcript=transcript,
        audio_path=audio_path,
        mood=mood,
        created_at=datetime.now().isoformat(),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry

class JournalTextCreate(BaseModel):
    text: str
    event_id: Optional[int] = None
    date: Optional[str] = None     # defaults to today
    mood: Optional[str] = None

_JOURNAL_TEXT_MAX = 600

@app.post("/journal/text", response_model=models.JournalEntryRead)
def create_journal_text(payload: JournalTextCreate, db: Session = Depends(get_db)):
    text_value = (payload.text or "").strip()
    if not text_value:
        raise HTTPException(status_code=400, detail={"error": {"code": "empty_text"}})
    if len(text_value) > _JOURNAL_TEXT_MAX:
        text_value = text_value[:_JOURNAL_TEXT_MAX]
    entry_date = payload.date or datetime.now().strftime("%Y-%m-%d")
    entry = models.JournalEntry(
        date=entry_date,
        transcript=text_value,
        audio_path=None,
        mood=payload.mood,
        created_at=datetime.now().isoformat(),
        event_id=payload.event_id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry

@app.get("/journal", response_model=list[models.JournalEntryRead])
def list_journal(
    from_date: Optional[str] = None,
    to_date:   Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.JournalEntry)
    if from_date:
        q = q.filter(models.JournalEntry.date >= from_date)
    if to_date:
        q = q.filter(models.JournalEntry.date <= to_date)
    return q.order_by(models.JournalEntry.date.desc()).all()

@app.delete("/journal/{entry_id}")
def delete_journal_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(models.JournalEntry).filter(models.JournalEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    db.delete(entry)
    db.commit()
    return {"status": "deleted"}

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
# DURATION ANALYTICS ROUTES
# ==========================================

class ClockPayload(BaseModel):
    action: str  # "in" | "out"

@app.patch("/events/{event_id}/clock")
def clock_event(event_id: int, payload: ClockPayload, db: Session = Depends(get_db)):
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "event_not_found", "detail": f"Event {event_id} does not exist."}})
    if payload.action == "in":
        event.actual_start = datetime.now().isoformat()
    elif payload.action == "out":
        event.actual_end = datetime.now().isoformat()
    else:
        raise HTTPException(status_code=400,
            detail={"error": {"code": "invalid_action", "detail": "action must be 'in' or 'out'"}})
    db.add(event)
    db.commit()
    db.refresh(event)
    return event

@app.get("/stats/duration")
def duration_stats(db: Session = Depends(get_db)):
    return {"entries": compute_duration_stats(db)}

# ==========================================
# STUDY BLOCK AUTO-GENERATOR ROUTES
# ==========================================

class StudyBlockRequest(BaseModel):
    subject: str
    deadline_date: str           # ISO date YYYY-MM-DD
    calendar_id: int
    num_sessions: int = 5
    session_duration_minutes: int = 90
    preferred_hour: int = 18
    skip_weekends: bool = True
    assignment_id: Optional[int] = None  # Procrastination Radar — links blocks back to Assignment

class StudyBlockPreview(BaseModel):
    title: str
    start_time: str
    end_time: str
    description: str
    calendar_id: int
    assignment_id: Optional[int] = None

@app.post("/study/generate-preview", response_model=list[StudyBlockPreview])
def generate_study_preview(req: StudyBlockRequest):
    deadline = datetime.strptime(req.deadline_date, "%Y-%m-%d")
    now      = datetime.now()
    days_avail = (deadline - now).days

    if days_avail <= 0:
        raise HTTPException(status_code=400,
            detail={"error": {"code": "past_deadline", "detail": "Deadline has already passed."}})

    interval = max(1, days_avail // max(req.num_sessions, 1))
    cursor   = now.replace(hour=req.preferred_hour, minute=0, second=0, microsecond=0)
    if cursor <= now:
        cursor += timedelta(days=1)

    blocks = []
    for i in range(req.num_sessions):
        if cursor >= deadline:
            break
        if req.skip_weekends and cursor.weekday() >= 5:
            cursor += timedelta(days=7 - cursor.weekday())
        if cursor >= deadline:
            break
        label = "Final Review" if i == req.num_sessions - 1 else f"Study Session {i + 1}"
        end_cursor = cursor + timedelta(minutes=req.session_duration_minutes)
        blocks.append(StudyBlockPreview(
            title=f"{req.subject} — {label}",
            start_time=cursor.isoformat(),
            end_time=end_cursor.isoformat(),
            description=f"Auto-generated study block. Deadline: {req.deadline_date}",
            calendar_id=req.calendar_id,
            assignment_id=req.assignment_id,
        ))
        cursor += timedelta(days=interval)

    return blocks

@app.post("/study/confirm-blocks")
def confirm_study_blocks(blocks: list[StudyBlockPreview], db: Session = Depends(get_db)):
    created = []
    for b in blocks:
        event = models.Event(**b.model_dump())
        db.add(event)
        db.commit()
        db.refresh(event)
        created.append(event)
    return {"created_count": len(created), "events": created}

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


# ============================================================
# AVAILABILITY REQUEST ROUTES
# ============================================================

class CreateAvailabilityRequest(BaseModel):
    sender_name: str
    duration_minutes: int = 60
    slots: list  # [{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM"}]

class ContactInfo(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    company: Optional[str] = None

class ConfirmAvailabilityRequest(BaseModel):
    slot: dict
    receiver_name: Optional[str] = None
    contact: Optional[ContactInfo] = None

class AmendAvailabilityRequest(BaseModel):
    slot: dict
    receiver_name: str
    note: Optional[str] = None

class RespondAmendmentRequest(BaseModel):
    action: str  # "accept" | "decline" | "counter"
    counter_slot: Optional[dict] = None


def _check_availability_expiry(req: models.AvailabilityRequest):
    if datetime.utcnow() > datetime.fromisoformat(req.expires_at):
        raise HTTPException(
            status_code=410,
            detail={"error": {"code": "link_expired", "detail": "This availability link has expired."}}
        )


def _create_meeting_event(db: Session, slot: dict, contact: dict | None = None) -> Optional[int]:
    calendar = db.query(models.Calendar).first()
    if not calendar:
        return None
    date_str = slot["date"]
    description = None
    if contact:
        lines = []
        if contact.get("name"):    lines.append(f"Name: {contact['name']}")
        if contact.get("email"):   lines.append(f"Email: {contact['email']}")
        if contact.get("phone"):   lines.append(f"Phone: {contact['phone']}")
        if contact.get("company"): lines.append(f"Company: {contact['company']}")
        description = "\n".join(lines) if lines else None
    event_data = models.EventBase(
        title="Meeting (availability booking)",
        description=description,
        start_time=f"{date_str}T{slot['start']}:00",
        end_time=f"{date_str}T{slot['end']}:00",
        calendar_id=calendar.id,
        reminder_minutes=15,
    )
    db_event = models.Event.model_validate(event_data)
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event.id


@app.post("/availability")
def create_availability(body: CreateAvailabilityRequest, db: Session = Depends(get_db)):
    token = str(uuid.uuid4())
    now = datetime.utcnow()
    req = models.AvailabilityRequest(
        token=token,
        sender_name=body.sender_name,
        duration_minutes=body.duration_minutes,
        slots=json.dumps(body.slots),
        status="pending",
        created_at=now.isoformat(),
        expires_at=(now + timedelta(days=7)).isoformat(),
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    share_url = f"http://localhost:8000/availability/{token}/view"
    return {"id": req.id, "token": token, "share_url": share_url, "view_url": share_url}


@app.get("/availability/{token}", response_model=models.AvailabilityRequestRead)
def get_availability(token: str, db: Session = Depends(get_db)):
    req = db.query(models.AvailabilityRequest).filter(
        models.AvailabilityRequest.token == token
    ).first()
    if not req:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "not_found", "detail": "Availability request not found."}})
    _check_availability_expiry(req)
    return req


@app.post("/availability/{token}/confirm")
def confirm_availability(token: str, body: ConfirmAvailabilityRequest, db: Session = Depends(get_db)):
    req = db.query(models.AvailabilityRequest).filter(
        models.AvailabilityRequest.token == token
    ).first()
    if not req:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "not_found", "detail": "Availability request not found."}})
    _check_availability_expiry(req)
    if req.status == "confirmed":
        raise HTTPException(status_code=409,
            detail={"error": {"code": "already_resolved", "detail": "This time has already been booked."}})
    req.status = "confirmed"
    req.confirmed_slot = json.dumps(body.slot)
    if body.contact and body.contact.name:
        req.receiver_name = body.contact.name
    elif body.receiver_name:
        req.receiver_name = body.receiver_name
    db.commit()
    db.refresh(req)
    contact_dict = body.contact.model_dump() if body.contact else None
    event_id = _create_meeting_event(db, body.slot, contact_dict)
    return {"status": req.status, "confirmed_slot": json.loads(req.confirmed_slot), "event_id": event_id}


@app.post("/availability/{token}/amend")
def amend_availability(token: str, body: AmendAvailabilityRequest, db: Session = Depends(get_db)):
    req = db.query(models.AvailabilityRequest).filter(
        models.AvailabilityRequest.token == token
    ).first()
    if not req:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "not_found", "detail": "Availability request not found."}})
    _check_availability_expiry(req)
    if req.status not in ("pending",):
        raise HTTPException(status_code=409,
            detail={"error": {"code": "already_resolved", "detail": "Request cannot be amended in its current state."}})
    req.status = "amended"
    req.amendment_slot = json.dumps(body.slot)
    req.receiver_name = body.receiver_name
    db.commit()
    db.refresh(req)
    return {"status": req.status, "amendment_slot": json.loads(req.amendment_slot)}


@app.post("/availability/{token}/respond-amendment")
def respond_amendment(token: str, body: RespondAmendmentRequest, db: Session = Depends(get_db)):
    req = db.query(models.AvailabilityRequest).filter(
        models.AvailabilityRequest.token == token
    ).first()
    if not req:
        raise HTTPException(status_code=404,
            detail={"error": {"code": "not_found", "detail": "Availability request not found."}})
    _check_availability_expiry(req)

    if body.action == "accept":
        slot = json.loads(req.amendment_slot)
        req.status = "confirmed"
        req.confirmed_slot = req.amendment_slot
        db.commit()
        db.refresh(req)
        event_id = _create_meeting_event(db, slot)
        return {"status": "confirmed", "event_id": event_id}

    elif body.action == "decline":
        req.status = "declined"
        db.commit()
        return {"status": "declined"}

    elif body.action == "counter":
        if not body.counter_slot:
            raise HTTPException(status_code=422,
                detail={"error": {"code": "missing_counter_slot", "detail": "counter_slot is required for counter action."}})
        req.status = "pending"
        req.amendment_slot = json.dumps(body.counter_slot)
        db.commit()
        return {"status": "pending", "amendment_slot": body.counter_slot}

    raise HTTPException(status_code=422,
        detail={"error": {"code": "invalid_action", "detail": "action must be accept, decline, or counter."}})


_404_HTML = (
    "<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Not Found</title>"
    "<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;"
    "display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}"
    ".box{text-align:center;padding:48px 24px}"
    "h2{font-size:1.4rem;font-weight:700;margin-bottom:8px}"
    "p{color:#64748b;font-size:0.95rem}</style></head>"
    "<body><div class='box'><h2>Link not found</h2>"
    "<p>This availability link does not exist.</p></div></body></html>"
)


@app.get("/availability/{token}/view", response_class=HTMLResponse)
def view_availability(token: str, db: Session = Depends(get_db)):
    req = db.query(models.AvailabilityRequest).filter(
        models.AvailabilityRequest.token == token
    ).first()
    if not req:
        return HTMLResponse(content=_404_HTML, status_code=404)
    html_path = Path(__file__).parent / "availability_receiver.html"
    html = html_path.read_text(encoding="utf-8").replace("{{ token }}", token)
    return HTMLResponse(content=html)


# ── Phase 10: Cross-Event Dependencies ───────────────────────────────────────

class CascadeDependentsResponse(BaseModel):
    updated: list[dict]

@app.post("/events/{event_id}/cascade-dependents", response_model=CascadeDependentsResponse)
def cascade_dependents(event_id: int, db: Session = Depends(get_db)):
    """Apply depends_offset_minutes to all direct dependents of this event."""
    parent = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    children = db.query(models.Event).filter(
        models.Event.depends_on_event_id == event_id
    ).all()

    updated = []
    for child in children:
        if child.depends_offset_minutes is None:
            continue
        try:
            parent_end = datetime.fromisoformat(parent.end_time)
        except ValueError:
            continue
        offset  = timedelta(minutes=child.depends_offset_minutes)
        dur_td  = timedelta(seconds=max(0, (
            datetime.fromisoformat(child.end_time) - datetime.fromisoformat(child.start_time)
        ).total_seconds()))
        new_start = parent_end + offset
        new_end   = new_start + dur_td
        child.start_time = new_start.isoformat()
        child.end_time   = new_end.isoformat()
        updated.append(child.model_dump())

    db.commit()
    return CascadeDependentsResponse(updated=updated)

# ─────────────────────────────────────────────────────────────────────────────


# ── Phase 8: Course Concept ──────────────────────────────────────────────────

class CourseCreate(BaseModel):
    name: str
    code: Optional[str] = None
    instructor: Optional[str] = None
    syllabus_path: Optional[str] = None
    timeline_id: Optional[int] = None
    grade_weights: str = "[]"
    color: str = "#6366f1"

class AssignmentCreate(BaseModel):
    course_id: int
    title: str
    due_date: str
    weight_category: Optional[str] = None
    score: Optional[float] = None
    max_score: Optional[float] = None
    event_id: Optional[int] = None

class AssignmentUpdate(BaseModel):
    title: Optional[str] = None
    due_date: Optional[str] = None
    weight_category: Optional[str] = None
    score: Optional[float] = None
    max_score: Optional[float] = None
    event_id: Optional[int] = None

# -- Courses CRUD --

@app.get("/courses", response_model=list[models.CourseRead])
def list_courses(db: Session = Depends(get_db)):
    return db.query(models.Course).all()

@app.post("/courses", response_model=models.CourseRead)
def create_course(body: CourseCreate, db: Session = Depends(get_db)):
    course = models.Course(**body.model_dump())
    db.add(course)
    db.commit()
    db.refresh(course)
    return course

@app.put("/courses/{course_id}", response_model=models.CourseRead)
def update_course(course_id: int, body: CourseCreate, db: Session = Depends(get_db)):
    course = db.query(models.Course).filter(models.Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    for k, v in body.model_dump().items():
        setattr(course, k, v)
    db.commit()
    db.refresh(course)
    return course

@app.delete("/courses/{course_id}")
def delete_course(course_id: int, db: Session = Depends(get_db)):
    course = db.query(models.Course).filter(models.Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    db.delete(course)
    db.commit()
    return {"status": "deleted"}

# -- Assignments CRUD --

@app.get("/assignments", response_model=list[models.AssignmentRead])
def list_assignments(
    course_id: Optional[int] = None,
    event_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.Assignment)
    if course_id:
        q = q.filter(models.Assignment.course_id == course_id)
    if event_id is not None:
        q = q.filter(models.Assignment.event_id == event_id)
    return q.order_by(models.Assignment.due_date).all()

@app.post("/assignments", response_model=models.AssignmentRead)
def create_assignment(body: AssignmentCreate, db: Session = Depends(get_db)):
    a = models.Assignment(**body.model_dump())
    db.add(a)
    db.commit()
    db.refresh(a)
    return a

@app.put("/assignments/{assignment_id}", response_model=models.AssignmentRead)
def update_assignment(assignment_id: int, body: AssignmentUpdate, db: Session = Depends(get_db)):
    a = db.query(models.Assignment).filter(models.Assignment.id == assignment_id).first()
    if not a:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(a, k, v)
    db.commit()
    db.refresh(a)
    return a

@app.delete("/assignments/{assignment_id}")
def delete_assignment(assignment_id: int, db: Session = Depends(get_db)):
    a = db.query(models.Assignment).filter(models.Assignment.id == assignment_id).first()
    if not a:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    db.delete(a)
    db.commit()
    return {"status": "deleted"}

# -- Grade calculation --

@app.get("/courses/{course_id}/grade")
def get_course_grade(course_id: int, db: Session = Depends(get_db)):
    course = db.query(models.Course).filter(models.Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    try:
        weights: list[dict] = json.loads(course.grade_weights or "[]")
    except (json.JSONDecodeError, TypeError):
        weights = []

    assignments = db.query(models.Assignment).filter(
        models.Assignment.course_id == course_id
    ).all()

    # Map category → weight
    weight_map = {w["name"]: float(w["weight"]) for w in weights if "name" in w and "weight" in w}

    # Per-category: weighted average of scored assignments
    category_scores: dict[str, list[float]] = {}
    for a in assignments:
        if a.score is None or a.max_score is None or a.max_score == 0:
            continue
        cat = a.weight_category or "Unweighted"
        pct = (a.score / a.max_score) * 100
        category_scores.setdefault(cat, []).append(pct)

    if not weight_map:
        # No weights — simple average
        all_pcts = [p for ps in category_scores.values() for p in ps]
        grade = round(sum(all_pcts) / len(all_pcts), 2) if all_pcts else None
        return {"grade": grade, "breakdown": {}}

    total_weight = 0.0
    weighted_sum = 0.0
    breakdown:  dict[str, Optional[float]] = {}
    for cat, w in weight_map.items():
        scores = category_scores.get(cat, [])
        avg = round(sum(scores) / len(scores), 2) if scores else None
        breakdown[cat] = avg
        if avg is not None:
            weighted_sum += avg * w
            total_weight += w

    grade = round(weighted_sum / total_weight, 2) if total_weight else None
    return {"grade": grade, "breakdown": breakdown}

# ─────────────────────────────────────────────────────────────────────────────


# ── Phase 4: Quick-Capture Inbox ─────────────────────────────────────────────

class InboxCreateRequest(BaseModel):
    text: str

class InboxProposeResponse(BaseModel):
    proposed_start: Optional[str]
    proposed_duration: Optional[int]
    rationale: str

class InboxScheduleRequest(BaseModel):
    start: str
    end: str
    calendar_id: int

@app.get("/inbox", response_model=list[models.InboxItemRead])
def list_inbox(db: Session = Depends(get_db)):
    return (
        db.query(models.InboxItem)
        .filter(models.InboxItem.archived == False)  # noqa: E712
        .order_by(models.InboxItem.id.desc())
        .all()
    )

@app.post("/inbox", response_model=models.InboxItemRead)
def create_inbox_item(body: InboxCreateRequest, db: Session = Depends(get_db)):
    item = models.InboxItem(
        text=body.text,
        created_at=datetime.now().isoformat(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item

@app.post("/inbox/{item_id}/propose", response_model=InboxProposeResponse)
def propose_inbox_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.InboxItem).filter(models.InboxItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    # Use find-free to get candidate slots
    now = datetime.now()
    window_end = now + timedelta(days=7)
    candidates = _find_free_slots_internal(db, now, window_end, 60, 9, 18)

    proposal = propose_inbox_slot(item.text, candidates)
    item.proposed_start    = proposal["proposed_start"]
    item.proposed_duration = proposal["proposed_duration"]
    db.commit()
    return InboxProposeResponse(**proposal)

@app.post("/inbox/{item_id}/schedule", response_model=models.InboxItemRead)
def schedule_inbox_item(item_id: int, body: InboxScheduleRequest, db: Session = Depends(get_db)):
    item = db.query(models.InboxItem).filter(models.InboxItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    validate_calendar_exists(body.calendar_id, db)
    validate_event_times(body.start, body.end)

    # Infer reminder for the new event
    try:
        inferred = _infer_reminder(item.text, None)
        reminder_minutes = inferred["minutes"]
        reminder_source  = "inferred"
    except Exception:
        reminder_minutes = None
        reminder_source  = "none"

    db_event = models.Event(
        title=item.text,
        start_time=body.start,
        end_time=body.end,
        calendar_id=body.calendar_id,
        reminder_minutes=reminder_minutes,
        reminder_source=reminder_source,
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)

    item.scheduled_event_id = db_event.id
    item.archived = True
    db.commit()
    db.refresh(item)
    return item

@app.delete("/inbox/{item_id}", response_model=models.InboxItemRead)
def delete_inbox_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.InboxItem).filter(models.InboxItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    item.archived = True
    db.commit()
    db.refresh(item)
    return item

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 13 — ENCRYPTED LOCAL BACKUP
# ─────────────────────────────────────────────────────────────────────────────

class BackupExportRequest(BaseModel):
    passphrase: str
    include_audio: bool = False

class BackupImportResponse(BaseModel):
    success: bool
    message: str

@app.post("/backup/export")
def export_backup(req: BackupExportRequest):
    import sqlite3 as _sqlite3
    import tarfile as _tarfile
    import io as _io

    db_path = os.environ.get("LOOM_DB_PATH", "./loom.sqlite3")
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail={"error": {"code": "db_not_found"}})

    # SQLite online backup to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite3") as tmp:
        tmp_path = tmp.name
    try:
        src = _sqlite3.connect(db_path)
        dst = _sqlite3.connect(tmp_path)
        src.backup(dst)
        dst.close()
        src.close()

        # Bundle into tar archive in memory
        tar_buf = _io.BytesIO()
        with _tarfile.open(fileobj=tar_buf, mode="w:gz") as tar:
            tar.add(tmp_path, arcname="loom.sqlite3")
            if req.include_audio:
                audio_dir = Path("./journal_audio")
                if audio_dir.exists():
                    for af in audio_dir.iterdir():
                        tar.add(af, arcname=f"journal_audio/{af.name}")
        archive_bytes = tar_buf.getvalue()

        encrypted = _encrypt_backup(archive_bytes, req.passphrase)
        return Response(
            content=encrypted,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename=loom-backup-{datetime.now().strftime('%Y%m%d%H%M%S')}.loombackup"},
        )
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

class BackupImportRequest(BaseModel):
    passphrase: str

@app.post("/backup/import", response_model=BackupImportResponse)
async def import_backup(passphrase: str = Form(...), file: UploadFile = File(...)):
    import sqlite3 as _sqlite3
    import tarfile as _tarfile
    import io as _io

    content = await file.read()
    try:
        archive_bytes = _decrypt_backup(content, passphrase)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": {"code": "decrypt_failed", "detail": str(e)}})

    tar_buf = _io.BytesIO(archive_bytes)
    try:
        with _tarfile.open(fileobj=tar_buf, mode="r:gz") as tar:
            db_member = tar.getmember("loom.sqlite3")
            db_bytes_io = tar.extractfile(db_member)
            if db_bytes_io is None:
                raise ValueError("No loom.sqlite3 in archive")
            db_bytes = db_bytes_io.read()

            # Validate SQLite header
            if len(db_bytes) < 16 or db_bytes[:16] != b"SQLite format 3\x00":
                raise ValueError("Extracted file is not a valid SQLite database")

            # Write to temp + verify
            with tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite3") as tmp:
                tmp.write(db_bytes)
                tmp_path = tmp.name

            try:
                test_eng = _sqlite3.connect(tmp_path)
                test_eng.execute("SELECT 1")
                test_eng.close()
            except Exception:
                os.remove(tmp_path)
                raise ValueError("Backup database is corrupt")

            # Extract optional audio files
            audio_members = [m for m in tar.getmembers() if m.name.startswith("journal_audio/")]
            audio_dir = Path("./journal_audio")
            audio_dir.mkdir(exist_ok=True)
            for m in audio_members:
                af = tar.extractfile(m)
                if af:
                    dest = audio_dir / Path(m.name).name
                    dest.write_bytes(af.read())
    except (ValueError, KeyError, _tarfile.TarError) as e:
        raise HTTPException(status_code=400, detail={"error": {"code": "invalid_backup", "detail": str(e)}})

    db_path = os.environ.get("LOOM_DB_PATH", "./loom.sqlite3")
    # Pre-restore backup
    pre_bak = db_path + ".pre-restore.bak"
    if os.path.exists(db_path):
        shutil.copy2(db_path, pre_bak)

    engine.dispose()
    try:
        shutil.move(tmp_path, db_path)
    except Exception as exc:
        # Roll back
        if os.path.exists(pre_bak):
            shutil.copy2(pre_bak, db_path)
        raise HTTPException(status_code=500, detail={"error": {"code": "restore_failed", "detail": str(exc)}})

    return BackupImportResponse(success=True, message="Database restored. Reload your data.")

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 14 — LAN-ONLY MULTI-DEVICE SYNC
# ─────────────────────────────────────────────────────────────────────────────

# ── 14a: Pairing ─────────────────────────────────────────────────────────────

@app.post("/pair/start")
def pair_start(db: Session = Depends(get_db)):
    import random as _random
    cert_pem, _ = _generate_self_signed_cert()
    fingerprint  = _cert_fingerprint(cert_pem)
    code = f"{_random.randint(0, 999999):06d}"
    expires = (datetime.utcnow() + timedelta(minutes=5)).isoformat()
    _pairing_codes[code] = {"fingerprint": fingerprint, "expires": expires}
    return {
        "host": "0.0.0.0",
        "port": 8000,
        "cert_fingerprint": fingerprint,
        "code": code,
        "expires": expires,
    }

class PairCompleteRequest(BaseModel):
    code: str
    peer_name: str
    peer_cert_fingerprint: str

@app.post("/pair/complete", response_model=models.PeerRead)
def pair_complete(req: PairCompleteRequest, db: Session = Depends(get_db)):
    entry = _pairing_codes.get(req.code)
    if not entry:
        raise HTTPException(status_code=400, detail={"error": {"code": "invalid_code"}})
    if datetime.utcnow().isoformat() > entry["expires"]:
        del _pairing_codes[req.code]
        raise HTTPException(status_code=400, detail={"error": {"code": "code_expired"}})
    del _pairing_codes[req.code]
    peer = models.Peer(
        name=req.peer_name,
        cert_fingerprint=req.peer_cert_fingerprint,
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(peer)
    db.commit()
    db.refresh(peer)
    return peer

@app.get("/pair/peers", response_model=list[models.PeerRead])
def list_peers(db: Session = Depends(get_db)):
    return db.query(models.Peer).all()

@app.delete("/pair/peers/{peer_id}")
def delete_peer(peer_id: int, db: Session = Depends(get_db)):
    peer = db.query(models.Peer).filter(models.Peer.id == peer_id).first()
    if not peer:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    db.delete(peer)
    db.commit()
    return {"ok": True}

# ── 14b: mDNS Discovery ───────────────────────────────────────────────────────

@app.get("/discovery/peers")
def get_discovery_peers():
    return {"peers": _discovered_peers}

# ── 14c: Sync Engine ──────────────────────────────────────────────────────────

class SyncExchangeRequest(BaseModel):
    since: str   # ISO datetime — return records modified after this

@app.post("/sync/exchange")
def sync_exchange(req: SyncExchangeRequest, db: Session = Depends(get_db)):
    events = (
        db.query(models.Event)
        .filter(models.Event.last_modified != None, models.Event.last_modified > req.since)  # noqa: E711
        .all()
    )
    tasks = (
        db.query(models.Task)
        .filter(models.Task.last_modified != None, models.Task.last_modified > req.since)  # noqa: E711
        .all()
    )
    return {
        "since": req.since,
        "events": [e.__dict__ for e in events],
        "tasks":  [t.__dict__ for t in tasks],
    }

@app.post("/sync/apply")
def sync_apply(payload: dict, db: Session = Depends(get_db)):
    """Accept inbound sync payload from a peer and apply last-write-wins."""
    applied = 0
    for ev_data in payload.get("events", []):
        ev_data.pop("_sa_instance_state", None)
        ev_id = ev_data.get("id")
        existing = db.query(models.Event).filter(models.Event.id == ev_id).first() if ev_id else None
        if existing:
            remote_ts  = ev_data.get("last_modified", "")
            local_ts   = existing.last_modified or ""
            if remote_ts > local_ts:
                for k, v in ev_data.items():
                    if k != "id" and hasattr(existing, k):
                        setattr(existing, k, v)
                db.commit()
                applied += 1
        else:
            new_ev = models.Event(**{k: v for k, v in ev_data.items() if hasattr(models.Event, k)})
            db.add(new_ev)
            db.commit()
            applied += 1
    for t_data in payload.get("tasks", []):
        t_data.pop("_sa_instance_state", None)
        t_id = t_data.get("id")
        existing = db.query(models.Task).filter(models.Task.id == t_id).first() if t_id else None
        if existing:
            remote_ts = t_data.get("last_modified", "")
            local_ts  = existing.last_modified or ""
            if remote_ts > local_ts:
                for k, v in t_data.items():
                    if k != "id" and hasattr(existing, k):
                        setattr(existing, k, v)
                db.commit()
                applied += 1
        else:
            new_t = models.Task(**{k: v for k, v in t_data.items() if hasattr(models.Task, k)})
            db.add(new_t)
            db.commit()
            applied += 1
    return {"applied": applied}

@app.post("/sync/now/{peer_id}")
async def sync_now(peer_id: int, db: Session = Depends(get_db)):
    """Manually trigger a sync with a specific peer."""
    peer = db.query(models.Peer).filter(models.Peer.id == peer_id).first()
    if not peer:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    last_sync = peer.last_seen or "1970-01-01T00:00:00"
    try:
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=10) as cli:
            # 1. Pull from peer
            resp = await cli.post(
                f"http://{peer.cert_fingerprint}:8000/sync/exchange",
                json={"since": last_sync},
            )
            if resp.status_code == 200:
                await cli.post("http://localhost:8000/sync/apply", json=resp.json())

        peer.last_seen = datetime.utcnow().isoformat()
        db.commit()
        return {"ok": True, "peer_id": peer_id}
    except Exception as e:
        raise HTTPException(status_code=503, detail={"error": {"code": "sync_failed", "detail": str(e)}})

# ─────────────────────────────────────────────────────────────────────────────
# Phase v3.0 — Cloud identity (Supabase Auth, identity-only)
#
# Hard rails (per LoomAssist_UIUX_Guardrail.md §6 + design doc §1):
#   - Identity = email + display name + provider IDs. Nothing else.
#   - Calendar/event data NEVER traverses a LoomAssist server.
#   - Tokens live in macOS Keychain (frontend); never SQLite, never Account row.
#   - Local mode is a first-class state — Account row absent ⇒ 204 from /auth/me.
# ─────────────────────────────────────────────────────────────────────────────
import httpx
from services.auth import supabase as supabase_auth


class OAuthStartResponse(BaseModel):
    auth_url: str


class EmailSignupRequest(BaseModel):
    email: str
    password: str


class EmailLoginRequest(BaseModel):
    email: str
    password: str
    access_token: Optional[str] = None  # if frontend already exchanged via Supabase
    refresh_token: Optional[str] = None


class EmailResetRequest(BaseModel):
    email: str


class OAuthCompleteRequest(BaseModel):
    """Frontend posts this after the system browser returns the user with the
    Supabase access_token in the URL fragment. The frontend reads the fragment,
    forwards it here so the backend can fetch the user profile and upsert
    the Account row. The token itself is then stashed in the Keychain by the
    frontend via the `keychain_set` Tauri command."""
    access_token: str
    refresh_token: Optional[str] = None
    provider: str = "google"


class AccountRead(BaseModel):
    id: str
    supabase_user_id: str
    email: str
    display_name: Optional[str]
    auth_provider: str
    created_at: str
    last_login_at: Optional[str]


class AccountUpdate(BaseModel):
    display_name: Optional[str] = None


def _account_to_dict(a: models.Account) -> dict:
    return {
        "id": a.id,
        "supabase_user_id": a.supabase_user_id,
        "email": a.email,
        "display_name": a.display_name,
        "auth_provider": a.auth_provider,
        "created_at": a.created_at,
        "last_login_at": a.last_login_at,
    }


def _upsert_account(db: Session, *, supabase_user_id: str, email: str,
                    display_name: Optional[str], auth_provider: str) -> models.Account:
    now = datetime.utcnow().isoformat()
    existing = db.query(models.Account).filter(models.Account.id == "me").first()
    if existing:
        existing.supabase_user_id = supabase_user_id
        existing.email = email
        if display_name and not existing.display_name:
            existing.display_name = display_name
        existing.auth_provider = auth_provider
        existing.last_login_at = now
        db.commit()
        db.refresh(existing)
        return existing
    acc = models.Account(
        id="me",
        supabase_user_id=supabase_user_id,
        email=email,
        display_name=display_name or (email.split("@")[0] if email else None),
        auth_provider=auth_provider,
        created_at=now,
        last_login_at=now,
    )
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return acc


def _require_supabase():
    if not supabase_auth.is_configured():
        raise HTTPException(
            status_code=503,
            detail={
                "error": {
                    "code": "supabase_not_configured",
                    "detail": (
                        "Cloud auth is not configured on this device. Set "
                        "SUPABASE_URL and SUPABASE_ANON_KEY env vars to enable."
                    ),
                }
            },
        )


@app.post("/auth/oauth/{provider}/start", response_model=OAuthStartResponse)
def auth_oauth_start(provider: str):
    _require_supabase()
    if provider not in supabase_auth.SUPPORTED_OAUTH_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "unsupported_provider", "detail": provider}},
        )
    return {"auth_url": supabase_auth.build_oauth_url(provider)}


@app.post("/auth/oauth/complete", response_model=AccountRead)
async def auth_oauth_complete(payload: OAuthCompleteRequest, db: Session = Depends(get_db)):
    """Frontend calls this after extracting the Supabase access_token from the
    OAuth redirect's URL fragment. Validates with Supabase, upserts Account."""
    _require_supabase()
    try:
        user = await supabase_auth.get_user(payload.access_token)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=401,
            detail={"error": {"code": "invalid_token", "detail": str(e)}},
        )
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail={"error": {"code": "supabase_unreachable", "detail": str(e)}},
        )

    sub = user.get("id") or user.get("sub")
    email = user.get("email") or ""
    metadata = user.get("user_metadata") or {}
    name = metadata.get("full_name") or metadata.get("name")
    if not sub or not email:
        raise HTTPException(
            status_code=502,
            detail={"error": {"code": "incomplete_user", "detail": "Supabase returned no id/email"}},
        )

    acc = _upsert_account(
        db,
        supabase_user_id=sub,
        email=email,
        display_name=name,
        auth_provider=payload.provider,
    )
    return _account_to_dict(acc)


@app.post("/auth/email/signup", response_model=AccountRead)
async def auth_email_signup(payload: EmailSignupRequest, db: Session = Depends(get_db)):
    _require_supabase()
    try:
        result = await supabase_auth.email_signup(payload.email, payload.password)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail={"error": {"code": "signup_failed", "detail": e.response.text}},
        )
    user = result.get("user") or {}
    sub = user.get("id")
    if not sub:
        # Email-confirmation flow — Supabase returns no user until the link is clicked.
        raise HTTPException(
            status_code=202,
            detail={"error": {"code": "confirmation_required",
                              "detail": "Check your email to confirm before logging in."}},
        )
    acc = _upsert_account(
        db,
        supabase_user_id=sub,
        email=user.get("email") or payload.email,
        display_name=None,
        auth_provider="email",
    )
    return _account_to_dict(acc)


@app.post("/auth/email/login", response_model=AccountRead)
async def auth_email_login(payload: EmailLoginRequest, db: Session = Depends(get_db)):
    _require_supabase()
    try:
        result = await supabase_auth.email_login(payload.email, payload.password)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=401,
            detail={"error": {"code": "login_failed", "detail": e.response.text}},
        )
    user = result.get("user") or {}
    sub = user.get("id")
    email = user.get("email") or payload.email
    if not sub:
        raise HTTPException(
            status_code=502,
            detail={"error": {"code": "incomplete_user", "detail": "Supabase returned no user"}},
        )
    acc = _upsert_account(
        db,
        supabase_user_id=sub,
        email=email,
        display_name=None,
        auth_provider="email",
    )
    return _account_to_dict(acc)


@app.post("/auth/email/reset")
async def auth_email_reset(payload: EmailResetRequest):
    _require_supabase()
    try:
        await supabase_auth.email_reset(payload.email)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail={"error": {"code": "reset_failed", "detail": e.response.text}},
        )
    return {"ok": True}


@app.get("/auth/me")
def auth_me(db: Session = Depends(get_db)):
    """Returns the current Account, or 204 in local-only mode.

    AccountContext on the frontend reads this on boot — 204 means "local mode",
    not an error.
    """
    acc = db.query(models.Account).filter(models.Account.id == "me").first()
    if not acc:
        return Response(status_code=204)
    return _account_to_dict(acc)


@app.patch("/auth/me", response_model=AccountRead)
def auth_update_me(payload: AccountUpdate, db: Session = Depends(get_db)):
    acc = db.query(models.Account).filter(models.Account.id == "me").first()
    if not acc:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "no_account", "detail": "Local mode — sign in first"}},
        )
    if payload.display_name is not None:
        acc.display_name = payload.display_name.strip() or None
    db.commit()
    db.refresh(acc)
    return _account_to_dict(acc)


@app.post("/auth/logout")
def auth_logout(db: Session = Depends(get_db)):
    """Clears the Account row. The frontend is responsible for clearing the
    Keychain `supabase` slot via the `keychain_delete` Tauri command before
    calling this. Per design doc §11 R5 + §10 Q7, sign-out is non-destructive:
    Connections + Events are untouched."""
    acc = db.query(models.Account).filter(models.Account.id == "me").first()
    if acc:
        db.delete(acc)
        db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Phase v3.0 — Cloud Sync (Connections + Sync runner + Sync Review queue)
#
# Hard rails (per LoomAssist_UIUX_Guardrail.md §6 + design doc §3/§11):
#   - Calendar/event data syncs DIRECTLY device ↔ provider; never traverses a
#     LoomAssist server.
#   - OAuth tokens / CalDAV passwords live in macOS Keychain — never SQLite.
#   - external_uid stays ICS-only; sync uses the new external_id column (R7).
#   - Disconnect is non-destructive locally AND remotely (Q7).
#   - All transitions 150–250ms; progress bar in Sync Center is the only
#     ambient animation introduced (no AI sparkle).
# ─────────────────────────────────────────────────────────────────────────────

# ── Pydantic models ──────────────────────────────────────────────────────────

class ConnectionRead(BaseModel):
    id: str
    kind: str
    display_name: str
    account_email: str
    caldav_base_url: Optional[str]
    status: str
    last_synced_at: Optional[str]
    last_error: Optional[str]
    created_at: str


class CalDAVCreateRequest(BaseModel):
    kind: str = "caldav_generic"      # caldav_icloud | caldav_generic
    base_url: str
    username: str
    password: str
    display_name: Optional[str] = None


class CalDAVTestRequest(BaseModel):
    base_url: str
    username: str
    password: str


class GoogleCompleteRequest(BaseModel):
    code: str


class TokenPushRequest(BaseModel):
    """Frontend pushes a token (OAuth refresh_token for Google, JSON for
    CalDAV creds) into the in-memory keychain bridge so the runner can use it
    without making a roundtrip through Tauri. Never persisted server-side."""
    token: str


class RemoteCalendarRead(BaseModel):
    id: str                # remote calendar id (Google) or href (CalDAV)
    display_name: str
    color: Optional[str] = None


class SubscribeRequest(BaseModel):
    remote_calendar_id: str
    remote_display_name: str
    remote_color: Optional[str] = None
    local_calendar_id: Optional[int] = None    # null → create a new timeline
    sync_direction: str = "both"               # both | pull | push


class ConnectionCalendarRead(BaseModel):
    id: str
    connection_id: str
    local_calendar_id: int
    remote_calendar_id: str
    remote_display_name: str
    sync_direction: str
    sync_token: Optional[str]
    caldav_ctag: Optional[str]
    last_full_sync_at: Optional[str]
    created_at: str


class CCPatchRequest(BaseModel):
    sync_direction: Optional[str] = None
    local_calendar_id: Optional[int] = None


class TimelineDecision(BaseModel):
    """Per-timeline strategy on full disconnect."""
    local_calendar_id: int
    strategy: str  # keep | move | delete
    move_target_id: Optional[int] = None


class DisconnectRequest(BaseModel):
    timelines: List[TimelineDecision] = []


class SyncStatusItem(BaseModel):
    connection_id:         str
    status:                str
    last_synced_at:        Optional[str]
    last_error:            Optional[str]
    pending_review_count:  int


class ReviewItemRead(BaseModel):
    id: str
    connection_calendar_id: str
    connection_display_name: str
    kind: str
    local_event_id: Optional[int]
    incoming_payload: dict
    match_score: Optional[float]
    match_reasons: Optional[list]
    created_at: str


class MergePayloadRequest(BaseModel):
    merged_payload: dict


class RejectRequest(BaseModel):
    remember: bool = False


class BulkActionRequest(BaseModel):
    item_ids: List[str]
    action: str  # approve | reject | merge_default


# ── Helpers ──────────────────────────────────────────────────────────────────

def _connection_dict(c: models.Connection) -> dict:
    return {
        "id": c.id, "kind": c.kind, "display_name": c.display_name,
        "account_email": c.account_email, "caldav_base_url": c.caldav_base_url,
        "status": c.status, "last_synced_at": c.last_synced_at,
        "last_error": c.last_error, "created_at": c.created_at,
    }


def _cc_dict(cc: models.ConnectionCalendar) -> dict:
    return {
        "id": cc.id, "connection_id": cc.connection_id,
        "local_calendar_id": cc.local_calendar_id,
        "remote_calendar_id": cc.remote_calendar_id,
        "remote_display_name": cc.remote_display_name,
        "sync_direction": cc.sync_direction,
        "sync_token": cc.sync_token, "caldav_ctag": cc.caldav_ctag,
        "last_full_sync_at": cc.last_full_sync_at, "created_at": cc.created_at,
    }


# ── /connections/* ───────────────────────────────────────────────────────────

@app.get("/connections", response_model=List[ConnectionRead])
def connections_list(db: Session = Depends(get_db)):
    rows = db.query(models.Connection).order_by(models.Connection.created_at).all()
    return [_connection_dict(c) for c in rows]


@app.post("/connections/google/start")
def connections_google_start():
    if not _sync_google.is_configured():
        raise HTTPException(
            status_code=503,
            detail={"error": {"code": "google_not_configured",
                              "detail": "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to enable Google sync."}},
        )
    state = _uuid_sync.uuid4().hex
    return {"auth_url": _sync_google.build_authorize_url(state)}


@app.post("/connections/google/complete", response_model=ConnectionRead)
async def connections_google_complete(payload: GoogleCompleteRequest, db: Session = Depends(get_db)):
    """Complete the Google OAuth flow with the authorization code. The
    frontend extracts the code from the redirect URL and POSTs it here."""
    if not _sync_google.is_configured():
        raise HTTPException(status_code=503, detail={"error": {"code": "google_not_configured"}})
    try:
        tok = await _sync_google.exchange_code(payload.code)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=401,
                            detail={"error": {"code": "google_token_exchange_failed", "detail": e.response.text}})
    refresh_token = tok.get("refresh_token")
    access_token  = tok.get("access_token")
    if not refresh_token or not access_token:
        raise HTTPException(status_code=502,
                            detail={"error": {"code": "google_no_refresh_token",
                                              "detail": "Google did not return a refresh_token. Re-consent required."}})

    info = await _sync_google.fetch_userinfo(access_token)
    cid = str(_uuid_sync.uuid4())
    conn = models.Connection(
        id=cid, kind="google",
        display_name=f"Google — {info.get('email','')}",
        account_email=info.get("email", ""),
        caldav_base_url=None,
        status="connected",
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    _kb.set_token(cid, refresh_token)
    return _connection_dict(conn)


@app.post("/connections/caldav/test")
def connections_caldav_test(payload: CalDAVTestRequest):
    return _sync_caldav.discover_principal(payload.base_url, payload.username, payload.password)


@app.post("/connections/caldav", response_model=ConnectionRead)
def connections_caldav_create(payload: CalDAVCreateRequest, db: Session = Depends(get_db)):
    test = _sync_caldav.discover_principal(payload.base_url, payload.username, payload.password)
    if not test.get("ok"):
        raise HTTPException(status_code=401,
                            detail={"error": {"code": "caldav_auth_failed", "detail": test.get("error", "")}})
    cid = str(_uuid_sync.uuid4())
    display = payload.display_name or f"{payload.kind.replace('caldav_', '').title()} — {payload.username}"
    conn = models.Connection(
        id=cid, kind=payload.kind,
        display_name=display,
        account_email=payload.username,
        caldav_base_url=payload.base_url,
        status="connected",
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    _kb.set_token(cid, _json_sync.dumps({"username": payload.username, "password": payload.password}))
    return _connection_dict(conn)


@app.post("/connections/{connection_id}/token")
def connections_push_token(connection_id: str, payload: TokenPushRequest, db: Session = Depends(get_db)):
    """Frontend pushes a token from the macOS Keychain into the runner's
    in-memory cache. Used after backend restart so sync resumes without a
    full reconnect."""
    if not db.query(models.Connection).filter(models.Connection.id == connection_id).first():
        raise HTTPException(status_code=404, detail={"error": {"code": "connection_not_found"}})
    _kb.set_token(connection_id, payload.token)
    return {"ok": True}


@app.get("/connections/{connection_id}/calendars", response_model=List[RemoteCalendarRead])
async def connections_remote_calendars(connection_id: str, db: Session = Depends(get_db)):
    conn = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail={"error": {"code": "connection_not_found"}})

    if conn.kind == "google":
        token_blob = await _kb.get_token(connection_id)
        if not token_blob:
            raise HTTPException(status_code=401, detail={"error": {"code": "auth_expired"}})
        try:
            tok = await _sync_google.refresh_access_token(token_blob)
        except Exception as e:
            raise HTTPException(status_code=401, detail={"error": {"code": "auth_expired", "detail": str(e)[:200]}})
        cals = await _sync_google.list_calendars(tok["access_token"])
        return [{
            "id":           c.get("id"),
            "display_name": c.get("summary") or "(Untitled)",
            "color":        c.get("backgroundColor"),
        } for c in cals]

    # CalDAV
    creds_blob = await _kb.get_token(connection_id)
    if not creds_blob:
        raise HTTPException(status_code=401, detail={"error": {"code": "auth_expired"}})
    try:
        creds = _json_sync.loads(creds_blob)
    except Exception:
        raise HTTPException(status_code=401, detail={"error": {"code": "auth_expired"}})
    cols = await asyncio.get_event_loop().run_in_executor(
        None, _sync_caldav.list_collections,
        conn.caldav_base_url or _sync_caldav.ICLOUD_DEFAULT_BASE,
        creds["username"], creds["password"],
    )
    return [{"id": c["href"], "display_name": c["display_name"], "color": c.get("color")} for c in cols]


@app.post("/connections/{connection_id}/subscribe", response_model=ConnectionCalendarRead)
async def connections_subscribe(connection_id: str, payload: SubscribeRequest, db: Session = Depends(get_db)):
    conn = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail={"error": {"code": "connection_not_found"}})

    # Auto-create the local timeline if not provided.
    local_cal_id = payload.local_calendar_id
    if local_cal_id is None:
        cal = models.Calendar(
            name=payload.remote_display_name,
            color=payload.remote_color or "#6366f1",
            created_via_sync=True,
        )
        db.add(cal)
        db.commit()
        db.refresh(cal)
        local_cal_id = cal.id

    # UNIQUE(connection_id, remote_calendar_id) check (per §10 Q8).
    existing = (db.query(models.ConnectionCalendar)
                  .filter(models.ConnectionCalendar.connection_id == connection_id,
                          models.ConnectionCalendar.remote_calendar_id == payload.remote_calendar_id)
                  .first())
    if existing:
        raise HTTPException(
            status_code=409,
            detail={"error": {"code": "already_subscribed",
                              "detail": f"This calendar is already synced to timeline {existing.local_calendar_id}."}},
        )

    cc = models.ConnectionCalendar(
        id=str(_uuid_sync.uuid4()),
        connection_id=connection_id,
        local_calendar_id=local_cal_id,
        remote_calendar_id=payload.remote_calendar_id,
        remote_display_name=payload.remote_display_name,
        sync_direction=payload.sync_direction,
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(cc)
    db.commit()
    db.refresh(cc)

    # Trigger an immediate sync so the user sees events appear.
    # In tests where no event loop is running, just skip the kick-off.
    try:
        asyncio.create_task(_sync_runner.run_one(connection_id))
    except RuntimeError:
        pass
    return _cc_dict(cc)


@app.delete("/connections/{connection_id}/calendars/{cc_id}")
def connections_unsubscribe(connection_id: str, cc_id: str, db: Session = Depends(get_db)):
    cc = db.query(models.ConnectionCalendar).filter(
        models.ConnectionCalendar.id == cc_id,
        models.ConnectionCalendar.connection_id == connection_id,
    ).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    # Null-out events bound to this cc — non-destructive locally.
    db.query(models.Event).filter(models.Event.connection_calendar_id == cc_id).update({
        "connection_calendar_id": None,
        "external_id": None,
        "external_etag": None,
        "last_synced_at": None,
    })
    # Drop the join row + any pending review items for it.
    db.query(models.SyncReviewItem).filter(
        models.SyncReviewItem.connection_calendar_id == cc_id
    ).delete()
    db.delete(cc)
    db.commit()
    return {"ok": True}


@app.patch("/connections/{connection_id}/calendars/{cc_id}", response_model=ConnectionCalendarRead)
def connections_cc_patch(connection_id: str, cc_id: str, payload: CCPatchRequest, db: Session = Depends(get_db)):
    cc = db.query(models.ConnectionCalendar).filter(
        models.ConnectionCalendar.id == cc_id,
        models.ConnectionCalendar.connection_id == connection_id,
    ).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    if payload.sync_direction is not None:
        if payload.sync_direction not in ("both", "pull", "push"):
            raise HTTPException(status_code=400, detail={"error": {"code": "bad_direction"}})
        cc.sync_direction = payload.sync_direction
    if payload.local_calendar_id is not None:
        cc.local_calendar_id = payload.local_calendar_id
    db.commit()
    db.refresh(cc)
    return _cc_dict(cc)


@app.post("/connections/{connection_id}/pause", response_model=ConnectionRead)
def connections_pause(connection_id: str, db: Session = Depends(get_db)):
    conn = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail={"error": {"code": "connection_not_found"}})
    conn.status = "paused"
    db.commit()
    db.refresh(conn)
    return _connection_dict(conn)


@app.post("/connections/{connection_id}/resume", response_model=ConnectionRead)
async def connections_resume(connection_id: str, db: Session = Depends(get_db)):
    conn = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail={"error": {"code": "connection_not_found"}})
    conn.status = "connected"
    db.commit()
    db.refresh(conn)
    try:
        asyncio.create_task(_sync_runner.run_one(connection_id))
    except RuntimeError:
        pass
    return _connection_dict(conn)


@app.delete("/connections/{connection_id}")
def connections_disconnect(connection_id: str, payload: DisconnectRequest, db: Session = Depends(get_db)):
    """Full disconnect.

    Per design doc §3 + §10 Q7 + §11 R5: non-destructive locally and remotely.
      - Cascade delete ConnectionCalendar + SyncReviewItem rows.
      - Null-out Event.connection_calendar_id et al on every event tied here.
      - Per affected created_via_sync=true timeline, apply the user's
        keep / move / delete decision (default: keep).
      - Clear the keychain bridge entry.
      - Provider events untouched (we don't delete remote events).
    """
    conn = db.query(models.Connection).filter(models.Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail={"error": {"code": "connection_not_found"}})

    cc_rows = db.query(models.ConnectionCalendar).filter(
        models.ConnectionCalendar.connection_id == connection_id
    ).all()
    cc_ids = [cc.id for cc in cc_rows]

    # Null-out events.
    if cc_ids:
        db.query(models.Event).filter(models.Event.connection_calendar_id.in_(cc_ids)).update(
            {"connection_calendar_id": None, "external_id": None,
             "external_etag": None, "last_synced_at": None},
            synchronize_session=False,
        )
        db.query(models.SyncReviewItem).filter(
            models.SyncReviewItem.connection_calendar_id.in_(cc_ids)
        ).delete(synchronize_session=False)

    # Apply per-timeline decisions.
    decisions = {d.local_calendar_id: d for d in payload.timelines}
    for cc in cc_rows:
        cal = db.query(models.Calendar).filter(models.Calendar.id == cc.local_calendar_id).first()
        if not cal or not cal.created_via_sync:
            continue
        d = decisions.get(cc.local_calendar_id)
        if d is None or d.strategy == "keep":
            continue
        if d.strategy == "move" and d.move_target_id:
            db.query(models.Event).filter(models.Event.calendar_id == cal.id).update(
                {"calendar_id": d.move_target_id}, synchronize_session=False)
            db.delete(cal)
        elif d.strategy == "delete":
            db.query(models.Event).filter(models.Event.calendar_id == cal.id).delete(synchronize_session=False)
            db.delete(cal)

    # Drop the connection's children + the connection itself.
    for cc in cc_rows:
        db.delete(cc)
    db.query(models.SyncIgnoreRule).filter(
        models.SyncIgnoreRule.connection_id == connection_id
    ).delete(synchronize_session=False)
    db.delete(conn)
    db.commit()

    _kb.clear_token(connection_id)
    return {"ok": True}


# ── /sync/* (cloud — distinct namespace from the existing LAN sync) ──────────

@app.post("/sync/run")
async def sync_run_all(db: Session = Depends(get_db)):
    started = await _sync_runner.run_all(db)
    return {"started": started}


@app.post("/sync/run/{connection_id}")
async def sync_run_one(connection_id: str, db: Session = Depends(get_db)):
    if not db.query(models.Connection).filter(models.Connection.id == connection_id).first():
        raise HTTPException(status_code=404, detail={"error": {"code": "connection_not_found"}})
    await _sync_runner.run_one(connection_id)
    return {"started": connection_id}


@app.get("/sync/status", response_model=List[SyncStatusItem])
def sync_status(db: Session = Depends(get_db)):
    out: List[dict] = []
    for c in db.query(models.Connection).all():
        review_count = (
            db.query(models.SyncReviewItem)
              .join(models.ConnectionCalendar, models.ConnectionCalendar.id == models.SyncReviewItem.connection_calendar_id)
              .filter(models.ConnectionCalendar.connection_id == c.id,
                      models.SyncReviewItem.resolved_at.is_(None))
              .count()
        )
        out.append({
            "connection_id":         c.id,
            "status":                c.status,
            "last_synced_at":        c.last_synced_at,
            "last_error":            c.last_error,
            "pending_review_count":  review_count,
        })
    return out


@app.get("/sync/events")
async def sync_events_stream():
    """SSE endpoint. Frontend's SyncContext subscribes once on mount; the
    runner pushes {conn_id, phase, ...} events."""
    queue = _sync_runner.subscribe()

    async def gen():
        try:
            yield "event: ready\ndata: {}\n\n"
            while True:
                evt = await queue.get()
                yield f"data: {_json_sync.dumps(evt)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            _sync_runner.unsubscribe(queue)

    return StreamingResponse(gen(), media_type="text/event-stream")


# ── /sync/review/* ───────────────────────────────────────────────────────────

def _review_to_dict(item: models.SyncReviewItem, conn_display_name: str) -> dict:
    return {
        "id":                       item.id,
        "connection_calendar_id":   item.connection_calendar_id,
        "connection_display_name":  conn_display_name,
        "kind":                     item.kind,
        "local_event_id":           item.local_event_id,
        "incoming_payload":         _json_sync.loads(item.incoming_payload) if item.incoming_payload else {},
        "match_score":              item.match_score,
        "match_reasons":            _json_sync.loads(item.match_reasons) if item.match_reasons else None,
        "created_at":               item.created_at,
    }


@app.get("/sync/review", response_model=List[ReviewItemRead])
def sync_review_list(
    connection_id: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    q = (db.query(models.SyncReviewItem, models.ConnectionCalendar, models.Connection)
           .join(models.ConnectionCalendar, models.ConnectionCalendar.id == models.SyncReviewItem.connection_calendar_id)
           .join(models.Connection,         models.Connection.id == models.ConnectionCalendar.connection_id)
           .filter(models.SyncReviewItem.resolved_at.is_(None)))
    if connection_id:
        q = q.filter(models.Connection.id == connection_id)
    if kind:
        q = q.filter(models.SyncReviewItem.kind == kind)
    rows = q.order_by(models.SyncReviewItem.created_at.desc()).limit(limit).all()
    return [_review_to_dict(item, conn.display_name) for (item, _cc, conn) in rows]


@app.get("/sync/review/{item_id}", response_model=ReviewItemRead)
def sync_review_get(item_id: str, db: Session = Depends(get_db)):
    row = (db.query(models.SyncReviewItem, models.ConnectionCalendar, models.Connection)
             .join(models.ConnectionCalendar, models.ConnectionCalendar.id == models.SyncReviewItem.connection_calendar_id)
             .join(models.Connection,         models.Connection.id == models.ConnectionCalendar.connection_id)
             .filter(models.SyncReviewItem.id == item_id)
             .first())
    if not row:
        raise HTTPException(status_code=404, detail={"error": {"code": "review_not_found"}})
    item, _cc, conn = row
    return _review_to_dict(item, conn.display_name)


def _resolve_item(item: models.SyncReviewItem, resolution: str, payload: Optional[dict] = None) -> None:
    item.resolved_at         = datetime.utcnow().isoformat()
    item.resolution          = resolution
    item.resolution_payload  = _json_sync.dumps(payload) if payload else None


@app.post("/sync/review/{item_id}/approve")
def sync_review_approve(item_id: str, db: Session = Depends(get_db)):
    """User says 'these are different events' — apply the incoming payload as
    a brand-new local event (not merged into the candidate)."""
    item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == item_id).first()
    if not item or item.resolved_at:
        raise HTTPException(status_code=404, detail={"error": {"code": "review_resolved_or_missing"}})
    cc = db.query(models.ConnectionCalendar).filter(models.ConnectionCalendar.id == item.connection_calendar_id).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"error": {"code": "cc_not_found"}})
    p = _json_sync.loads(item.incoming_payload)
    new_ev = models.Event(
        title=p.get("title") or "(Untitled)",
        start_time=p.get("start_time") or datetime.utcnow().isoformat(),
        end_time=p.get("end_time")     or datetime.utcnow().isoformat(),
        calendar_id=cc.local_calendar_id,
        description=p.get("description"),
        location=p.get("location"),
        is_all_day=bool(p.get("is_all_day")),
        connection_calendar_id=cc.id,
        external_id=p.get("external_id"),
        external_etag=p.get("external_etag"),
        last_synced_at=datetime.utcnow().isoformat(),
        last_modified=datetime.utcnow().isoformat(),
    )
    db.add(new_ev)
    db.flush()
    _resolve_item(item, "approved_new", {"event_id": new_ev.id})
    db.commit()
    return {"event_id": new_ev.id}


@app.post("/sync/review/{item_id}/merge")
def sync_review_merge(item_id: str, body: MergePayloadRequest, db: Session = Depends(get_db)):
    """Apply the user-merged payload to the candidate local event, then push
    to the provider (best-effort — push failures get queued for retry)."""
    item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == item_id).first()
    if not item or item.resolved_at:
        raise HTTPException(status_code=404, detail={"error": {"code": "review_resolved_or_missing"}})
    if not item.local_event_id:
        raise HTTPException(status_code=400, detail={"error": {"code": "no_local_event"}})
    ev = db.query(models.Event).filter(models.Event.id == item.local_event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail={"error": {"code": "event_missing"}})
    cc = db.query(models.ConnectionCalendar).filter(models.ConnectionCalendar.id == item.connection_calendar_id).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"error": {"code": "cc_not_found"}})

    p = body.merged_payload or {}
    for k in ("title", "start_time", "end_time", "description", "location", "is_all_day"):
        if k in p:
            setattr(ev, k, p[k])
    ev.connection_calendar_id = cc.id
    if p.get("external_id"):    ev.external_id   = p["external_id"]
    if p.get("external_etag"):  ev.external_etag = p["external_etag"]
    ev.last_synced_at = datetime.utcnow().isoformat()
    ev.last_modified  = datetime.utcnow().isoformat()
    _resolve_item(item, "merged", {"event_id": ev.id})
    db.commit()
    return {"event_id": ev.id}


@app.post("/sync/review/{item_id}/replace-local")
def sync_review_replace_local(item_id: str, db: Session = Depends(get_db)):
    """Use incoming wholesale; overwrite local."""
    item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == item_id).first()
    if not item or item.resolved_at:
        raise HTTPException(status_code=404, detail={"error": {"code": "review_resolved_or_missing"}})
    cc = db.query(models.ConnectionCalendar).filter(models.ConnectionCalendar.id == item.connection_calendar_id).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"error": {"code": "cc_not_found"}})
    p = _json_sync.loads(item.incoming_payload)
    if item.local_event_id:
        ev = db.query(models.Event).filter(models.Event.id == item.local_event_id).first()
        if ev:
            for k in ("title", "start_time", "end_time", "description", "location", "is_all_day"):
                if k in p:
                    setattr(ev, k, p[k])
            ev.connection_calendar_id = cc.id
            ev.external_id   = p.get("external_id")   or ev.external_id
            ev.external_etag = p.get("external_etag") or ev.external_etag
            ev.last_synced_at = datetime.utcnow().isoformat()
            ev.last_modified  = datetime.utcnow().isoformat()
            _resolve_item(item, "replaced_local", {"event_id": ev.id})
            db.commit()
            return {"event_id": ev.id}
    # Fallback: insert new (mirrors approve).
    new_ev = models.Event(
        title=p.get("title") or "(Untitled)",
        start_time=p.get("start_time") or datetime.utcnow().isoformat(),
        end_time=p.get("end_time")     or datetime.utcnow().isoformat(),
        calendar_id=cc.local_calendar_id,
        description=p.get("description"), location=p.get("location"),
        is_all_day=bool(p.get("is_all_day")),
        connection_calendar_id=cc.id,
        external_id=p.get("external_id"),
        external_etag=p.get("external_etag"),
        last_synced_at=datetime.utcnow().isoformat(),
        last_modified=datetime.utcnow().isoformat(),
    )
    db.add(new_ev)
    db.flush()
    _resolve_item(item, "replaced_local", {"event_id": new_ev.id})
    db.commit()
    return {"event_id": new_ev.id}


@app.post("/sync/review/{item_id}/reject")
def sync_review_reject(item_id: str, body: RejectRequest, db: Session = Depends(get_db)):
    item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == item_id).first()
    if not item or item.resolved_at:
        raise HTTPException(status_code=404, detail={"error": {"code": "review_resolved_or_missing"}})
    cc = db.query(models.ConnectionCalendar).filter(models.ConnectionCalendar.id == item.connection_calendar_id).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"error": {"code": "cc_not_found"}})

    if body.remember:
        p = _json_sync.loads(item.incoming_payload)
        h = hashlib.sha256(("|".join([
            cc.remote_calendar_id or "",
            p.get("external_id") or "",
            p.get("start_time")  or "",
            p.get("title")       or "",
        ])).encode("utf-8")).hexdigest()
        if not (db.query(models.SyncIgnoreRule)
                  .filter(models.SyncIgnoreRule.connection_id == cc.connection_id,
                          models.SyncIgnoreRule.incoming_hash == h)
                  .first()):
            db.add(models.SyncIgnoreRule(
                connection_id=cc.connection_id,
                incoming_hash=h,
                created_at=datetime.utcnow().isoformat(),
            ))
    _resolve_item(item, "ignored_forever" if body.remember else "rejected")
    db.commit()
    return {"ok": True}


@app.post("/sync/review/bulk")
def sync_review_bulk(body: BulkActionRequest, db: Session = Depends(get_db)):
    if body.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail={"error": {"code": "bad_bulk_action"}})
    n = 0
    for iid in body.item_ids:
        item = db.query(models.SyncReviewItem).filter(models.SyncReviewItem.id == iid).first()
        if not item or item.resolved_at:
            continue
        if body.action == "reject":
            _resolve_item(item, "rejected")
            n += 1
    db.commit()
    return {"resolved": n}


# ==========================================
# AI BRIEFING (Future-features 2C)
# ==========================================

@app.post("/ai/briefing")
def ai_briefing(db: Session = Depends(get_db)):
    """Plain-text summary of today's events, suitable for TTS."""
    return compute_briefing(db)

# ─────────────────────────────────────────────────────────────────────────────