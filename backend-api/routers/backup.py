"""Backup and restore routes.

NOTE: /admin/backup and /admin/restore have no authentication —
designed for local desktop use only. Do not expose these endpoints
over a network without adding auth.

Routes (see CLAUDE.md for the frontend contract):
  GET  /admin/backup            -> FileResponse: consistent SQLite snapshot
                                   (attachment; filename=loom-backup.sqlite3)
  POST /admin/restore           -> multipart/form-data, field name `file`
                                   (raw .sqlite3). Replaces the live DB.
  POST /backup/export           -> JSON {passphrase, include_audio} ->
                                   encrypted .loombackup (tar.gz of DB + audio)
  POST /backup/import           -> multipart: `passphrase` (form) + `file`

Replacing the live database on Windows: SQLite keeps the file open through
the connection pool, and Windows refuses to rename over an open file
(PermissionError / WinError 32). `_replace_live_db` therefore disposes the
engine, stages the new file next to the target, and retries `os.replace`
with back-off; if the file is still held it returns 409 `db_locked` and
leaves the original untouched. A `.pre-restore.bak` copy is always taken
first.
"""
import io
import os
import shutil
import sqlite3
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from starlette.background import BackgroundTask

import database.database as _dbmod
from database.database import engine  # noqa: F401  (kept for tests that patch it)
from core.paths import db_path as _resolve_db_path, journal_audio_dir
from loom_logger import get_logger
from services.crypto.backup import _encrypt_backup, _decrypt_backup

router = APIRouter()
logger = get_logger("backup")

SQLITE_HEADER = b"SQLite format 3\x00"
_REPLACE_ATTEMPTS = 8
_REPLACE_BACKOFF_S = 0.25


class BackupExportRequest(BaseModel):
    passphrase: str
    include_audio: bool = False


class BackupImportResponse(BaseModel):
    success: bool
    message: str


class BackupImportRequest(BaseModel):
    passphrase: str


# ── Helpers ──────────────────────────────────────────────────────────────────

def _db_path() -> str:
    """Live SQLite path (honours LOOM_DB_PATH; anchored to backend-api/)."""
    return str(_resolve_db_path())


def _snapshot_to_temp(db_path: str) -> str:
    """Consistent copy via the SQLite online-backup API (safe with WAL /
    concurrent writers). Returns the temp file path."""
    fd, tmp_path = tempfile.mkstemp(suffix=".sqlite3")
    os.close(fd)
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(tmp_path)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    return tmp_path


def _validate_sqlite_file(tmp_path: str) -> None:
    test_eng = create_engine(f"sqlite:///{Path(tmp_path).as_posix()}")
    try:
        with test_eng.connect() as conn:
            conn.execute(text("SELECT 1"))
            conn.execute(text("SELECT name FROM sqlite_master LIMIT 1"))
    finally:
        test_eng.dispose()


def _remove_quiet(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def _replace_live_db(src_tmp: str, dest: str) -> None:
    """Atomically swap `src_tmp` into `dest`, Windows-safe.

    Raises HTTPException(409) if the live DB stays locked after retries.
    Caller is responsible for the pre-restore backup and for cleaning up
    `src_tmp` on failure (this function removes it on success).
    """
    dest_dir = os.path.dirname(os.path.abspath(dest)) or "."
    os.makedirs(dest_dir, exist_ok=True)
    staged = dest + ".incoming"
    shutil.copy2(src_tmp, staged)  # same volume as dest -> os.replace is atomic

    last_exc: Exception | None = None
    for attempt in range(_REPLACE_ATTEMPTS):
        try:
            _dbmod.engine.dispose()  # release pooled sqlite handles
        except Exception:
            pass
        try:
            os.replace(staged, dest)
            # Stale WAL/SHM/journal sidecars belong to the *old* database.
            for suffix in ("-wal", "-shm", "-journal"):
                _remove_quiet(dest + suffix)
            _remove_quiet(src_tmp)
            return
        except PermissionError as exc:
            last_exc = exc
            time.sleep(_REPLACE_BACKOFF_S * (attempt + 1))
        except OSError as exc:
            last_exc = exc
            break

    _remove_quiet(staged)
    logger.error("restore: could not replace live DB: %s", last_exc)
    raise HTTPException(
        status_code=409,
        detail={"error": {"code": "db_locked",
                          "detail": "The database file is still in use. Close other LoomAssist "
                                    "windows / tools that have it open and try again."}},
    )


def _post_restore_migrate() -> None:
    """Bring an older backup up to the current schema. Best-effort."""
    try:
        _dbmod.run_migrations()
        _dbmod.create_db_and_tables()
    except Exception as e:  # pragma: no cover — logged, never fatal
        logger.warning("post-restore migration failed: %s", e)


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/admin/backup")
def backup_database():
    """Download a consistent snapshot of the live database as a file."""
    db_path = _db_path()
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404,
            detail={"error": {"code": "db_not_found", "detail": "Database file not found."}})
    try:
        tmp_path = _snapshot_to_temp(db_path)
    except Exception as e:
        raise HTTPException(status_code=500,
            detail={"error": {"code": "snapshot_failed", "detail": str(e)}})
    return FileResponse(
        tmp_path,
        media_type="application/octet-stream",
        filename="loom-backup.sqlite3",
        background=BackgroundTask(_remove_quiet, tmp_path),
    )


@router.post("/admin/restore")
async def restore_database(file: UploadFile = File(...)):
    """Restore from a raw .sqlite3 upload (multipart field name: `file`)."""
    content = await file.read()
    # Validate SQLite magic bytes
    if len(content) < 16 or content[:16] != SQLITE_HEADER:
        raise HTTPException(status_code=400,
            detail={"error": {"code": "invalid_db_file",
                              "detail": "File is not a valid SQLite database."}})

    # Write to temp and verify it opens
    fd, tmp_path = tempfile.mkstemp(suffix=".sqlite3")
    with os.fdopen(fd, "wb") as tmp:
        tmp.write(content)

    try:
        _validate_sqlite_file(tmp_path)
    except Exception:
        _remove_quiet(tmp_path)
        raise HTTPException(status_code=400,
            detail={"error": {"code": "corrupt_db", "detail": "Backup file is corrupt."}})

    db_path = _db_path()
    pre_bak = db_path + ".pre-restore.bak"
    if os.path.exists(db_path):
        try:
            shutil.copy2(db_path, pre_bak)
        except OSError as e:
            _remove_quiet(tmp_path)
            raise HTTPException(status_code=500,
                detail={"error": {"code": "pre_backup_failed", "detail": str(e)}})

    try:
        _replace_live_db(tmp_path, db_path)
    except HTTPException:
        _remove_quiet(tmp_path)
        raise
    _post_restore_migrate()
    return {"status": "success", "message": "Database restored. Reload your data.",
            "pre_restore_backup": pre_bak if os.path.exists(pre_bak) else None}


@router.post("/backup/export")
def export_backup(req: BackupExportRequest):
    db_path = _db_path()
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail={"error": {"code": "db_not_found"}})

    # SQLite online backup to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite3") as tmp:
        tmp_path = tmp.name
    try:
        src = sqlite3.connect(db_path)
        dst = sqlite3.connect(tmp_path)
        src.backup(dst)
        dst.close()
        src.close()

        # Bundle into tar archive in memory
        tar_buf = io.BytesIO()
        with tarfile.open(fileobj=tar_buf, mode="w:gz") as tar:
            tar.add(tmp_path, arcname="loom.sqlite3")
            if req.include_audio:
                audio_dir = journal_audio_dir()
                if audio_dir.exists():
                    for af in audio_dir.iterdir():
                        if af.is_file():
                            tar.add(af, arcname=f"journal_audio/{af.name}")
        archive_bytes = tar_buf.getvalue()

        encrypted = _encrypt_backup(archive_bytes, req.passphrase)
        return Response(
            content=encrypted,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename=loom-backup-{datetime.now().strftime('%Y%m%d%H%M%S')}.loombackup"},
        )
    finally:
        _remove_quiet(tmp_path)


@router.post("/backup/import", response_model=BackupImportResponse)
async def import_backup(passphrase: str = Form(...), file: UploadFile = File(...)):
    content = await file.read()
    try:
        archive_bytes = _decrypt_backup(content, passphrase)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": {"code": "decrypt_failed", "detail": str(e)}})

    tar_buf = io.BytesIO(archive_bytes)
    tmp_path = None
    try:
        with tarfile.open(fileobj=tar_buf, mode="r:gz") as tar:
            db_member = tar.getmember("loom.sqlite3")
            db_bytes_io = tar.extractfile(db_member)
            if db_bytes_io is None:
                raise ValueError("No loom.sqlite3 in archive")
            db_bytes = db_bytes_io.read()

            # Validate SQLite header
            if len(db_bytes) < 16 or db_bytes[:16] != SQLITE_HEADER:
                raise ValueError("Extracted file is not a valid SQLite database")

            # Write to temp + verify
            fd, tmp_path = tempfile.mkstemp(suffix=".sqlite3")
            with os.fdopen(fd, "wb") as tmp:
                tmp.write(db_bytes)

            try:
                test_eng = sqlite3.connect(tmp_path)
                test_eng.execute("SELECT 1")
                test_eng.close()
            except Exception:
                _remove_quiet(tmp_path)
                raise ValueError("Backup database is corrupt")

            # Extract optional audio files (names are sanitised to basename —
            # never trust archive paths).
            audio_members = [m for m in tar.getmembers()
                             if m.name.startswith("journal_audio/") and m.isfile()]
            if audio_members:
                audio_dir = journal_audio_dir()
                audio_dir.mkdir(parents=True, exist_ok=True)
                for m in audio_members:
                    af = tar.extractfile(m)
                    if af:
                        dest = audio_dir / Path(m.name).name
                        dest.write_bytes(af.read())
    except (ValueError, KeyError, tarfile.TarError) as e:
        if tmp_path:
            _remove_quiet(tmp_path)
        raise HTTPException(status_code=400, detail={"error": {"code": "invalid_backup", "detail": str(e)}})

    db_path = _db_path()
    # Pre-restore backup
    pre_bak = db_path + ".pre-restore.bak"
    if os.path.exists(db_path):
        shutil.copy2(db_path, pre_bak)

    try:
        _replace_live_db(tmp_path, db_path)
    except HTTPException:
        _remove_quiet(tmp_path)
        raise
    except Exception as exc:
        # Roll back
        _remove_quiet(tmp_path)
        if os.path.exists(pre_bak):
            try:
                shutil.copy2(pre_bak, db_path)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail={"error": {"code": "restore_failed", "detail": str(exc)}})

    _post_restore_migrate()
    return BackupImportResponse(success=True, message="Database restored. Reload your data.")
