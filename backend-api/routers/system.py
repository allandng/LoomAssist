from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from typing import Optional

from core.deps import _check_rate
from loom_logger import get_logger, LOG_FILE, CRASH_FLAG

router = APIRouter()


class FrontendLogEntry(BaseModel):
    level: str
    message: str
    context: Optional[dict] = None


@router.post("/api/logs")
async def receive_frontend_log(entry: FrontendLogEntry, request: Request):
    ip = request.client.host if request.client else "unknown"
    if not _check_rate(ip):
        return JSONResponse(status_code=429, content={"error": {"code": "rate_limited"}})
    frontend_logger = get_logger("frontend")
    level = entry.level.upper()
    msg = entry.message if not entry.context else f"{entry.message} | {entry.context}"
    getattr(frontend_logger, level.lower(), frontend_logger.info)(msg)
    return {"status": "ok"}


@router.get("/api/logs/crash-flag")
def get_crash_flag():
    if CRASH_FLAG.exists():
        crash_file = CRASH_FLAG.read_text().strip()
        CRASH_FLAG.unlink(missing_ok=True)
        return {"crashed": True, "crash_file": crash_file}
    return {"crashed": False, "crash_file": None}


@router.get("/api/logs/export")
def export_logs():
    if not LOG_FILE.exists():
        return Response(
            content="No log file found.",
            media_type="text/plain",
            headers={"Content-Disposition": 'attachment; filename="loomassist_logs.txt"'},
        )
    lines = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
    content = "".join(lines[-500:])
    return Response(
        content=content,
        media_type="text/plain",
        headers={"Content-Disposition": 'attachment; filename="loomassist_logs.txt"'},
    )


@router.delete("/api/logs")
def clear_logs():
    if LOG_FILE.exists():
        LOG_FILE.unlink()
    LOG_FILE.touch()
    return {"status": "ok"}


@router.get("/")
async def root():
    return {"status": "online", "message": "Loom Backend is running."}
