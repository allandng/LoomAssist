import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models
from services.ai import whisper

router = APIRouter(prefix="/journal")

# Resolves to backend-api/journal_audio. main.py originally used
# Path(__file__).parent (one level shallower); from here we must walk up
# out of routers/ to land on the same directory.
_JOURNAL_AUDIO_DIR = Path(__file__).resolve().parent.parent / "journal_audio"

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
                _JOURNAL_AUDIO_DIR.mkdir(exist_ok=True)
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


@router.delete("/{entry_id}")
def delete_journal_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(models.JournalEntry).filter(models.JournalEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    db.delete(entry)
    db.commit()
    return {"status": "deleted"}
