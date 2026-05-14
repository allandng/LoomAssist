"""Smart scheduling + wellness routes.

Covers /schedule/* (find-free, autopilot, resolve-conflict, analyze,
detect-clusters, procrastination-radar) plus /stats/duration. The
schedule-adjacent duration aggregation is co-located here rather than
in a single-route stats router — moving it elsewhere would split
cohesion for URL purity.

LLM-bearing routes (resolve-conflict, analyze) lazy-import their services
inside the handler so the LLM ollama_client stays out of the app boot
path. The deterministic exam-cluster helper backs both /analyze (combined
with the LLM call) and /detect-clusters (mutation-triggered, no LLM).
"""
from datetime import datetime, timedelta
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models
from services.exam_cluster import detect_exam_clusters as _detect_exam_clusters
from services.scheduling.autopilot import compute_autopilot_proposals
from services.scheduling.duration_stats import compute_duration_stats
from services.scheduling.find_free import _find_free_slots_internal
from services.scheduling.procrastination import compute_procrastination_warnings

router = APIRouter()


# ==========================================
# SMART SCHEDULING — FREE SLOT FINDER
# ==========================================

class FindFreeRequest(BaseModel):
    window_start: str           # ISO datetime
    window_end: str             # ISO datetime
    duration_minutes: int = 60
    working_hours_start: int = 9
    working_hours_end: int = 18


@router.post("/schedule/find-free")
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


@router.post("/schedule/autopilot", response_model=AutopilotResponse)
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


@router.post("/schedule/resolve-conflict", response_model=ConflictResolutionResponse)
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

    # Lazy import: keeps LLM model out of app boot path.
    # See services/ai/conflict_resolver.py for the lazy-load contract.
    from services.ai.conflict_resolver import resolve_conflict_suggestions
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


@router.post("/schedule/analyze", response_model=WellnessAnalysisResponse)
def analyze_schedule(request: ScheduleAnalyzeRequest):
    # Deterministic rules first — they don't depend on the LLM call and never fail.
    warnings = _exam_cluster_warnings(request.events)
    # Lazy import: keeps LLM model out of app boot path.
    # See services/ai/wellness.py for the lazy-load contract.
    from services.ai.wellness import compute_llm_wellness_warnings
    warnings.extend(WellnessWarning(**w) for w in compute_llm_wellness_warnings(request.events))
    return WellnessAnalysisResponse(warnings=warnings)


@router.post("/schedule/detect-clusters", response_model=WellnessAnalysisResponse)
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


@router.get("/schedule/procrastination-radar", response_model=ProcrastinationRadarResponse)
def procrastination_radar(db: Session = Depends(get_db)):
    warnings_raw = compute_procrastination_warnings(db, datetime.now())
    return ProcrastinationRadarResponse(
        warnings=[ProcrastinationWarning(**w) for w in warnings_raw],
    )


# ==========================================
# DURATION ANALYTICS ROUTES
# ==========================================

@router.get("/stats/duration")
def duration_stats(db: Session = Depends(get_db)):
    return {"entries": compute_duration_stats(db)}
