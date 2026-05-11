"""LAN pairing: device UUID + ephemeral pair-code store.

`_pairing_codes` is a module-level dict so codes survive across HTTP requests
within a single uvicorn process (each entry holds a 5-minute TTL). Tests
mutate it via `main._pairing_codes` — that rebind points to this module's
dict, so direct mutation continues to work.

Extracted from main.py in Stage 1 (substep 1A.5). No LLM dependency.
"""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from database import models


# In-memory pairing code store: { code: { fingerprint, host, port, expires } }
_pairing_codes: dict = {}


def _get_or_create_device_id(db: Session) -> str:
    row = db.query(models.DeviceConfig).first()
    if row:
        return row.device_id
    new_id = str(uuid.uuid4())
    row = models.DeviceConfig(device_id=new_id)
    db.add(row)
    db.commit()
    return new_id
