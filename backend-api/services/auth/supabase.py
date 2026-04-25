"""Supabase Auth REST client (Phase v3.0 identity).

Wraps the Supabase Auth REST API directly with httpx — no SDK, no extra deps.
Pure functions; called by the /auth/* routes in main.py.

Env vars (read at module import; both must be set for cloud auth to work):
- SUPABASE_URL    — e.g. https://abcdefg.supabase.co
- SUPABASE_ANON_KEY

If either is missing, `is_configured()` returns False and the routes fall back
to a 503-with-helpful-message so local-only mode keeps booting.
"""
from __future__ import annotations

import os
from typing import Optional

import httpx

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_REDIRECT = os.environ.get(
    "SUPABASE_REDIRECT_URL",
    "http://localhost:8000/auth/oauth/callback",
)

# OAuth providers Supabase supports under the same redirect.
SUPPORTED_OAUTH_PROVIDERS = {"google", "apple", "microsoft"}


def is_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_ANON_KEY)


def _headers(access_token: Optional[str] = None) -> dict:
    h = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
    }
    if access_token:
        h["Authorization"] = f"Bearer {access_token}"
    return h


def build_oauth_url(provider: str) -> str:
    """Return the authorize URL for `provider` (google · apple · microsoft).

    The user opens this URL in the system browser (via tauri-plugin-opener).
    Supabase handles the provider's OAuth flow and redirects back to
    SUPABASE_REDIRECT with the access token in the URL fragment.
    """
    if provider not in SUPPORTED_OAUTH_PROVIDERS:
        raise ValueError(f"Unsupported OAuth provider: {provider}")
    return (
        f"{SUPABASE_URL}/auth/v1/authorize"
        f"?provider={provider}&redirect_to={SUPABASE_REDIRECT}"
    )


async def email_signup(email: str, password: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as cli:
        r = await cli.post(
            f"{SUPABASE_URL}/auth/v1/signup",
            headers=_headers(),
            json={"email": email, "password": password},
        )
        r.raise_for_status()
        return r.json()


async def email_login(email: str, password: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as cli:
        r = await cli.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers=_headers(),
            json={"email": email, "password": password},
        )
        r.raise_for_status()
        return r.json()


async def email_reset(email: str) -> None:
    async with httpx.AsyncClient(timeout=15) as cli:
        r = await cli.post(
            f"{SUPABASE_URL}/auth/v1/recover",
            headers=_headers(),
            json={"email": email},
        )
        r.raise_for_status()


async def get_user(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as cli:
        r = await cli.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers=_headers(access_token),
        )
        r.raise_for_status()
        return r.json()


async def refresh(refresh_token: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as cli:
        r = await cli.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token",
            headers=_headers(),
            json={"refresh_token": refresh_token},
        )
        r.raise_for_status()
        return r.json()


async def logout(access_token: str) -> None:
    """Best-effort revocation — failures are swallowed; the local Account row
    and Keychain slot are cleared regardless by the caller."""
    try:
        async with httpx.AsyncClient(timeout=10) as cli:
            await cli.post(
                f"{SUPABASE_URL}/auth/v1/logout",
                headers=_headers(access_token),
            )
    except Exception:
        pass
