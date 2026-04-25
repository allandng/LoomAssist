"""Phase v3.0 — Keychain bridge.

The macOS Keychain lives on the *frontend* side (Tauri keyring crate). The
sync runner runs in the *backend* (Python) process, so it can't directly read
the Keychain. We bridge in two ways, picking whichever is configured first:

  1. **In-memory cache** (default). The frontend pushes the token to
     POST /connections/{id}/token on connection setup; the bridge stores it
     in a process-local dict for the lifetime of the backend. Lost on
     backend restart — the runner falls back to status='auth_expired' at the
     next cycle, which prompts a Reconnect.

  2. **`security` shell-out fallback** (macOS only). If the bridge can't find
     a token in memory, it tries `security find-generic-password` against the
     same com.loomassist service name the Tauri keyring crate writes to.
     This survives a backend restart.

Both paths are async-friendly. The runner never blocks on a missing token —
it logs auth_expired and the user reconnects from Settings → Connections.
"""
from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
from typing import Dict, Optional

logger = logging.getLogger(__name__)

_in_memory: Dict[str, str] = {}


def set_token(connection_id: str, token: str) -> None:
    """Called by the /connections/.../token route."""
    _in_memory[connection_id] = token


def clear_token(connection_id: str) -> None:
    _in_memory.pop(connection_id, None)


async def get_token(connection_id: str) -> Optional[str]:
    """Return the stored token (OAuth refresh_token for Google, JSON
    {username, password} for CalDAV)."""
    if connection_id in _in_memory:
        return _in_memory[connection_id]
    return await _security_find(connection_id)


async def _security_find(connection_id: str) -> Optional[str]:
    """macOS-only fallback. Returns None silently on any other platform."""
    if not shutil.which("security"):
        return None
    slot = f"com.loomassist.connection.{connection_id}"
    try:
        proc = await asyncio.create_subprocess_exec(
            "security", "find-generic-password", "-s", slot, "-w",
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        out, _ = await proc.communicate()
        if proc.returncode == 0 and out:
            return out.decode("utf-8").strip()
    except Exception as e:
        logger.warning(f"keychain_bridge: security shell-out failed: {e}")
    return None
