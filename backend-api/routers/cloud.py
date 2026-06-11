"""AWS cloud sync routes (v3.0 Stage 2) — distinct from /sync/* (v2.2 provider
sync) and /auth/* (Supabase identity, untouched per the v0 coexistence
decision).

The one password does double duty (roadmap §4): Cognito SRP-authenticates with
it, and locally scrypt derives the KEK from it. Unlock = authenticate + derive
+ unwrap DEK into process memory. Lock or restart drops the keys.
"""

import base64
import uuid

from cryptography.exceptions import InvalidTag
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from botocore.exceptions import ClientError
from pycognito import Cognito

from core.deps import get_db
from database import models
from services.crypto import vault
from services.cloudsync import session as cloud_session
from services.cloudsync.aws_client import CloudApiClient, CloudApiError
from services.cloudsync.engine import run_sync

router = APIRouter(prefix="/cloud")

_b64 = lambda b: base64.b64encode(b).decode()
_unb64 = base64.b64decode

KDF_PARAMS = {"kdf": "scrypt", "n": 2**17, "r": 8, "p": 1}


class Credentials(BaseModel):
    email: str
    password: str


class ConfirmBody(BaseModel):
    email: str
    code: str


def _cognito(email: str | None = None) -> Cognito:
    return Cognito(
        cloud_session.USER_POOL_ID, cloud_session.CLIENT_ID, username=email
    )


def _device_id(db: Session) -> str:
    cfg = db.query(models.DeviceConfig).first()
    if cfg is None:
        cfg = models.DeviceConfig(device_id=str(uuid.uuid4()))
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return f"mac_{cfg.device_id[:8]}"


@router.post("/signup")
def signup(body: Credentials):
    cog = _cognito(body.email)
    cog.set_base_attributes(email=body.email)
    try:
        cog.register(body.email, body.password)
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code == "UsernameExistsException":
            raise HTTPException(409, "An account with this email already exists")
        if code == "InvalidPasswordException":
            raise HTTPException(400, e.response["Error"]["Message"])
        raise HTTPException(502, f"Cognito error: {code}")
    return {"status": "confirmation_sent", "email": body.email}


@router.post("/confirm")
def confirm(body: ConfirmBody):
    try:
        _cognito(body.email).confirm_sign_up(body.code, username=body.email)
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("CodeMismatchException", "ExpiredCodeException"):
            raise HTTPException(400, "Invalid or expired confirmation code")
        raise HTTPException(502, f"Cognito error: {code}")
    return {"status": "confirmed"}


@router.post("/unlock")
def unlock(body: Credentials, db: Session = Depends(get_db)):
    """SRP sign-in + vault init-or-unwrap. Keys land in memory only."""
    cog = _cognito(body.email)
    try:
        cog.authenticate(password=body.password)
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code == "NotAuthorizedException":
            raise HTTPException(401, "Wrong email or password")
        if code == "UserNotConfirmedException":
            raise HTTPException(403, "Account not confirmed — check your email")
        raise HTTPException(502, f"Cognito error: {code}")

    client = CloudApiClient(
        cloud_session.API_BASE,
        lambda: (cog.check_token(), cog.id_token)[1],
    )
    device = _device_id(db)
    info = client.vault_info()
    vault_created = False
    if info is None:
        salt = vault.generate_salt()
        kek = vault.derive_kek(body.password, salt)
        dek = vault.generate_dek()
        wrapped, wrap_nonce = vault.wrap_dek(dek, kek)
        client.vault_init(
            wrapped_dek=_b64(wrap_nonce + wrapped),  # nonce||ciphertext envelope
            salt=_b64(salt),
            kdf_params=KDF_PARAMS,
            device_id=device,
        )
        vault_created = True
    else:
        kek = vault.derive_kek(body.password, _unb64(info["salt"]))
        blob = _unb64(info["wrapped_dek"])
        try:
            dek = vault.unwrap_dek(blob[12:], blob[:12], kek)
        except InvalidTag:
            # Cognito accepted the password but it can't unwrap the DEK —
            # the Cognito password was changed without /vault/rotate-password.
            raise HTTPException(
                409, "Password can't unlock the vault — was it changed elsewhere?"
            )

    sess = cloud_session.current
    sess.cognito = cog
    sess.dek = dek
    sess.email = body.email
    sess.user_sub = cog.id_claims.get("sub")

    config = db.get(models.CloudSyncConfig, "me")
    if config is None:
        config = models.CloudSyncConfig(id="me")
        db.add(config)
    config.email = body.email
    config.user_sub = sess.user_sub
    db.commit()

    return {"status": "unlocked", "vault_created": vault_created, "device_id": device}


@router.post("/lock")
def lock():
    cloud_session.current.lock()
    return {"status": "locked"}


@router.get("/status")
def status(db: Session = Depends(get_db)):
    config = db.get(models.CloudSyncConfig, "me")
    return {
        "unlocked": cloud_session.current.unlocked,
        "email": cloud_session.current.email or (config.email if config else None),
        "last_synced_at": config.last_synced_at if config else None,
    }


@router.post("/sync/run")
def sync_run(db: Session = Depends(get_db)):
    sess = cloud_session.current
    if not sess.unlocked:
        raise HTTPException(503, "Cloud sync is locked — unlock with your password first")
    client = CloudApiClient(cloud_session.API_BASE, sess.id_token)
    try:
        return run_sync(db, client, sess.dek, _device_id(db))
    except CloudApiError as e:
        raise HTTPException(502, str(e))
