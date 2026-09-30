import os
import sys
import json
import logging
import logging.handlers
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path

from core.paths import log_dir as _resolve_log_dir

# Resolved once at import. Override with LOOM_LOG_DIR; otherwise:
#   Windows  %LOCALAPPDATA%\LoomAssist\logs
#   macOS    ~/Library/Logs/LoomAssist
#   Linux    ~/.local/state/loomassist
LOG_DIR: Path = _resolve_log_dir()
LOG_FILE: Path = LOG_DIR / "app.log"
CRASH_FLAG: Path = LOG_DIR / ".last_crash"

try:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
except OSError:
    # Last-resort: fall back to a temp dir so import never fails.
    import tempfile
    LOG_DIR = Path(tempfile.gettempdir()) / "LoomAssist" / "logs"
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    LOG_FILE = LOG_DIR / "app.log"
    CRASH_FLAG = LOG_DIR / ".last_crash"


class _JsonFormatter(logging.Formatter):
    def format(self, record):
        # logging.Formatter.format() normally sets record.message before
        # formatMessage() is called; we bypass it, so build the message
        # ourselves (getMessage applies %-args). Without this every record
        # raised "Formatting field not found in record: 'message'".
        try:
            message = record.getMessage()
        except Exception:  # bad %-args — never let logging itself blow up
            message = str(record.msg)
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "level":     record.levelname,
            "logger":    record.name,
            "message":   message,
        }
        if record.exc_info:
            entry["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def _make_handler() -> logging.Handler:
    h = logging.handlers.RotatingFileHandler(
        LOG_FILE, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    h.setFormatter(_JsonFormatter())
    return h


_handler: logging.Handler = _make_handler()
_handler_lock = threading.Lock()
_attached: "set[str]" = set()


def get_logger(name: str) -> logging.Logger:
    lg = logging.getLogger(name)
    lg.setLevel(logging.DEBUG)
    with _handler_lock:
        if _handler not in lg.handlers:
            lg.addHandler(_handler)
        _attached.add(name)
    lg.propagate = False
    return lg


def clear_log_file() -> None:
    """Truncate app.log in place and reopen the rotating handler.

    On Windows an open RotatingFileHandler holds the file with a share mode
    that makes ``unlink`` fail with WinError 32, so instead of deleting we
    close the handler, truncate, and swap in a fresh handler on every logger
    that had the old one attached.
    """
    global _handler
    with _handler_lock:
        old = _handler
        try:
            old.acquire()
            try:
                old.close()
            finally:
                old.release()
        except Exception:
            pass
        try:
            with open(LOG_FILE, "w", encoding="utf-8"):
                pass
        except OSError:
            # File may be momentarily locked by another reader (e.g. tail);
            # the new handler opens in append mode so logging still works.
            pass
        for suffix in range(1, 6):
            rotated = LOG_FILE.with_name(f"{LOG_FILE.name}.{suffix}")
            try:
                rotated.unlink(missing_ok=True)
            except OSError:
                pass
        _handler = _make_handler()
        for name in list(_attached):
            lg = logging.getLogger(name)
            if old in lg.handlers:
                lg.removeHandler(old)
            if _handler not in lg.handlers:
                lg.addHandler(_handler)


def write_crash_snapshot(exc_type, exc_value, tb) -> str:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    crash_file = LOG_DIR / f"crash_{timestamp}.log"
    try:
        last_lines = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)[-200:]
    except Exception:
        last_lines = []
    with crash_file.open("w", encoding="utf-8") as f:
        f.write(f"=== Crash at {timestamp} ===\n\n")
        f.writelines(last_lines)
        f.write("\n=== Exception ===\n")
        f.write("".join(traceback.format_exception(exc_type, exc_value, tb)))
    CRASH_FLAG.write_text(crash_file.name, encoding="utf-8")
    return crash_file.name


def _excepthook(exc_type, exc_value, tb):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, tb)
        return
    get_logger("crash").critical("Unhandled exception", exc_info=(exc_type, exc_value, tb))
    write_crash_snapshot(exc_type, exc_value, tb)
    sys.__excepthook__(exc_type, exc_value, tb)


sys.excepthook = _excepthook
