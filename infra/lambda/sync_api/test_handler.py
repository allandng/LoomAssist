"""Local tests for the sync API Lambda against mocked DynamoDB.

Run with the backend venv (it has pytest + moto):
    cd infra/lambda/sync_api && ../../../backend-api/venv/bin/pytest test_handler.py -v
"""

import json
import os

import boto3
import pytest
from moto import mock_aws

os.environ["TABLE_NAME"] = "loomassist-sync-test"
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")

USER = "11111111-aaaa-bbbb-cccc-222222222222"


def _event(route_key, *, body=None, path_params=None, query=None, sub=USER):
    method, path = route_key.split(" ", 1)
    return {
        "routeKey": route_key,
        "requestContext": {
            "authorizer": {"jwt": {"claims": {"sub": sub}}},
            "http": {"method": method, "path": path},
        },
        "body": json.dumps(body) if body is not None else None,
        "pathParameters": path_params or {},
        "queryStringParameters": query or {},
    }


@pytest.fixture()
def api():
    with mock_aws():
        ddb = boto3.resource("dynamodb")
        ddb.create_table(
            TableName=os.environ["TABLE_NAME"],
            KeySchema=[
                {"AttributeName": "user_id", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "user_id", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
                {"AttributeName": "last_modified", "AttributeType": "N"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "gsi-last-modified",
                    "KeySchema": [
                        {"AttributeName": "user_id", "KeyType": "HASH"},
                        {"AttributeName": "last_modified", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        import importlib

        import handler

        importlib.reload(handler)  # rebind module-level table to the mock
        yield handler


def _call(api, route_key, **kw):
    resp = api.handler(_event(route_key, **kw), None)
    return resp["statusCode"], json.loads(resp["body"])


# --- vault -------------------------------------------------------------------

def test_vault_lifecycle(api):
    status, body = _call(api, "GET /vault/info")
    assert status == 404

    status, body = _call(
        api,
        "POST /vault/init",
        body={"wrapped_dek": "d2s=", "salt": "c2FsdA==", "kdf_params": {"n": 131072, "r": 8, "p": 1}},
    )
    assert status == 201

    # second init must refuse
    status, _ = _call(
        api, "POST /vault/init", body={"wrapped_dek": "x", "salt": "y", "kdf_params": {}}
    )
    assert status == 409

    status, body = _call(api, "GET /vault/info")
    assert status == 200
    assert body["wrapped_dek"] == "d2s="
    assert body["kdf_params"]["n"] == 131072

    status, _ = _call(
        api,
        "POST /vault/rotate-password",
        body={"new_wrapped_dek": "bmV3", "new_salt": "bnM=", "new_kdf_params": {"n": 131072}},
    )
    assert status == 200
    _, body = _call(api, "GET /vault/info")
    assert body["wrapped_dek"] == "bmV3"


def test_vault_rotate_requires_init(api):
    status, body = _call(
        api,
        "POST /vault/rotate-password",
        body={"new_wrapped_dek": "x", "new_salt": "y", "new_kdf_params": {}},
    )
    assert status == 404


# --- records -----------------------------------------------------------------

def _put(api, rid, *, expected=0, ct="Y3Q=", rtype="event", device="mac_test"):
    return _call(
        api,
        "PUT /records/{id}",
        path_params={"id": rid},
        body={
            "ciphertext": ct,
            "nonce": "bm9uY2U=",
            "type": rtype,
            "expected_version": expected,
            "device_id": device,
        },
    )


def test_put_get_roundtrip(api):
    status, body = _put(api, "evt_1")
    assert status == 200 and body["version"] == 1

    status, body = _call(api, "GET /records/{id}", path_params={"id": "evt_1"})
    assert status == 200
    assert body["ciphertext"] == "Y3Q="
    assert body["record_type"] == "event"
    assert body["tombstone"] is False


def test_optimistic_concurrency(api):
    _put(api, "evt_1")  # v1
    status, body = _put(api, "evt_1", expected=1, ct="djI=")  # v2
    assert status == 200 and body["version"] == 2

    # stale writer loses and learns the current version
    status, body = _put(api, "evt_1", expected=1, ct="c3RhbGU=")
    assert status == 409
    assert body["error"] == "version_conflict"
    assert body["current_version"] == 2

    # creating an id that exists also conflicts
    status, body = _put(api, "evt_1", expected=0)
    assert status == 409


def test_delta_query_and_type_filter(api):
    _put(api, "evt_1", rtype="event")
    _put(api, "task_1", rtype="task")

    status, body = _call(api, "GET /records", query={"since": "0"})
    assert status == 200 and body["count"] == 2

    status, body = _call(api, "GET /records", query={"since": "0", "type": "task"})
    assert body["count"] == 1
    assert body["records"][0]["record_id"] == "task_1"

    # delta cursor past everything → empty
    last = max(r["last_modified"] for r in _call(api, "GET /records", query={"since": "0"})[1]["records"])
    status, body = _call(api, "GET /records", query={"since": str(last)})
    assert body["count"] == 0


def test_delete_tombstones_and_appears_in_delta(api):
    _put(api, "evt_1")
    status, body = _call(api, "DELETE /records/{id}", path_params={"id": "evt_1"})
    assert status == 200 and body["tombstone"] is True and body["version"] == 2

    _, body = _call(api, "GET /records", query={"since": "0"})
    rec = body["records"][0]
    assert rec["tombstone"] is True
    assert "ciphertext" not in rec
    assert "expires_at" in rec


def test_batch_mixed_results(api):
    _put(api, "evt_1")  # v1
    status, body = _call(
        api,
        "POST /records/batch",
        body={
            "device_id": "mac_test",
            "puts": [
                {"record_id": "evt_1", "ciphertext": "djI=", "nonce": "bg==", "type": "event", "expected_version": 1},
                {"record_id": "evt_2", "ciphertext": "bmV3", "nonce": "bg==", "type": "event", "expected_version": 99},
            ],
            "deletes": [{"record_id": "evt_3"}],
        },
    )
    assert status == 409  # partial conflict surfaces as 409
    assert len(body["applied"]) == 2  # evt_1 update + evt_3 tombstone
    assert body["conflicts"][0]["record_id"] == "evt_2"


def test_user_isolation(api):
    _put(api, "evt_1")
    status, _ = _call(api, "GET /records/{id}", path_params={"id": "evt_1"}, sub="other-user")
    assert status == 404


# --- devices -----------------------------------------------------------------

def test_device_registry(api):
    _put(api, "evt_1", device="mac_AllanBook")
    status, body = _call(api, "GET /devices")
    assert status == 200
    assert [d["device_id"] for d in body["devices"]] == ["mac_AllanBook"]
    assert "last_seen" in body["devices"][0]

    status, _ = _call(api, "DELETE /devices/{id}", path_params={"id": "mac_AllanBook"})
    assert status == 200
    _, body = _call(api, "GET /devices")
    assert body["devices"] == []
