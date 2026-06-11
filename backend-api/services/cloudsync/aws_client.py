"""Thin httpx client for the deployed sync API (infra/lambda/sync_api).

Pure transport — no crypto, no DB. The engine composes this with vault.py.
`token_provider` is a zero-arg callable returning a fresh Cognito id_token,
so the client stays testable with a fake.
"""

from typing import Callable, Optional

import httpx


class VersionConflict(Exception):
    def __init__(self, record_id: str, current_version: Optional[int]):
        self.record_id = record_id
        self.current_version = current_version
        super().__init__(f"{record_id}: server at version {current_version}")


class CloudApiError(Exception):
    def __init__(self, status: int, body: str):
        self.status = status
        super().__init__(f"sync API returned {status}: {body[:200]}")


class CloudApiClient:
    def __init__(self, base_url: str, token_provider: Callable[[], str]):
        self._base = base_url.rstrip("/")
        self._token = token_provider
        self._http = httpx.Client(timeout=20.0)

    def _req(self, method: str, path: str, *, json_body=None, params=None) -> httpx.Response:
        return self._http.request(
            method,
            f"{self._base}{path}",
            json=json_body,
            params=params,
            headers={"Authorization": f"Bearer {self._token()}"},
        )

    # --- vault ---
    def vault_info(self) -> Optional[dict]:
        """None when the vault has never been initialized."""
        r = self._req("GET", "/vault/info")
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise CloudApiError(r.status_code, r.text)
        return r.json()

    def vault_init(self, wrapped_dek: str, salt: str, kdf_params: dict, device_id: str):
        r = self._req("POST", "/vault/init", json_body={
            "wrapped_dek": wrapped_dek, "salt": salt,
            "kdf_params": kdf_params, "device_id": device_id,
        })
        if r.status_code not in (201, 409):
            raise CloudApiError(r.status_code, r.text)
        return r.status_code == 201

    # --- records ---
    def records_since(self, since_ms: int, limit: int = 200):
        """Yields records across pages."""
        cursor = None
        while True:
            params = {"since": since_ms, "limit": limit}
            if cursor:
                params["cursor"] = cursor
            r = self._req("GET", "/records", params=params)
            if r.status_code != 200:
                raise CloudApiError(r.status_code, r.text)
            body = r.json()
            yield from body["records"]
            cursor = body.get("next_cursor")
            if not cursor:
                return

    def get_record(self, record_id: str) -> Optional[dict]:
        r = self._req("GET", f"/records/{record_id}")
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise CloudApiError(r.status_code, r.text)
        return r.json()

    def put_record(self, record_id: str, *, ciphertext: str, nonce: str,
                   record_type: str, expected_version: int, device_id: str) -> dict:
        r = self._req("PUT", f"/records/{record_id}", json_body={
            "ciphertext": ciphertext, "nonce": nonce, "type": record_type,
            "expected_version": expected_version, "device_id": device_id,
        })
        if r.status_code == 409:
            raise VersionConflict(record_id, r.json().get("current_version"))
        if r.status_code != 200:
            raise CloudApiError(r.status_code, r.text)
        return r.json()

    def delete_record(self, record_id: str) -> dict:
        r = self._req("DELETE", f"/records/{record_id}")
        if r.status_code != 200:
            raise CloudApiError(r.status_code, r.text)
        return r.json()
