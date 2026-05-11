"""ASGI middleware.

`CrashMiddleware` logs unhandled exceptions and writes a crash snapshot
through `loom_logger`, returning a uniform 500 envelope. Extracted from
main.py in Stage 1 (substep 1A.1).
"""
from __future__ import annotations

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

from loom_logger import get_logger, write_crash_snapshot


class CrashMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        try:
            return await call_next(request)
        except Exception as exc:
            get_logger("crash").critical(
                f"Unhandled {request.method} {request.url.path}",
                exc_info=True,
            )
            write_crash_snapshot(type(exc), exc, exc.__traceback__)
            return JSONResponse(
                status_code=500,
                content={"error": {"code": "internal_error", "detail": "An unexpected error occurred."}},
            )
