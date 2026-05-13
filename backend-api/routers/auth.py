"""Cloud-identity routes (Supabase Auth, identity-only).

Hard rails (per LoomAssist_UIUX_Guardrail.md §6 + design doc §1):
  - Identity = email + display name + provider IDs. Nothing else.
  - Calendar/event data NEVER traverses a LoomAssist server.
  - Tokens live in macOS Keychain (frontend); never SQLite, never Account row.
  - Local mode is a first-class state — Account row absent ⇒ 204 from /auth/me.
"""
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models
from services.auth import supabase as supabase_auth

router = APIRouter(prefix="/auth")


class OAuthStartResponse(BaseModel):
    auth_url: str


class EmailSignupRequest(BaseModel):
    email: str
    password: str


class EmailLoginRequest(BaseModel):
    email: str
    password: str
    access_token: Optional[str] = None  # if frontend already exchanged via Supabase
    refresh_token: Optional[str] = None


class EmailResetRequest(BaseModel):
    email: str


class OAuthCompleteRequest(BaseModel):
    """Frontend posts this after the system browser returns the user with the
    Supabase access_token in the URL fragment. The frontend reads the fragment,
    forwards it here so the backend can fetch the user profile and upsert
    the Account row. The token itself is then stashed in the Keychain by the
    frontend via the `keychain_set` Tauri command."""
    access_token: str
    refresh_token: Optional[str] = None
    provider: str = "google"


class AccountRead(BaseModel):
    id: str
    supabase_user_id: str
    email: str
    display_name: Optional[str]
    auth_provider: str
    created_at: str
    last_login_at: Optional[str]


class AccountUpdate(BaseModel):
    display_name: Optional[str] = None


def _account_to_dict(a: models.Account) -> dict:
    return {
        "id": a.id,
        "supabase_user_id": a.supabase_user_id,
        "email": a.email,
        "display_name": a.display_name,
        "auth_provider": a.auth_provider,
        "created_at": a.created_at,
        "last_login_at": a.last_login_at,
    }


def _upsert_account(db: Session, *, supabase_user_id: str, email: str,
                    display_name: Optional[str], auth_provider: str) -> models.Account:
    now = datetime.utcnow().isoformat()
    existing = db.query(models.Account).filter(models.Account.id == "me").first()
    if existing:
        existing.supabase_user_id = supabase_user_id
        existing.email = email
        if display_name and not existing.display_name:
            existing.display_name = display_name
        existing.auth_provider = auth_provider
        existing.last_login_at = now
        db.commit()
        db.refresh(existing)
        return existing
    acc = models.Account(
        id="me",
        supabase_user_id=supabase_user_id,
        email=email,
        display_name=display_name or (email.split("@")[0] if email else None),
        auth_provider=auth_provider,
        created_at=now,
        last_login_at=now,
    )
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return acc


def _require_supabase():
    if not supabase_auth.is_configured():
        raise HTTPException(
            status_code=503,
            detail={
                "error": {
                    "code": "supabase_not_configured",
                    "detail": (
                        "Cloud auth is not configured on this device. Set "
                        "SUPABASE_URL and SUPABASE_ANON_KEY env vars to enable."
                    ),
                }
            },
        )


@router.post("/oauth/{provider}/start", response_model=OAuthStartResponse)
def auth_oauth_start(provider: str):
    _require_supabase()
    if provider not in supabase_auth.SUPPORTED_OAUTH_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "unsupported_provider", "detail": provider}},
        )
    return {"auth_url": supabase_auth.build_oauth_url(provider)}


@router.post("/oauth/complete", response_model=AccountRead)
async def auth_oauth_complete(payload: OAuthCompleteRequest, db: Session = Depends(get_db)):
    """Frontend calls this after extracting the Supabase access_token from the
    OAuth redirect's URL fragment. Validates with Supabase, upserts Account."""
    _require_supabase()
    try:
        user = await supabase_auth.get_user(payload.access_token)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=401,
            detail={"error": {"code": "invalid_token", "detail": str(e)}},
        )
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail={"error": {"code": "supabase_unreachable", "detail": str(e)}},
        )

    sub = user.get("id") or user.get("sub")
    email = user.get("email") or ""
    metadata = user.get("user_metadata") or {}
    name = metadata.get("full_name") or metadata.get("name")
    if not sub or not email:
        raise HTTPException(
            status_code=502,
            detail={"error": {"code": "incomplete_user", "detail": "Supabase returned no id/email"}},
        )

    acc = _upsert_account(
        db,
        supabase_user_id=sub,
        email=email,
        display_name=name,
        auth_provider=payload.provider,
    )
    return _account_to_dict(acc)


@router.post("/email/signup", response_model=AccountRead)
async def auth_email_signup(payload: EmailSignupRequest, db: Session = Depends(get_db)):
    _require_supabase()
    try:
        result = await supabase_auth.email_signup(payload.email, payload.password)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail={"error": {"code": "signup_failed", "detail": e.response.text}},
        )
    user = result.get("user") or {}
    sub = user.get("id")
    if not sub:
        # Email-confirmation flow — Supabase returns no user until the link is clicked.
        raise HTTPException(
            status_code=202,
            detail={"error": {"code": "confirmation_required",
                              "detail": "Check your email to confirm before logging in."}},
        )
    acc = _upsert_account(
        db,
        supabase_user_id=sub,
        email=user.get("email") or payload.email,
        display_name=None,
        auth_provider="email",
    )
    return _account_to_dict(acc)


@router.post("/email/login", response_model=AccountRead)
async def auth_email_login(payload: EmailLoginRequest, db: Session = Depends(get_db)):
    _require_supabase()
    try:
        result = await supabase_auth.email_login(payload.email, payload.password)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=401,
            detail={"error": {"code": "login_failed", "detail": e.response.text}},
        )
    user = result.get("user") or {}
    sub = user.get("id")
    email = user.get("email") or payload.email
    if not sub:
        raise HTTPException(
            status_code=502,
            detail={"error": {"code": "incomplete_user", "detail": "Supabase returned no user"}},
        )
    acc = _upsert_account(
        db,
        supabase_user_id=sub,
        email=email,
        display_name=None,
        auth_provider="email",
    )
    return _account_to_dict(acc)


@router.post("/email/reset")
async def auth_email_reset(payload: EmailResetRequest):
    _require_supabase()
    try:
        await supabase_auth.email_reset(payload.email)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail={"error": {"code": "reset_failed", "detail": e.response.text}},
        )
    return {"ok": True}


@router.get("/me")
def auth_me(db: Session = Depends(get_db)):
    """Returns the current Account, or 204 in local-only mode.

    AccountContext on the frontend reads this on boot — 204 means "local mode",
    not an error.
    """
    acc = db.query(models.Account).filter(models.Account.id == "me").first()
    if not acc:
        return Response(status_code=204)
    return _account_to_dict(acc)


@router.patch("/me", response_model=AccountRead)
def auth_update_me(payload: AccountUpdate, db: Session = Depends(get_db)):
    acc = db.query(models.Account).filter(models.Account.id == "me").first()
    if not acc:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "no_account", "detail": "Local mode — sign in first"}},
        )
    if payload.display_name is not None:
        acc.display_name = payload.display_name.strip() or None
    db.commit()
    db.refresh(acc)
    return _account_to_dict(acc)


@router.post("/logout")
def auth_logout(db: Session = Depends(get_db)):
    """Clears the Account row. The frontend is responsible for clearing the
    Keychain `supabase` slot via the `keychain_delete` Tauri command before
    calling this. Per design doc §11 R5 + §10 Q7, sign-out is non-destructive:
    Connections + Events are untouched."""
    acc = db.query(models.Account).filter(models.Account.id == "me").first()
    if acc:
        db.delete(acc)
        db.commit()
    return {"ok": True}
