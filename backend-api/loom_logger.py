import sys
import json
import logging
import logging.handlers
import traceback
from datetime import datetime
from pathlib import Path

LOG_DIR   = Path.home() / "Library" / "Logs" / "LoomAssist"
LOG_FILE  = LOG_DIR / "app.log"
CRASH_FLAG = LOG_DIR / ".last_crash"

LOG_DIR.mkdir(parents=True, exist_ok=True)


class _JsonFormatter(logging.Formatter):
    def format(self, record):
        entry = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "level":     record.levelname,
            "logger":    record.name,
            "message":   self.formatMessage(record),
        }
        if record.exc_info:
            entry["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(entry)


_handler = logging.handlers.RotatingFileHandler(
    LOG_FILE, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
)
_handler.setFormatter(_JsonFormatter())


def get_logger(name: str) -> logging.Logger:
    lg = logging.getLogger(name)
    lg.setLevel(logging.DEBUG)
    if not lg.handlers:
        lg.addHandler(_handler)
    lg.propagate = False
    return lg


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
    CRASH_FLAG.write_text(crash_file.name)
    return crash_file.name


def _excepthook(exc_type, exc_value, tb):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, tb)
        return
    get_logger("crash").critical("Unhandled exception", exc_info=(exc_type, exc_value, tb))
    write_crash_snapshot(exc_type, exc_value, tb)
    sys.__excepthook__(exc_type, exc_value, tb)


sys.excepthook = _excepthook
