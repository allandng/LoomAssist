import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from core.paths import journal_audio_dir
from database import models
from services.ai import whisper

router = APIRouter(prefix="/journal")

# Resolves to backend-api/journal_audio by default (LOOM_JOURNAL_AUDIO_DIR /
# LOOM_DATA_DIR override) — the same anchor routers/backup.py uses when it
# bundles or restores recordings, and never the CWD.
_JOURNAL_AUDIO_DIR = journal_audio_dir()

_AUDIO_MEDIA_TYPES = {
    ".webm": "audio/webm", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4", ".wav": "audio/wav", ".aac": "audio/aac",
}

_JOURNAL_TEXT_MAX = 600


class JournalCreateRequest(BaseModel):
    date: Optional[str] = None     # defaults to today
    mood: Optional[str] = None     # "great" | "ok" | "rough"
    save_audio: bool = False


class JournalTextCreate(BaseModel):
    text: str
    event_id: Optional[int] = None
    date: Optional[str] = None     # defaults to today
    mood: Optional[str] = None


class JournalUpdate(BaseModel):
    """PUT /journal/{id}. Only fields present in the body change; an explicit
    `null` clears `mood` / `event_id` (exclude_unset semantics)."""
    transcript: Optional[str] = None
    mood: Optional[str] = None
    event_id: Optional[int] = None
    date: Optional[str] = None


class TranscribeResponse(BaseModel):
    text: str
    duration_seconds: Optional[float] = None


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_journal_audio(
    audio: Optional[UploadFile] = File(None),
    file: Optional[UploadFile] = File(None),
):
    """Whisper-only transcription for reflections: returns the text and
    nothing else — no intent extraction, no DB write (unlike POST /transcribe,
    which parses and executes calendar intents). Accepts the recording as
    multipart field `audio` (same as POST /journal) or `file` (same as
    POST /transcribe)."""
    upload = audio or file
    if upload is None:
        raise HTTPException(status_code=400, detail={"error": {
            "code": "missing_audio", "detail": "Send the recording as multipart field `audio` (or `file`)."}})
    data = await upload.read()
    if not data:
        raise HTTPException(status_code=400, detail={"error": {"code": "empty_audio"}})

    suffix = Path(upload.filename or "").suffix.lower() or ".webm"
    if suffix not in _AUDIO_MEDIA_TYPES and suffix not in (".mp4", ".flac", ".opus"):
        suffix = ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        segments, info = whisper.get_model().transcribe(tmp_path, beam_size=5)
        text = " ".join(seg.text.strip() for seg in segments if getattr(seg, "text", None) and seg.text.strip()).strip()
        duration = getattr(info, "duration", None)
        return TranscribeResponse(
            text=text,
            duration_seconds=float(duration) if isinstance(duration, (int, float)) else None,
        )
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.post("", response_model=models.JournalEntryRead)
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
                _JOURNAL_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
                audio_dest = _JOURNAL_AUDIO_DIR / f"journal_{entry_date}_{int(datetime.now().timestamp())}.webm"
                shutil.copy(tmp_path, audio_dest)
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


@router.post("/text", response_model=models.JournalEntryRead)
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


@router.get("", response_model=list[models.JournalEntryRead])
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


@router.put("/{entry_id}", response_model=models.JournalEntryRead)
def update_journal_entry(entry_id: int, payload: JournalUpdate, db: Session = Depends(get_db)):
    """Edit an entry after save. Fields omitted from the body are untouched;
    `mood: null` / `event_id: null` clear those columns. `transcript` is
    trimmed and capped like POST /journal/text; `date` cannot be nulled."""
    entry = db.query(models.JournalEntry).filter(models.JournalEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    data = payload.model_dump(exclude_unset=True)
    if "transcript" in data:
        text_value = (data["transcript"] or "").strip()
        if not text_value:
            raise HTTPException(status_code=400, detail={"error": {"code": "empty_text"}})
        data["transcript"] = text_value[:_JOURNAL_TEXT_MAX]
    if "date" in data and not data["date"]:
        data.pop("date")  # NOT NULL column — ignore null/empty
    for k, v in data.items():
        setattr(entry, k, v)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/{entry_id}/audio")
def get_journal_audio(entry_id: int, db: Session = Depends(get_db)):
    """Stream the saved recording for a journal entry.

    The stored `audio_path` must resolve to a file *inside* the journal audio
    directory — anything else (missing file, traversal, absolute path outside
    the dir) is a 404 so the DB can never be used to read arbitrary files.
    """
    entry = db.query(models.JournalEntry).filter(models.JournalEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    if not entry.audio_path:
        raise HTTPException(status_code=404, detail={"error": {"code": "no_audio"}})

    audio_root = _JOURNAL_AUDIO_DIR.resolve()
    candidate = Path(entry.audio_path)
    if not candidate.is_absolute():
        candidate = audio_root / candidate.name
    try:
        resolved = candidate.resolve(strict=True)
    except (OSError, RuntimeError):
        # Path recorded on another machine / moved install: retry by basename.
        try:
            resolved = (audio_root / candidate.name).resolve(strict=True)
        except (OSError, RuntimeError):
            raise HTTPException(status_code=404, detail={"error": {"code": "audio_missing"}})
    if audio_root not in resolved.parents or not resolved.is_file():
        raise HTTPException(status_code=404, detail={"error": {"code": "audio_missing"}})

    media_type = _AUDIO_MEDIA_TYPES.get(resolved.suffix.lower(), "application/octet-stream")
    return FileResponse(str(resolved), media_type=media_type, filename=resolved.name)


@router.delete("/{entry_id}")
def delete_journal_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(models.JournalEntry).filter(models.JournalEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    db.delete(entry)
    db.commit()
    return {"status": "deleted"}
