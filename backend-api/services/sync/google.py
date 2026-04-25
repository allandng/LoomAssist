"""Phase v3.0 — Google Calendar REST client.

Direct httpx calls (no google-api-python-client SDK — keeps deps small).
Per design doc §4: pure functions; the runner calls these.

Caller is responsible for:
  - Stashing the OAuth refresh_token in the macOS Keychain before the first
    incremental_pull (the runner pulls it via Tauri command, not from here).
  - Handling 401 → connection.status='auth_expired' (the runner catches the
    httpx.HTTPStatusError raised here).

Environment vars:
  - GOOGLE_OAUTH_CLIENT_ID
  - GOOGLE_OAUTH_CLIENT_SECRET
"""
from __future__ import annotations

import os
from typing import Optional

import httpx

GOOGLE_OAUTH_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_OAUTH_TOKEN     = "https://oauth2.googleapis.com/token"
GOOGLE_API_BASE        = "https://www.googleapis.com/calendar/v3"

GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar"

GOOGLE_CLIENT_ID     = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
GOOGLE_REDIRECT      = os.environ.get(
    "GOOGLE_OAUTH_REDIRECT",
    "http://localhost:8000/connections/google/callback",
)


def is_configured() -> bool:
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)


def build_authorize_url(state: str) -> str:
    from urllib.parse import urlencode
    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  GOOGLE_REDIRECT,
        "response_type": "code",
        "scope":         GOOGLE_SCOPES,
        "access_type":   "offline",
        "prompt":        "consent",  # ensure refresh_token comes back even on re-auth
        "state":         state,
    }
    return f"{GOOGLE_OAUTH_AUTHORIZE}?{urlencode(params)}"


async def exchange_code(code: str) -> dict:
    """Exchange an authorization code for a token bundle.

    Returns: {access_token, refresh_token, expires_in, token_type, scope}
    """
    async with httpx.AsyncClient(timeout=20) as cli:
        r = await cli.post(GOOGLE_OAUTH_TOKEN, data={
            "code":          code,
            "client_id":     GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri":  GOOGLE_REDIRECT,
            "grant_type":    "authorization_code",
        })
        r.raise_for_status()
        return r.json()


async def refresh_access_token(refresh_token: str) -> dict:
    """Returns: {access_token, expires_in, token_type, scope}"""
    async with httpx.AsyncClient(timeout=20) as cli:
        r = await cli.post(GOOGLE_OAUTH_TOKEN, data={
            "client_id":     GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type":    "refresh_token",
        })
        r.raise_for_status()
        return r.json()


async def fetch_userinfo(access_token: str) -> dict:
    """Returns the user's profile (we want email + name for display_name)."""
    async with httpx.AsyncClient(timeout=15) as cli:
        r = await cli.get("https://www.googleapis.com/oauth2/v2/userinfo",
                           headers={"Authorization": f"Bearer {access_token}"})
        r.raise_for_status()
        return r.json()


async def list_calendars(access_token: str) -> list[dict]:
    """List all calendars the user has access to. Returns a list of:
       {id, summary, description?, backgroundColor?, primary?, accessRole}
    """
    async with httpx.AsyncClient(timeout=20) as cli:
        r = await cli.get(f"{GOOGLE_API_BASE}/users/me/calendarList",
                           headers={"Authorization": f"Bearer {access_token}"})
        r.raise_for_status()
        return r.json().get("items", [])


async def incremental_pull(
    access_token: str,
    calendar_id: str,
    sync_token: Optional[str] = None,
    *,
    page_token: Optional[str] = None,
) -> dict:
    """Pull events using Google's incremental sync token.

    Returns: {events, next_sync_token, next_page_token}
    Caller paginates using next_page_token; sync_token comes back only on the
    last page of a clean sync. If the saved sync_token is invalidated by Google
    (410 GONE), the runner clears it and retries with no sync_token.

    `page_token` and `sync_token` are mutually exclusive per Google's API:
    when paginating an initial pull, send only page_token. When picking up
    a subsequent cycle, send only sync_token.
    """
    headers = {"Authorization": f"Bearer {access_token}"}
    params: dict = {"maxResults": 250, "showDeleted": "true"}
    if page_token:
        params["pageToken"] = page_token
    elif sync_token:
        params["syncToken"] = sync_token

    async with httpx.AsyncClient(timeout=30) as cli:
        r = await cli.get(f"{GOOGLE_API_BASE}/calendars/{calendar_id}/events",
                           headers=headers, params=params)
        r.raise_for_status()
        data = r.json()
        return {
            "events":          data.get("items", []),
            "next_sync_token": data.get("nextSyncToken"),
            "next_page_token": data.get("nextPageToken"),
        }


async def push_event(
    access_token: str,
    calendar_id: str,
    payload: dict,
    *,
    external_id: Optional[str] = None,
    if_match: Optional[str] = None,
) -> dict:
    """Insert (no external_id) or patch (with external_id) an event.

    `payload` is in Google's event shape. Use normalize_to_google() to convert
    a LoomAssist event dict.

    On 412 PRECONDITION_FAILED the runner must enqueue a bidirectional_conflict
    SyncReviewItem rather than retrying.
    """
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    if if_match:
        headers["If-Match"] = if_match

    async with httpx.AsyncClient(timeout=30) as cli:
        if external_id:
            r = await cli.patch(
                f"{GOOGLE_API_BASE}/calendars/{calendar_id}/events/{external_id}",
                headers=headers, json=payload,
            )
        else:
            r = await cli.post(
                f"{GOOGLE_API_BASE}/calendars/{calendar_id}/events",
                headers=headers, json=payload,
            )
        r.raise_for_status()
        return r.json()


async def delete_event(access_token: str, calendar_id: str, external_id: str) -> None:
    async with httpx.AsyncClient(timeout=20) as cli:
        r = await cli.delete(
            f"{GOOGLE_API_BASE}/calendars/{calendar_id}/events/{external_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if r.status_code not in (200, 204, 404, 410):
            r.raise_for_status()


# ── Format conversion ───────────────────────────────────────────────────────

def google_event_to_dict(g: dict) -> dict:
    """Normalize a Google event JSON to the LoomAssist event shape used by
    the dedup engine and the SyncReviewItem incoming_payload column."""
    if g.get("status") == "cancelled":
        return {
            "title":       "(deleted)",
            "external_id": g.get("id"),
            "deleted":     True,
        }
    start = g.get("start", {})
    end   = g.get("end", {})
    is_all_day = "date" in start and "dateTime" not in start
    start_iso = start.get("dateTime") or _date_to_iso(start.get("date")) or ""
    end_iso   = end.get("dateTime")   or _date_to_iso(end.get("date"))   or start_iso
    return {
        "title":         g.get("summary") or "(Untitled)",
        "start_time":    _strip_tz(start_iso),
        "end_time":      _strip_tz(end_iso),
        "is_all_day":    is_all_day,
        "description":   g.get("description"),
        "location":      g.get("location"),
        "external_id":   g.get("id"),
        "external_etag": g.get("etag"),
        "external_uid":  g.get("iCalUID"),
    }


def normalize_to_google(event: dict) -> dict:
    """Convert a LoomAssist event dict to Google's event shape for push."""
    out: dict = {
        "summary": event.get("title", "(Untitled)"),
    }
    if event.get("description"):
        out["description"] = event["description"]
    if event.get("location"):
        out["location"] = event["location"]

    if event.get("is_all_day"):
        out["start"] = {"date": event["start_time"][:10]}
        out["end"]   = {"date": event["end_time"][:10]}
    else:
        out["start"] = {"dateTime": event["start_time"]}
        out["end"]   = {"dateTime": event["end_time"]}
    return out


def _date_to_iso(d: Optional[str]) -> Optional[str]:
    if not d:
        return None
    return f"{d}T00:00:00"


def _strip_tz(iso: str) -> str:
    if not iso:
        return iso
    # Drop trailing Z / +00:00 to keep parity with naive datetimes elsewhere.
    s = iso.rstrip("Z")
    if "+" in s[10:]:
        s = s[: 10 + s[10:].index("+")]
    if "-" in s[10:]:
        s = s[: 10 + s[10:].index("-")]
    return s
