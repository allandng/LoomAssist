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
from services.ai.embedder import try_upsert_event_embedding
from services.ai.briefing import compute_briefing
from services.ai.parse_datetime import parse_nl_datetime
from services.ai.reminders import infer_reminder as _infer_reminder  # alias avoids shadowing the route handler `infer_reminder(req)` below
from services.ai.wellness import compute_llm_wellness_warnings
from services.ai.intent import extract_intent, execute_intent
from services.ai.conflict_resolver import resolve_conflict_suggestions
from services.ai.weekly_review import compute_weekly_metrics as _compute_weekly_metrics, generate_weekly_narrative
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
from routers import tasks
from routers import journal
from routers import study_blocks
from routers import availability
from routers import inbox
from routers import courses
from routers import backup
from routers import integrations
from routers import lan_sync

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