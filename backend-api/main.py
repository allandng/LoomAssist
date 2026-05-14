import _runtime_env  # noqa: F401  MUST be first import — sets env vars before torch/CT2/tokenizers load
from loom_logger import get_logger, write_crash_snapshot, LOG_FILE, CRASH_FLAG
import logging
logging.basicConfig(handlers=[])  # suppress root handler noise

from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, Form, Request
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


# ==========================================
# AI BRIEFING (Future-features 2C)
# ==========================================

@app.post("/ai/briefing")
def ai_briefing(db: Session = Depends(get_db)):
    """Plain-text summary of today's events, suitable for TTS."""
    return compute_briefing(db)

# ─────────────────────────────────────────────────────────────────────────────