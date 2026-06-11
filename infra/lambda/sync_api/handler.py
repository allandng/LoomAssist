"""LoomAssist sync API — single Lambda behind the HTTP API.

Every route sits behind the Cognito JWT authorizer; identity is the token's
`sub` claim. The server stores only ciphertext + plaintext routing metadata
(record_type, timestamps) — see loomassist_Roadmap.md §4.

Item layout in the single table (PK user_id, SK sk):
  VAULT                 — wrapped DEK + KDF params
  RECORD#{record_id}    — encrypted record; carries `last_modified` so it
                          appears in the sparse gsi-last-modified index
  DEVICE#{device_id}    — device registry row (no `last_modified` attribute,
                          so it stays out of delta queries)
"""

import base64
import json
import os
import time
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

TABLE_NAME = os.environ["TABLE_NAME"]
GSI_LAST_MODIFIED = "gsi-last-modified"
TOMBSTONE_TTL_SECONDS = 90 * 24 * 3600
DEFAULT_PAGE_SIZE = 100
MAX_PAGE_SIZE = 500

_table = boto3.resource("dynamodb").Table(TABLE_NAME)


class BadRequest(Exception):
    pass


# --- helpers ----------------------------------------------------------------

def _resp(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _undecimal(v):
    """DynamoDB returns every number as Decimal, including inside nested maps."""
    if isinstance(v, Decimal):
        return int(v) if v % 1 == 0 else float(v)
    if isinstance(v, dict):
        return {k: _undecimal(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_undecimal(x) for x in v]
    return v


def _clean(item):
    return {k: _undecimal(v) for k, v in item.items() if k not in ("user_id", "sk")}


def _now_ms():
    return int(time.time() * 1000)


def _body(event):
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise BadRequest("body is not valid JSON")
    if not isinstance(parsed, dict):
        raise BadRequest("body must be a JSON object")
    return parsed


def _require(body, *fields):
    missing = [f for f in fields if f not in body]
    if missing:
        raise BadRequest(f"missing fields: {', '.join(missing)}")


def _touch_device(user_id, device_id):
    if not device_id:
        return
    _table.update_item(
        Key={"user_id": user_id, "sk": f"DEVICE#{device_id}"},
        UpdateExpression="SET device_id = :d, last_seen = :ls",
        ExpressionAttributeValues={":d": device_id, ":ls": _now_ms()},
    )


# --- vault ------------------------------------------------------------------

def vault_init(user_id, event):
    body = _body(event)
    _require(body, "wrapped_dek", "salt", "kdf_params")
    try:
        _table.put_item(
            Item={
                "user_id": user_id,
                "sk": "VAULT",
                "wrapped_dek": body["wrapped_dek"],
                "salt": body["salt"],
                "kdf_params": body["kdf_params"],
                "created_at": _now_ms(),
                "updated_at": _now_ms(),
            },
            ConditionExpression="attribute_not_exists(sk)",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return _resp(409, {"error": "vault_exists"})
        raise
    _touch_device(user_id, body.get("device_id"))
    return _resp(201, {"status": "initialized"})


def vault_info(user_id, event):
    item = _table.get_item(Key={"user_id": user_id, "sk": "VAULT"}).get("Item")
    if item is None:
        return _resp(404, {"error": "vault_not_initialized"})
    return _resp(200, _clean(item))


def vault_rotate_password(user_id, event):
    body = _body(event)
    _require(body, "new_wrapped_dek", "new_salt", "new_kdf_params")
    try:
        _table.update_item(
            Key={"user_id": user_id, "sk": "VAULT"},
            UpdateExpression=(
                "SET wrapped_dek = :w, salt = :s, kdf_params = :k, updated_at = :u"
            ),
            ConditionExpression="attribute_exists(sk)",
            ExpressionAttributeValues={
                ":w": body["new_wrapped_dek"],
                ":s": body["new_salt"],
                ":k": body["new_kdf_params"],
                ":u": _now_ms(),
            },
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return _resp(404, {"error": "vault_not_initialized"})
        raise
    return _resp(200, {"status": "rotated"})


# --- records ----------------------------------------------------------------

def _put_one(user_id, record_id, body):
    """Returns (status_code, response_body). Optimistic concurrency on version."""
    _require(body, "ciphertext", "nonce", "type")
    expected = int(body.get("expected_version", 0))
    now = _now_ms()
    values = {
        ":rid": record_id,
        ":t": body["type"],
        ":v": expected + 1,
        ":lm": now,
        ":d": body.get("device_id", "unknown"),
        ":f": False,
        ":c": body["ciphertext"],
        ":n": body["nonce"],
        ":s": len(body["ciphertext"]),
    }
    if expected == 0:
        condition = "attribute_not_exists(sk)"
    else:
        condition = "version = :expected"
        values[":expected"] = expected
    try:
        _table.update_item(
            Key={"user_id": user_id, "sk": f"RECORD#{record_id}"},
            UpdateExpression=(
                "SET record_id = :rid, record_type = :t, version = :v, "
                "last_modified = :lm, device_id = :d, tombstone = :f, "
                "ciphertext = :c, nonce = :n, size_bytes = :s "
                "REMOVE expires_at"
            ),
            ConditionExpression=condition,
            ExpressionAttributeValues=values,
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            current = _table.get_item(
                Key={"user_id": user_id, "sk": f"RECORD#{record_id}"}
            ).get("Item")
            current_version = int(current["version"]) if current else None
            return 409, {
                "error": "version_conflict",
                "record_id": record_id,
                "current_version": current_version,
            }
        raise
    return 200, {"record_id": record_id, "version": expected + 1, "last_modified": now}


def _delete_one(user_id, record_id):
    """Tombstone the record (idempotent — tombstoning a missing record creates
    one so other devices still learn about the delete)."""
    now = _now_ms()
    existing = _table.get_item(
        Key={"user_id": user_id, "sk": f"RECORD#{record_id}"}
    ).get("Item")
    version = (int(existing["version"]) if existing else 0) + 1
    _table.update_item(
        Key={"user_id": user_id, "sk": f"RECORD#{record_id}"},
        UpdateExpression=(
            "SET record_id = :rid, version = :v, last_modified = :lm, "
            "tombstone = :t, expires_at = :ttl REMOVE ciphertext, nonce"
        ),
        ExpressionAttributeValues={
            ":rid": record_id,
            ":v": version,
            ":lm": now,
            ":t": True,
            ":ttl": int(time.time()) + TOMBSTONE_TTL_SECONDS,
        },
    )
    return {"record_id": record_id, "version": version, "tombstone": True}


def records_delta(user_id, event):
    params = event.get("queryStringParameters") or {}
    since = int(params.get("since", 0))
    record_type = params.get("type")
    limit = min(int(params.get("limit", DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE)

    kwargs = {
        "IndexName": GSI_LAST_MODIFIED,
        "KeyConditionExpression": "user_id = :u AND last_modified > :since",
        "ExpressionAttributeValues": {":u": user_id, ":since": since},
        "Limit": limit,
        "ScanIndexForward": True,
    }
    if record_type:
        kwargs["FilterExpression"] = "record_type = :rt"
        kwargs["ExpressionAttributeValues"][":rt"] = record_type
    if params.get("cursor"):
        try:
            kwargs["ExclusiveStartKey"] = json.loads(
                base64.urlsafe_b64decode(params["cursor"]).decode()
            )
        except Exception:
            raise BadRequest("invalid cursor")

    result = _table.query(**kwargs)
    records = [_clean(i) for i in result.get("Items", [])]
    out = {"records": records, "count": len(records)}
    lek = result.get("LastEvaluatedKey")
    if lek:
        out["next_cursor"] = base64.urlsafe_b64encode(
            json.dumps(_clean_key(lek)).encode()
        ).decode()
    return _resp(200, out)


def _clean_key(key):
    return {
        k: (int(v) if isinstance(v, Decimal) else v) for k, v in key.items()
    }


def record_get(user_id, event):
    record_id = event["pathParameters"]["id"]
    item = _table.get_item(
        Key={"user_id": user_id, "sk": f"RECORD#{record_id}"}
    ).get("Item")
    if item is None:
        return _resp(404, {"error": "record_not_found"})
    return _resp(200, _clean(item))


def record_put(user_id, event):
    record_id = event["pathParameters"]["id"]
    body = _body(event)
    status, out = _put_one(user_id, record_id, body)
    if status == 200:
        _touch_device(user_id, body.get("device_id"))
    return _resp(status, out)


def record_delete(user_id, event):
    record_id = event["pathParameters"]["id"]
    return _resp(200, _delete_one(user_id, record_id))


def records_batch(user_id, event):
    body = _body(event)
    puts = body.get("puts", [])
    deletes = body.get("deletes", [])
    if not isinstance(puts, list) or not isinstance(deletes, list):
        raise BadRequest("puts and deletes must be arrays")

    results, conflicts = [], []
    for p in puts:
        if "record_id" not in p:
            raise BadRequest("every put needs a record_id")
        status, out = _put_one(user_id, p["record_id"], p)
        (results if status == 200 else conflicts).append(out)
    for d in deletes:
        if "record_id" not in d:
            raise BadRequest("every delete needs a record_id")
        results.append(_delete_one(user_id, d["record_id"]))

    _touch_device(user_id, body.get("device_id"))
    status = 200 if not conflicts else 409
    return _resp(status, {"applied": results, "conflicts": conflicts})


# --- devices ----------------------------------------------------------------

def devices_list(user_id, event):
    result = _table.query(
        KeyConditionExpression="user_id = :u AND begins_with(sk, :p)",
        ExpressionAttributeValues={":u": user_id, ":p": "DEVICE#"},
    )
    return _resp(200, {"devices": [_clean(i) for i in result.get("Items", [])]})


def device_revoke(user_id, event):
    device_id = event["pathParameters"]["id"]
    _table.delete_item(Key={"user_id": user_id, "sk": f"DEVICE#{device_id}"})
    # v0: removes the registry row only. Token invalidation (Cognito global
    # sign-out scoped per device) is stage 6 territory.
    return _resp(200, {"status": "revoked", "device_id": device_id})


# --- dispatch ----------------------------------------------------------------

ROUTES = {
    "POST /vault/init": vault_init,
    "GET /vault/info": vault_info,
    "POST /vault/rotate-password": vault_rotate_password,
    "GET /records": records_delta,
    "GET /records/{id}": record_get,
    "PUT /records/{id}": record_put,
    "DELETE /records/{id}": record_delete,
    "POST /records/batch": records_batch,
    "GET /devices": devices_list,
    "DELETE /devices/{id}": device_revoke,
}


def handler(event, context):
    claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
    user_id = claims["sub"]
    fn = ROUTES.get(event.get("routeKey", ""))
    if fn is None:
        return _resp(404, {"error": "route_not_found"})
    try:
        return fn(user_id, event)
    except BadRequest as e:
        return _resp(400, {"error": "bad_request", "detail": str(e)})
