"""Cross-cutting FastAPI dependencies.

Extracted from main.py in Stage 1 (substep 1A.1). Anything that needs a DB
session via Depends() or wants to rate-limit a per-IP request stream pulls
from here.
"""
from __future__ import annotations

import time as _time
from collections import defaultdict

from database.database import SessionLocal


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


_log_rate: dict[str, tuple[int, float]] = defaultdict(lambda: (0, 0.0))


def _check_rate(ip: str, limit: int = 100, window: float = 60.0) -> bool:
    count, start = _log_rate[ip]
    now = _time.monotonic()
    if now - start > window:
        _log_rate[ip] = (1, now)
        return True
    if count >= limit:
        return False
    _log_rate[ip] = (count + 1, start)
    return True
