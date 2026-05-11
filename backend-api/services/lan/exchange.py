"""LAN auto-sync loop.

Polls every 5 minutes (after a 30s startup delay) and triggers /sync/exchange
+ /sync/apply against each paired peer's local endpoint. Started by main.py's
lifespan and cancelled in its finally block.

Extracted from main.py in Stage 1 (substep 1A.5). No LLM dependency.
"""
from __future__ import annotations

import asyncio
from datetime import datetime

import httpx

from database.database import SessionLocal
from database import models


async def _auto_sync_loop():
    await asyncio.sleep(30)  # brief startup delay
    while True:
        try:
            db = SessionLocal()
            peers = db.query(models.Peer).all()
            now = datetime.utcnow().isoformat()
            for peer in peers:
                last = peer.last_seen or "1970-01-01T00:00:00"
                try:
                    async with httpx.AsyncClient(timeout=8) as cli:
                        resp = await cli.post(
                            "http://localhost:8000/sync/exchange",
                            json={"since": last},
                        )
                        if resp.status_code == 200:
                            await cli.post("http://localhost:8000/sync/apply", json=resp.json())
                    peer.last_seen = now
                    db.commit()
                except Exception:
                    pass
            db.close()
        except Exception:
            pass
        await asyncio.sleep(300)  # 5 minutes
