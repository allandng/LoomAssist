"""Backup and restore routes.

NOTE: /admin/backup and /admin/restore have no authentication —
designed for local desktop use only. Do not expose these endpoints
over a network without adding auth.
"""
import io
import os
import shutil
import sqlite3
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import create_engine, text

from database.database import engine
from services.crypto.backup import _encrypt_backup, _decrypt_backup

router = APIRouter()

SQLITE_HEADER = b"SQLite format 3\x00"


class BackupExportRequest(BaseModel):
    passphrase: str
    include_audio: bool = False


class BackupImportResponse(BaseModel):
    success: bool
    message: str


class BackupImportRequest(BaseModel):
    passphrase: str


@router.get("/admin/backup")
def backup_database():
    db_path = os.environ.get("LOOM_DB_PATH", "./loom.sqlite3")
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404,
            detail={"error": {"code": "db_not_found", "detail": "Database file not found."}})
    with open(db_path, "rb") as f:
        content = f.read()
    return Response(content=content, media_type="application/octet-stream",
        headers={"Content-Disposition": "attachment; filename=loom-backup.sqlite3"})


@router.post("/admin/restore")
async def restore_database(file: UploadFile = File(...)):
    content = await file.read()
    # Validate SQLite magic bytes
    if len(content) < 16 or content[:16] != SQLITE_HEADER:
        raise HTTPException(status_code=400,
            detail={"error": {"code": "invalid_db_file",
                              "detail": "File is not a valid SQLite database."}})

    # Write to temp and verify it opens
    with tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite3") as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        test_eng = create_engine(f"sqlite:///{tmp_path}")
        with test_eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        test_eng.dispose()
    except Exception:
        os.remove(tmp_path)
        raise HTTPException(status_code=400,
            detail={"error": {"code": "corrupt_db", "detail": "Backup file is corrupt."}})

    # Replace live DB
    db_path = os.environ.get("LOOM_DB_PATH", "./loom.sqlite3")
    engine.dispose()  # Close all pooled connections before replacing the file
    shutil.move(tmp_path, db_path)

    return {"status": "success", "message": "Database restored. Reload your data."}


@router.post("/backup/export")
def export_backup(req: BackupExportRequest):
    db_path = os.environ.get("LOOM_DB_PATH", "./loom.sqlite3")
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


@router.post("/backup/import", response_model=BackupImportResponse)
async def import_backup(passphrase: str = Form(...), file: UploadFile = File(...)):
    content = await file.read()
    try:
        archive_bytes = _decrypt_backup(content, passphrase)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": {"code": "decrypt_failed", "detail": str(e)}})

    tar_buf = io.BytesIO(archive_bytes)
    try:
        with tarfile.open(fileobj=tar_buf, mode="r:gz") as tar:
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
                test_eng = sqlite3.connect(tmp_path)
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
    except (ValueError, KeyError, tarfile.TarError) as e:
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
