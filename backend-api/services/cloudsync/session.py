"""In-memory cloud session — Cognito tokens + vault keys.

The KEK is derived from the password and the DEK unwrapped at /cloud/unlock;
both exist ONLY in this process's memory, never in SQLite or on disk (roadmap
§4 key model). A backend restart therefore always requires re-unlocking with
the password — that is correct E2E behavior, not a bug: the password is the
only source of the KEK.

Pool/API coordinates are deploy-time constants (CDK stack outputs), not
secrets; env vars override for a future second environment.
"""

import os
from typing import Optional

API_BASE = os.environ.get(
    "LOOM_CLOUD_API_URL", "https://03ouv0xgzb.execute-api.us-east-1.amazonaws.com"
)
USER_POOL_ID = os.environ.get("LOOM_COGNITO_POOL_ID", "us-east-1_aZaXEizfw")
CLIENT_ID = os.environ.get("LOOM_COGNITO_CLIENT_ID", "582l8iu4gp700j37p166eihjqb")
AWS_REGION = os.environ.get("LOOM_COGNITO_REGION", "us-east-1")


class CloudSession:
    def __init__(self):
        self.cognito = None          # pycognito.Cognito after unlock
        self.dek: Optional[bytes] = None
        self.email: Optional[str] = None
        self.user_sub: Optional[str] = None

    @property
    def unlocked(self) -> bool:
        return self.cognito is not None and self.dek is not None

    def id_token(self) -> str:
        # pycognito refreshes via the stored refresh token when expired
        self.cognito.check_token()
        return self.cognito.id_token

    def lock(self):
        self.cognito = None
        self.dek = None
        self.email = None
        self.user_sub = None


# Module-level singleton, mirroring how main.py holds the Whisper model.
current = CloudSession()
