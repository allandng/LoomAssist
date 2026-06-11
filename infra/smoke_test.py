"""Stage 2 live smoke test — round-trip an encrypted record through the deployed API.

Exercises the real crypto primitives (services/crypto/vault.py) against the real
stack: SRP auth -> vault init -> encrypted record put -> delta pull -> decrypt ->
conflict check -> tombstone delete.

Run from infra/ with backend venv + AWS env loaded:
    set -a; source ../backend-api/.env; set +a
    ../backend-api/venv/bin/python smoke_test.py
"""

import base64
import json
import sys
import time
from pathlib import Path

import boto3
import httpx
from pycognito import Cognito

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend-api"))
from services.crypto import vault  # noqa: E402

API = "https://03ouv0xgzb.execute-api.us-east-1.amazonaws.com"
USER_POOL_ID = "us-east-1_aZaXEizfw"
CLIENT_ID = "582l8iu4gp700j37p166eihjqb"
TEST_EMAIL = "allanthedab+loomsync-smoke@gmail.com"
TEST_PASSWORD = "smoke-test-passw0rd-2026"
DEVICE_ID = "mac_smoke_test"

b64 = lambda b: base64.b64encode(b).decode()
unb64 = base64.b64decode

passed = 0

def check(name, cond, detail=""):
    global passed
    if not cond:
        print(f"  FAIL  {name}  {detail}")
        sys.exit(1)
    passed += 1
    print(f"  ok    {name}")


# --- 0. unauthenticated requests are rejected --------------------------------
r = httpx.get(f"{API}/records?since=0")
check("unauthenticated request rejected", r.status_code == 401, f"got {r.status_code}")

# --- 1. test user + SRP auth --------------------------------------------------
idp = boto3.client("cognito-idp", region_name="us-east-1")
try:
    idp.admin_create_user(
        UserPoolId=USER_POOL_ID,
        Username=TEST_EMAIL,
        UserAttributes=[
            {"Name": "email", "Value": TEST_EMAIL},
            {"Name": "email_verified", "Value": "true"},
        ],
        MessageAction="SUPPRESS",
    )
except idp.exceptions.UsernameExistsException:
    pass
idp.admin_set_user_password(
    UserPoolId=USER_POOL_ID, Username=TEST_EMAIL, Password=TEST_PASSWORD, Permanent=True
)

cog = Cognito(USER_POOL_ID, CLIENT_ID, username=TEST_EMAIL)
cog.authenticate(password=TEST_PASSWORD)  # SRP — password never transits
headers = {"Authorization": f"Bearer {cog.id_token}"}
check("SRP auth issued a JWT", bool(cog.id_token))

# --- 2. vault init + new-device unwrap ---------------------------------------
r = httpx.get(f"{API}/vault/info", headers=headers)
if r.status_code == 200:
    print("  note  vault already initialized from a previous run — reusing")
    info = r.json()
    salt = unb64(info["salt"])
    kek = vault.derive_kek(TEST_PASSWORD, salt)
    blob = unb64(info["wrapped_dek"])
    dek = vault.unwrap_dek(blob[12:], blob[:12], kek)
else:
    check("vault/info 404 before init", r.status_code == 404, f"got {r.status_code}")
    salt = vault.generate_salt()
    kek = vault.derive_kek(TEST_PASSWORD, salt)
    dek = vault.generate_dek()
    wrapped, wrap_nonce = vault.wrap_dek(dek, kek)
    r = httpx.post(
        f"{API}/vault/init",
        headers=headers,
        json={
            "wrapped_dek": b64(wrap_nonce + wrapped),  # nonce||ciphertext envelope
            "salt": b64(salt),
            "kdf_params": {"kdf": "scrypt", "n": 2**17, "r": 8, "p": 1},
            "device_id": DEVICE_ID,
        },
    )
    check("vault init", r.status_code == 201, r.text)

    # simulate a brand-new device: fetch wrapping params, re-derive, unwrap
    info = httpx.get(f"{API}/vault/info", headers=headers).json()
    kek2 = vault.derive_kek(TEST_PASSWORD, unb64(info["salt"]))
    blob = unb64(info["wrapped_dek"])
    dek2 = vault.unwrap_dek(blob[12:], blob[:12], kek2)
    check("new-device DEK unwrap matches", dek2 == dek)

# --- 3. encrypted record round-trip -------------------------------------------
record_id = f"evt_smoke_{int(time.time())}"
plaintext = json.dumps(
    {
        "type": "event",
        "data": {"title": "Stage 2 smoke test", "start_time": "2026-06-12T09:00:00"},
        "schema_version": 1,
    }
).encode()
ciphertext, nonce = vault.encrypt_record(plaintext, dek)

r = httpx.put(
    f"{API}/records/{record_id}",
    headers=headers,
    json={
        "ciphertext": b64(ciphertext),
        "nonce": b64(nonce),
        "type": "event",
        "expected_version": 0,
        "device_id": DEVICE_ID,
    },
)
check("encrypted record PUT", r.status_code == 200 and r.json()["version"] == 1, r.text)

r = httpx.get(f"{API}/records?since=0&type=event", headers=headers)
recs = [x for x in r.json()["records"] if x["record_id"] == record_id]
check("record appears in delta query", len(recs) == 1)

decrypted = vault.decrypt_record(unb64(recs[0]["ciphertext"]), unb64(recs[0]["nonce"]), dek)
check("ciphertext decrypts to original", decrypted == plaintext)

# --- 4. optimistic concurrency -------------------------------------------------
r = httpx.put(
    f"{API}/records/{record_id}",
    headers=headers,
    json={"ciphertext": b64(ciphertext), "nonce": b64(nonce), "type": "event",
          "expected_version": 0, "device_id": DEVICE_ID},
)
check("stale write returns 409 + current version",
      r.status_code == 409 and r.json()["current_version"] == 1, r.text)

# --- 5. tombstone delete --------------------------------------------------------
r = httpx.delete(f"{API}/records/{record_id}", headers=headers)
check("delete tombstones", r.status_code == 200 and r.json()["tombstone"] is True, r.text)

r = httpx.get(f"{API}/records?since=0", headers=headers)
tomb = [x for x in r.json()["records"] if x["record_id"] == record_id][0]
check("tombstone visible in delta, ciphertext gone",
      tomb["tombstone"] is True and "ciphertext" not in tomb)

# --- 6. device registry ----------------------------------------------------------
r = httpx.get(f"{API}/devices", headers=headers)
ids = [d["device_id"] for d in r.json()["devices"]]
check("device registered from writes", DEVICE_ID in ids, str(ids))

print(f"\nAll {passed} smoke checks passed against {API}")
