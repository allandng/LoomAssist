"""Cross-platform filesystem anchors for the backend.

Every on-disk artifact the backend owns (SQLite DB, journal audio, LAN TLS
certs, logs) resolves through this module so that nothing depends on the
process' current working directory. Defaults keep files next to the code
(``backend-api/``) exactly where earlier releases put them, so existing
installs keep working; packaged builds override via environment variables.

Environment overrides (all optional):
    LOOM_DATA_DIR           base directory for DB / audio / certs
    LOOM_DB_PATH            full path of the SQLite file
    LOOM_JOURNAL_AUDIO_DIR  directory for saved journal recordings
    LOOM_CERTS_DIR          directory for the LAN-pairing self-signed cert
    LOOM_LOG_DIR            directory for app.log / crash snapshots
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND_DIR: Path = Path(__file__).resolve().parent.parent
APP_NAME = "LoomAssist"


def _env_path(name: str) -> Path | None:
    raw = os.environ.get(name, "").strip()
    return Path(raw).expanduser().resolve() if raw else None


def app_data_dir() -> Path:
    """Base directory for persistent data (DB, audio, certs)."""
    return _env_path("LOOM_DATA_DIR") or BACKEND_DIR


def db_path() -> Path:
    return _env_path("LOOM_DB_PATH") or (app_data_dir() / "loom.sqlite3")


def journal_audio_dir() -> Path:
    return _env_path("LOOM_JOURNAL_AUDIO_DIR") or (app_data_dir() / "journal_audio")


def certs_dir() -> Path:
    return _env_path("LOOM_CERTS_DIR") or (app_data_dir() / "certs")


def platform_log_dir() -> Path:
    r"""OS-conventional log location.

    Windows: %LOCALAPPDATA%\LoomAssist\logs
    macOS:   ~/Library/Logs/LoomAssist
    Linux:   $XDG_STATE_HOME/loomassist  (default ~/.local/state/loomassist)
    """
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / APP_NAME / "logs"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Logs" / APP_NAME
    xdg = os.environ.get("XDG_STATE_HOME")
    base = Path(xdg) if xdg else Path.home() / ".local" / "state"
    return base / APP_NAME.lower()


def log_dir() -> Path:
    return _env_path("LOOM_LOG_DIR") or platform_log_dir()


def secrets_dir() -> Path:
    """Directory for the encrypted keyring fallback file (see
    services/sync/keychain_bridge.py). Lives beside the logs so it is
    per-user and outside the repo checkout."""
    override = _env_path("LOOM_SECRETS_DIR")
    if override:
        return override
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / APP_NAME / "secrets"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME / "secrets"
    xdg = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg) if xdg else Path.home() / ".local" / "share"
    return base / APP_NAME.lower() / "secrets"
