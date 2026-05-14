"""AI-delegate routes — every handler here is a thin wrapper over a
services.ai.* function.

Routes:
  /parse/datetime           NL → ISO datetime via Llama
  /intent                   Quick-add NL → structured intent
  /intent/apply             Apply a confirmed voice intent (move/cancel/resize)
  /transcribe               Audio upload → Whisper STT → chained intents
  /ai/infer-reminder        Adaptive reminder lead-time inference
  /ai/briefing              Plain-text TTS briefing (no LLM)
  /ai/weekly-review         One-shot weekly narrative (DEPRECATED, kept for
                            backwards compat — frontend falls back to this
                            when no cached row exists yet)
  /reviews/weekly  GET      Cached weekly review lookup
  /reviews/weekly  POST     Regenerate + cache the weekly review

LLM-bearing services are lazy-imported inside the handler so
services.ai.ollama_client stays out of the app boot path. Pure paths
(briefing, cache lookup, whisper transcription) stay module-top.
"""
import json
import os
import tempfile
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models
from loom_logger import get_logger
from services.ai import whisper
from services.ai.briefing import compute_briefing

router = APIRouter()
logger = get_logger("main")


# ==========================================
# NATURAL LANGUAGE DATETIME PARSER
# ==========================================

class DatetimeParseRequest(BaseModel):
    input: str


@router.post("/parse/datetime")
async def parse_datetime_nl(req: DatetimeParseRequest):
    # Lazy import: keeps LLM model out of app boot path.
    # See services/ai/parse_datetime.py for the lazy-load contract.
    from services.ai.parse_datetime import parse_nl_datetime
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
# QUICK-ADD INTENT ROUTE (Phase 5 extended)
# ==========================================

class IntentRequest(BaseModel):
    text: str
    calendar_id: Optional[int] = None


@router.post('/intent')
def process_intent(request: IntentRequest, db: Session = Depends(get_db)):
    # Lazy import: keeps LLM model out of app boot path.
    # See services/ai/intent.py for the lazy-load contract.
    from services.ai.intent import extract_intent, execute_intent
    try:
        intent_data = extract_intent(request.text)
        result = execute_intent(intent_data, db)
        return {"status": "success", "result": result, "intent": intent_data}
    except Exception as e:
        logger.error(f"Intent processing failed: {e}")
        raise HTTPException(status_code=500,
            detail={'error': {'code': 'intent_failed', 'detail': str(e)}})


# ==========================================
# ADAPTIVE REMINDERS
# ==========================================

class InferReminderRequest(BaseModel):
    title: str
    description: Optional[str] = None

class InferReminderResponse(BaseModel):
    minutes: int
    rationale: str


@router.post("/ai/infer-reminder", response_model=InferReminderResponse)
def infer_reminder(req: InferReminderRequest):
    # Lazy import: keeps LLM model out of app boot path.
    # See services/ai/reminders.py for the lazy-load contract.
    # Aliased to _infer_reminder to avoid shadowing this route handler.
    from services.ai.reminders import infer_reminder as _infer_reminder
    try:
        result = _infer_reminder(req.title, req.description)
        return InferReminderResponse(**result)
    except Exception as e:
        logger.error(f"infer-reminder error: {e}")
        return InferReminderResponse(minutes=15, rationale="Default reminder")


# ==========================================
# WEEKLY REVIEW
# ==========================================

class WeeklyReviewRequest(BaseModel):
    week_start: str  # ISO datetime — the Monday 00:00:00 of the week to review


# DEPRECATED: prefer POST /reviews/weekly which persists the result. This route
# is retained for backwards compatibility — frontend uses it as the one-shot
# fallback when no cached row exists yet.
@router.post("/ai/weekly-review")
async def weekly_review(req: WeeklyReviewRequest, db: Session = Depends(get_db)):
    week_start = datetime.fromisoformat(req.week_start)
    # Lazy import: keeps LLM model out of app boot path.
    # See services/ai/weekly_review.py for the lazy-load contract.
    from services.ai.weekly_review import generate_weekly_narrative
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


@router.get("/reviews/weekly")
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


@router.post("/reviews/weekly")
async def generate_and_cache_weekly_review(req: WeeklyReviewGenRequest, db: Session = Depends(get_db)):
    week_start_str = req.week_start or _last_monday_iso()
    try:
        ws = datetime.fromisoformat(week_start_str)
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": {"code": "bad_week_start"}})
    ws_date = ws.date().isoformat()

    # Lazy import: keeps LLM model out of app boot path.
    # See services/ai/weekly_review.py for the lazy-load contract. The pure
    # aggregation `compute_weekly_metrics` lives in the same module as the
    # LLM-bearing `generate_weekly_narrative`, so deferring import here keeps
    # ollama_client off the boot path for both call sites.
    from services.ai.weekly_review import compute_weekly_metrics
    metrics = compute_weekly_metrics(ws, db)

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

@router.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...), db: Session = Depends(get_db)):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:
        temp_audio.write(await file.read())
        temp_file_path = temp_audio.name

    try:
        segments, info = whisper.get_model().transcribe(temp_file_path, beam_size=5)
        raw_text = "".join([segment.text for segment in segments]).strip()
        sentences = [sentence.strip() + "." for sentence in raw_text.split(".") if sentence.strip()]

        # Lazy import: keeps LLM model out of app boot path.
        # See services/ai/intent.py for the lazy-load contract.
        from services.ai.intent import extract_intent, execute_intent

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


@router.post("/intent/apply")
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


# ==========================================
# AI BRIEFING (Future-features 2C)
# ==========================================

@router.post("/ai/briefing")
def ai_briefing(db: Session = Depends(get_db)):
    """Plain-text summary of today's events, suitable for TTS."""
    return compute_briefing(db)
