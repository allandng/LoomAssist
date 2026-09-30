"""Phase v3.0 — Keychain bridge (cross-platform).

OAuth refresh tokens (Google) and CalDAV credentials (JSON ``{username,
password}``) are written by the Tauri shell through the ``keyring`` Rust
crate under service ``com.loomassist`` / account ``connection.{id}``. The
sync runner lives in this Python process, so it needs to read the same
secret store. Three tiers, consulted in order:

  1. **In-memory cache** — populated by POST /connections/{id}/token and by
     the connection-create routes. Fastest; lost on backend restart.

  2. **OS credential store** via the ``keyring`` Python package — Windows
     Credential Locker, macOS Keychain, Linux Secret Service. Uses the exact
     same service/account pair as the Rust side so either process can read
     what the other wrote. Survives backend restarts.

  3. **Encrypted file fallback** — if ``keyring`` is unavailable or raises
     (headless Linux without a Secret Service, locked keychain, ...), tokens
     are AES-256-GCM encrypted with a per-install random key and stored
     under the per-user secrets dir (see core.paths.secrets_dir). This is
     weaker than the OS store but still keeps secrets off the SQLite DB and
     out of the repo checkout.

``set_token`` writes to all tiers it can; ``get_token`` reads through them.
Secrets are never logged.
"""
from __future__ import annotations

import asyncio
import logging
import os
import secrets as _secrets
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# Must match src-tauri/src/lib.rs: KEYCHAIN_SERVICE / slot format.
KEYCHAIN_SERVICE = "com.loomassist"


def slot_for(connection_id: str) -> str:
    """Keychain account name for a connection — identical to the Tauri side's
    ``KeychainSlots.connection(uuid)``."""
    return f"connection.{connection_id}"


_in_memory: Dict[str, str] = {}


# ── Tier 2: OS keyring ───────────────────────────────────────────────────────

def _keyring():
    """Import lazily so the backend boots even when keyring is absent."""
    try:
        import keyring  # type: ignore
        return keyring
    except Exception:
        return None


def _keyring_get(slot: str) -> Optional[str]:
    kr = _keyring()
    if kr is None:
        return None
    try:
        return kr.get_password(KEYCHAIN_SERVICE, slot)
    except Exception as e:  # keyring.errors.KeyringError and backend-specific ones
        logger.warning("keychain_bridge: keyring read failed (%s)", type(e).__name__)
        return None


def _keyring_set(slot: str, value: str) -> bool:
    kr = _keyring()
    if kr is None:
        return False
    try:
        kr.set_password(KEYCHAIN_SERVICE, slot, value)
        return True
    except Exception as e:
        logger.warning("keychain_bridge: keyring write failed (%s)", type(e).__name__)
        return False


def _keyring_delete(slot: str) -> None:
    kr = _keyring()
    if kr is None:
        return
    try:
        kr.delete_password(KEYCHAIN_SERVICE, slot)
    except Exception:
        pass


# ── Tier 3: encrypted file fallback ─────────────────────────────────────────

def _secrets_dir() -> Path:
    from core.paths import secrets_dir
    return secrets_dir()


def _fallback_key() -> bytes:
    """Per-install 32-byte key, generated once and stored with 0600 perms.
    Windows has no POSIX modes; the per-user %LOCALAPPDATA% ACL applies."""
    d = _secrets_dir()
    d.mkdir(parents=True, exist_ok=True)
    key_file = d / "fallback.key"
    if key_file.exists():
        data = key_file.read_bytes()
        if len(data) == 32:
            return data
    key = _secrets.token_bytes(32)
    key_file.write_bytes(key)
    try:
        os.chmod(key_file, 0o600)
    except OSError:
        pass
    return key


def _fallback_path(slot: str) -> Path:
    # Slot names are "connection.<uuid>" / "supabase": filesystem-safe already,
    # but sanitize defensively.
    safe = "".join(ch if (ch.isalnum() or ch in "._-") else "_" for ch in slot)
    return _secrets_dir() / f"{safe}.bin"


def _fallback_set(slot: str, value: str) -> bool:
    try:
        from services.crypto.vault import encrypt_record
        key = _fallback_key()
        ciphertext, nonce = encrypt_record(value.encode("utf-8"), key)
        path = _fallback_path(slot)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(nonce + ciphertext)
        os.replace(tmp, path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        return True
    except Exception as e:
        logger.warning("keychain_bridge: fallback write failed (%s)", type(e).__name__)
        return False


def _fallback_get(slot: str) -> Optional[str]:
    path = _fallback_path(slot)
    if not path.exists():
        return None
    try:
        from services.crypto.vault import decrypt_record, NONCE_LENGTH
        blob = path.read_bytes()
        nonce, ciphertext = blob[:NONCE_LENGTH], blob[NONCE_LENGTH:]
        return decrypt_record(ciphertext, nonce, _fallback_key()).decode("utf-8")
    except Exception as e:
        logger.warning("keychain_bridge: fallback read failed (%s)", type(e).__name__)
        return None


def _fallback_delete(slot: str) -> None:
    try:
        _fallback_path(slot).unlink(missing_ok=True)
    except OSError:
        pass


# ── Public API ───────────────────────────────────────────────────────────────

def set_token(connection_id: str, token: str) -> None:
    """Called by the /connections/.../token route and the create routes.
    Caches in memory and persists to the OS keyring (or the encrypted file
    fallback when the keyring is unavailable)."""
    _in_memory[connection_id] = token
    slot = slot_for(connection_id)
    if not _keyring_set(slot, token):
        _fallback_set(slot, token)


def clear_token(connection_id: str) -> None:
    _in_memory.pop(connection_id, None)
    slot = slot_for(connection_id)
    _keyring_delete(slot)
    _fallback_delete(slot)


def get_token_sync(connection_id: str) -> Optional[str]:
    """Synchronous read-through: memory -> OS keyring -> encrypted file."""
    if connection_id in _in_memory:
        return _in_memory[connection_id]
    slot = slot_for(connection_id)
    value = _keyring_get(slot)
    if value is None:
        value = _fallback_get(slot)
    if value is not None:
        _in_memory[connection_id] = value
    return value


async def get_token(connection_id: str) -> Optional[str]:
    """Return the stored token (OAuth refresh_token for Google, JSON
    {username, password} for CalDAV). Keyring backends can block (DBus,
    Credential Manager), so the lookup runs off the event loop."""
    if connection_id in _in_memory:
        return _in_memory[connection_id]
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, get_token_sync, connection_id)


# ── Generic slots (not tied to a connection id) ─────────────────────────────

_SLOT_PREFIX = "__slot__"


def set_secret(slot: str, value: str) -> None:
    """Store an arbitrary slot (e.g. ``supabase`` session JSON) under the
    shared service name so the Tauri side can read it too."""
    _in_memory[_SLOT_PREFIX + slot] = value
    if not _keyring_set(slot, value):
        _fallback_set(slot, value)


def get_secret(slot: str) -> Optional[str]:
    cached = _in_memory.get(_SLOT_PREFIX + slot)
    if cached is not None:
        return cached
    value = _keyring_get(slot)
    if value is None:
        value = _fallback_get(slot)
    if value is not None:
        _in_memory[_SLOT_PREFIX + slot] = value
    return value


def clear_secret(slot: str) -> None:
    _in_memory.pop(_SLOT_PREFIX + slot, None)
    _keyring_delete(slot)
    _fallback_delete(slot)
