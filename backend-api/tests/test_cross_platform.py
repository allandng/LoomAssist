"""
Cross-platform / audit-fix pass — route + service tests.

Covers:
- LAN sync targets the paired peer's stored address (never localhost / the
  cert fingerprint) and pushes as well as pulls.
- /pair/complete + PATCH /pair/peers/{id} persist host/port.
- Sync-review bulk approve creates local events (same as single approve).
- GET /connections/{id}/subscriptions (+ ?subscribed=true, enabled patch).
- OAuth callback pages + status routes.
- Availability share_url derives from the request host / LAN IP.
- Voice cancel_event soft-deletes; POST /events/{id}/restore undoes it.
- GET /journal/{id}/audio serves only files inside the audio dir.
- Inbox PATCH / include_archived, template PUT routes.
- GET /admin/backup (FileResponse) + POST /admin/restore (multipart `file`).
- keychain_bridge encrypted-file fallback round-trip.
- loom_logger formats records and clear_log_file() keeps logging alive.
- core.paths env overrides.

Run in isolation:
    cd backend-api && venv/Scripts/python.exe -m pytest tests/test_cross_platform.py -v
"""
import io
import json
import os
import sqlite3
import sys
from unittest.mock import MagicMock, patch

from sqlmodel import create_engine, Session, SQLModel
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

import database.database as _db
_TEST_ENGINE = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
_db.engine = _TEST_ENGINE
_db.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_TEST_ENGINE)

for _mod in ("faster_whisper", "ollama", "pypdf", "sentence_transformers", "zeroconf", "caldav"):
    sys.modules.setdefault(_mod, MagicMock())
sys.modules["faster_whisper"].WhisperModel = MagicMock(return_value=MagicMock())
sys.modules["pypdf"].PdfReader = MagicMock()

import pytest  # noqa: E402
from datetime import datetime  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from database import models  # noqa: E402
from main import app, get_db  # noqa: E402

app.dependency_overrides[get_db] = lambda: (yield Session(_TEST_ENGINE))
client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_db():
    SQLModel.metadata.create_all(_TEST_ENGINE)
    yield
    SQLModel.metadata.drop_all(_TEST_ENGINE)


def _now():
    return datetime.utcnow().isoformat()


def _make_calendar(name="Test") -> int:
    with Session(_TEST_ENGINE) as db:
        cal = models.Calendar(name=name, color="#6366f1")
        db.add(cal); db.commit(); db.refresh(cal)
        return cal.id


def _make_event(cal_id, title="Ev", start="2026-05-01T09:00:00", end="2026-05-01T10:00:00", **kw) -> int:
    with Session(_TEST_ENGINE) as db:
        ev = models.Event(title=title, start_time=start, end_time=end, calendar_id=cal_id, **kw)
        db.add(ev); db.commit(); db.refresh(ev)
        return ev.id


# ── LAN sync: peer addressing + push/pull ─────────────────────────────────────

class _FakeResp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class _FakeAsyncClient:
    calls: list = []

    def __init__(self, *a, **kw):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None):
        _FakeAsyncClient.calls.append((url, json))
        if url.endswith("/sync/exchange"):
            return _FakeResp({"since": json["since"], "events": [], "tasks": []})
        return _FakeResp({"applied": len((json or {}).get("events", []))})


def _make_peer(**kw) -> int:
    with Session(_TEST_ENGINE) as db:
        peer = models.Peer(name=kw.pop("name", "Laptop"), cert_fingerprint=kw.pop("fp", "fp-abc"),
                           created_at=_now(), **kw)
        db.add(peer); db.commit(); db.refresh(peer)
        return peer.id


def test_sync_now_uses_stored_peer_address_and_pushes():
    cal = _make_calendar()
    _make_event(cal, title="Local change", last_modified="2026-05-01T00:00:00")
    peer_id = _make_peer(host="192.168.1.50", port=8010)

    _FakeAsyncClient.calls = []
    with patch("services.lan.exchange.httpx.AsyncClient", _FakeAsyncClient):
        r = client.post(f"/sync/now/{peer_id}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["peer_url"] == "http://192.168.1.50:8010"
    assert body["pushed"] == 1

    urls = [u for u, _ in _FakeAsyncClient.calls]
    assert urls == ["http://192.168.1.50:8010/sync/exchange", "http://192.168.1.50:8010/sync/apply"]
    assert not any("localhost" in u or "127.0.0.1" in u or "fp-abc" in u for u in urls)
    # The push carried our local change.
    pushed_payload = _FakeAsyncClient.calls[1][1]
    assert [e["title"] for e in pushed_payload["events"]] == ["Local change"]

    # last_seen advanced.
    peer = client.get("/pair/peers").json()[0]
    assert peer["last_seen"] is not None
    assert peer["host"] == "192.168.1.50" and peer["port"] == 8010


def test_sync_now_falls_back_to_mdns_address():
    peer_id = _make_peer(fp="fp-mdns")
    _FakeAsyncClient.calls = []
    with patch("services.lan.exchange.httpx.AsyncClient", _FakeAsyncClient), \
         patch("services.lan.exchange.find_discovered_peer",
               return_value={"host": "10.0.0.7", "port": 8000, "fingerprint": "fp-mdns"}):
        r = client.post(f"/sync/now/{peer_id}")
    assert r.status_code == 200, r.text
    assert r.json()["peer_url"] == "http://10.0.0.7:8000"
    assert _FakeAsyncClient.calls[0][0] == "http://10.0.0.7:8000/sync/exchange"


def test_sync_now_without_any_address_returns_503():
    peer_id = _make_peer(fp="fp-unknown")
    with patch("services.lan.exchange.find_discovered_peer", return_value=None):
        r = client.post(f"/sync/now/{peer_id}")
    assert r.status_code == 503
    assert "peer_address_unknown" in r.text


def test_auto_sync_loop_helper_posts_to_each_peer_not_localhost():
    import asyncio
    from services.lan import exchange as _ex
    _make_peer(host="192.168.7.7", port=8000, fp="fp-1")
    _make_peer(host="192.168.7.8", port=8001, fp="fp-2")
    _FakeAsyncClient.calls = []
    with patch("services.lan.exchange.httpx.AsyncClient", _FakeAsyncClient):
        with Session(_TEST_ENGINE) as db:
            results = asyncio.run(_ex.sync_all_peers(db))
    assert {r["peer_url"] for r in results} == {"http://192.168.7.7:8000", "http://192.168.7.8:8001"}
    assert all("localhost" not in u for u, _ in _FakeAsyncClient.calls)


def test_pair_complete_stores_host_and_port():
    import main as _m
    with patch("services.lan.certs._generate_self_signed_cert", return_value=("C", "K")), \
         patch("services.lan.certs._cert_fingerprint", return_value="fp-self"):
        start = client.post("/pair/start").json()
    _m._pairing_codes[start["code"]]["expires"] = "2099-01-01T00:00:00"
    r = client.post("/pair/complete", json={
        "code": start["code"], "peer_name": "Phone", "peer_cert_fingerprint": "fp-phone",
        "peer_host": "192.168.1.22", "peer_port": 8000,
    })
    assert r.status_code == 200, r.text
    assert r.json()["host"] == "192.168.1.22"
    assert r.json()["port"] == 8000


def test_patch_peer_address():
    peer_id = _make_peer()
    r = client.patch(f"/pair/peers/{peer_id}", json={"host": "192.168.1.99", "port": 8443})
    assert r.status_code == 200
    assert r.json()["host"] == "192.168.1.99" and r.json()["port"] == 8443
    assert client.patch(f"/pair/peers/{peer_id}", json={"port": 70000}).status_code == 400


def test_sync_exchange_payload_is_json_clean():
    cal = _make_calendar()
    _make_event(cal, title="New", last_modified="2026-05-01T00:00:00")
    r = client.post("/sync/exchange", json={"since": "2026-03-01T00:00:00"})
    assert r.status_code == 200
    ev = r.json()["events"][0]
    assert ev["title"] == "New" and "_sa_instance_state" not in ev


# ── Sync review bulk approve ─────────────────────────────────────────────────

def _seed_review_items(n=2):
    cal_id = _make_calendar("Coursework")
    with Session(_TEST_ENGINE) as db:
        db.add(models.Connection(id="conn-1", kind="google", display_name="Google — sam@x.com",
                                 account_email="sam@x.com", status="connected", created_at=_now()))
        db.add(models.ConnectionCalendar(id="cc-1", connection_id="conn-1", local_calendar_id=cal_id,
                                         remote_calendar_id="primary", remote_display_name="Primary",
                                         created_at=_now()))
        ids = []
        for i in range(n):
            iid = f"item-{i}"
            db.add(models.SyncReviewItem(
                id=iid, connection_calendar_id="cc-1", kind="incoming_duplicate",
                incoming_payload=json.dumps({"title": f"Lecture {i}", "start_time": "2026-04-23T14:00:00",
                                             "end_time": "2026-04-23T15:30:00", "external_id": f"g-{i}"}),
                created_at=_now(),
            ))
            ids.append(iid)
        db.commit()
    return ids


def test_bulk_approve_creates_events_and_resolves():
    ids = _seed_review_items(2)
    r = client.post("/sync/review/bulk", json={"item_ids": ids + ["missing"], "action": "approve"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resolved"] == 2 and body["skipped"] == 1 and len(body["event_ids"]) == 2
    titles = {e["title"] for e in client.get("/events/").json()}
    assert {"Lecture 0", "Lecture 1"} <= titles
    assert client.get("/sync/review").json() == []
    with Session(_TEST_ENGINE) as db:
        items = db.query(models.SyncReviewItem).all()
        assert all(i.resolution == "approved_new" for i in items)


def test_bulk_reject_still_works():
    ids = _seed_review_items(1)
    r = client.post("/sync/review/bulk", json={"item_ids": ids, "action": "reject"})
    assert r.json()["resolved"] == 1 and r.json()["event_ids"] == []


# ── Connections: subscriptions listing ───────────────────────────────────────

def test_connection_subscriptions_route_and_enabled_patch():
    cal_id = _make_calendar("Work")
    with Session(_TEST_ENGINE) as db:
        db.add(models.Connection(id="conn-2", kind="google", display_name="G", account_email="a@b.c",
                                 status="connected", created_at=_now()))
        db.add(models.ConnectionCalendar(id="cc-2", connection_id="conn-2", local_calendar_id=cal_id,
                                         remote_calendar_id="rid", remote_display_name="Remote",
                                         remote_color="#ff0000", created_at=_now()))
        db.commit()
    r = client.get("/connections/conn-2/subscriptions")
    assert r.status_code == 200, r.text
    row = r.json()[0]
    assert row["id"] == "cc-2" and row["remote_id"] == "rid" and row["name"] == "Remote"
    assert row["color"] == "#ff0000" and row["timeline_id"] == cal_id and row["calendar_id"] == cal_id
    assert row["enabled"] is True and row["last_synced_at"] is None
    # alias on the existing path
    assert client.get("/connections/conn-2/calendars?subscribed=true").json()[0]["id"] == "cc-2"
    # disable
    r = client.patch("/connections/conn-2/calendars/cc-2", json={"enabled": False})
    assert r.status_code == 200 and r.json()["enabled"] is False
    assert client.get("/connections/nope/subscriptions").status_code == 404


# ── OAuth callback pages ─────────────────────────────────────────────────────

def test_oauth_callback_pages_and_status():
    r = client.get("/auth/oauth/callback#access_token=x")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    assert "/auth/oauth/complete" in r.text and "location.hash" in r.text
    r = client.get("/connections/google/callback?code=abc&state=s")
    assert r.status_code == 200 and "/connections/google/complete" in r.text
    assert client.get("/auth/oauth/status").json()["completed_at"] is None
    assert client.get("/connections/google/status").json()["connection_id"] is None


def test_supabase_authorize_url_encodes_redirect():
    from services.auth import supabase as sb
    with patch.object(sb, "SUPABASE_URL", "https://x.supabase.co"), \
         patch.object(sb, "SUPABASE_REDIRECT", "http://localhost:8000/auth/oauth/callback"):
        url = sb.build_oauth_url("google")
    assert url.startswith("https://x.supabase.co/auth/v1/authorize?")
    assert "redirect_to=http%3A%2F%2Flocalhost%3A8000%2Fauth%2Foauth%2Fcallback" in url


# ── Availability share_url ───────────────────────────────────────────────────

def test_availability_share_url_uses_request_host():
    r = client.post("/availability", json={"sender_name": "A", "duration_minutes": 30,
                                           "slots": [{"date": "2026-05-01", "start": "09:00", "end": "09:30"}]})
    assert r.status_code == 200
    assert r.json()["share_url"].startswith("http://testserver/availability/")


def test_availability_share_url_swaps_loopback_for_lan_ip():
    loop_client = TestClient(app, base_url="http://127.0.0.1:8000")
    with patch("services.lan.discovery.get_lan_ip", return_value="192.168.1.9"):
        r = loop_client.post("/availability", json={"sender_name": "A", "slots": []})
    assert r.json()["share_url"].startswith("http://192.168.1.9:8000/availability/")
    assert r.json()["share_url"].endswith("/view")


# ── Voice cancel: soft delete + restore ──────────────────────────────────────

def test_intent_apply_cancel_is_soft_and_restorable():
    cal = _make_calendar()
    ev_id = _make_event(cal, title="Dentist")
    r = client.post("/intent/apply", json={"action": "cancel_event", "event_id": ev_id, "proposed_change": {"delete": True}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "deleted" and body["soft"] is True
    assert body["event"]["title"] == "Dentist" and body["event"]["id"] == ev_id
    assert body["restore"] == {"method": "POST", "path": f"/events/{ev_id}/restore"}
    assert ev_id not in {e["id"] for e in client.get("/events/").json()}

    r = client.post(f"/events/{ev_id}/restore")
    assert r.status_code == 200 and r.json()["restored"] is True
    assert ev_id in {e["id"] for e in client.get("/events/").json()}
    # idempotent
    assert client.post(f"/events/{ev_id}/restore").json()["restored"] is False
    assert client.post("/events/99999/restore").status_code == 404


# ── Journal audio ────────────────────────────────────────────────────────────

def test_journal_audio_route_validates_path(tmp_path):
    audio_dir = tmp_path / "journal_audio"
    audio_dir.mkdir()
    good = audio_dir / "journal_2026-05-01_1.webm"
    good.write_bytes(b"\x1aE\xdf\xa3webm-bytes")
    outside = tmp_path / "secret.txt"
    outside.write_text("nope")
    with Session(_TEST_ENGINE) as db:
        e1 = models.JournalEntry(date="2026-05-01", transcript="t", audio_path=str(good), created_at=_now())
        e2 = models.JournalEntry(date="2026-05-01", transcript="t", audio_path=str(outside), created_at=_now())
        e3 = models.JournalEntry(date="2026-05-01", transcript="t", audio_path=None, created_at=_now())
        e4 = models.JournalEntry(date="2026-05-01", transcript="t", audio_path="../../etc/passwd", created_at=_now())
        db.add_all([e1, e2, e3, e4]); db.commit()
        ids = [e1.id, e2.id, e3.id, e4.id]
    with patch("routers.journal._JOURNAL_AUDIO_DIR", audio_dir):
        r = client.get(f"/journal/{ids[0]}/audio")
        assert r.status_code == 200 and r.content == good.read_bytes()
        assert r.headers["content-type"].startswith("audio/webm")
        assert client.get(f"/journal/{ids[1]}/audio").status_code == 404
        assert client.get(f"/journal/{ids[2]}/audio").status_code == 404
        assert client.get(f"/journal/{ids[3]}/audio").status_code == 404
        assert client.get("/journal/99999/audio").status_code == 404


# ── Small CRUD gaps ──────────────────────────────────────────────────────────

def test_inbox_patch_and_include_archived():
    item = client.post("/inbox", json={"text": "buy milk"}).json()
    r = client.patch(f"/inbox/{item['id']}", json={"text": "buy oat milk", "archived": True})
    assert r.status_code == 200 and r.json()["text"] == "buy oat milk" and r.json()["archived"] is True
    assert client.get("/inbox").json() == []
    assert len(client.get("/inbox?include_archived=true").json()) == 1
    r = client.patch(f"/inbox/{item['id']}", json={"archived": False})
    assert r.json()["archived"] is False and len(client.get("/inbox").json()) == 1
    assert client.patch(f"/inbox/{item['id']}", json={"text": "   "}).status_code == 400
    assert client.patch("/inbox/99999", json={"text": "x"}).status_code == 404


def test_task_template_put():
    t = client.post("/task-templates", json={"name": "Weekly", "title": "Review"}).json()
    r = client.put(f"/task-templates/{t['id']}", json={"title": "Weekly review", "default_priority": "high"})
    assert r.status_code == 200 and r.json()["title"] == "Weekly review" and r.json()["default_priority"] == "high"
    assert r.json()["name"] == "Weekly"
    assert client.put(f"/task-templates/{t['id']}", json={"default_priority": "urgent"}).status_code == 400
    assert client.put("/task-templates/99999", json={"title": "x"}).status_code == 404


def test_event_template_put():
    t = client.post("/templates/", json={"name": "Standup", "title": "Daily standup"}).json()
    r = client.put(f"/templates/{t['id']}", json={"duration_minutes": 15, "is_recurring": True, "recurrence_days": "1,2,3,4,5"})
    assert r.status_code == 200
    assert r.json()["duration_minutes"] == 15 and r.json()["is_recurring"] is True and r.json()["title"] == "Daily standup"
    assert client.put("/templates/99999", json={"title": "x"}).status_code == 404


# ── Admin backup / restore ───────────────────────────────────────────────────

def _make_sqlite(path, marker: str):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE IF NOT EXISTS marker (v TEXT)")
    con.execute("DELETE FROM marker")
    con.execute("INSERT INTO marker VALUES (?)", (marker,))
    con.commit(); con.close()


def _marker(path):
    con = sqlite3.connect(path)
    v = con.execute("SELECT v FROM marker").fetchone()[0]
    con.close()
    return v


def test_admin_backup_download_and_restore_roundtrip(tmp_path, monkeypatch):
    live = tmp_path / "live.sqlite3"
    _make_sqlite(str(live), "ORIGINAL")
    monkeypatch.setenv("LOOM_DB_PATH", str(live))
    fake_dbmod = MagicMock()
    with patch("routers.backup._dbmod", fake_dbmod):
        r = client.get("/admin/backup")
        assert r.status_code == 200
        assert r.content[:16] == b"SQLite format 3\x00"
        assert 'filename="loom-backup.sqlite3"' in r.headers["content-disposition"]
        snapshot = r.content

        # Mutate live, then restore the snapshot -> original marker comes back.
        _make_sqlite(str(live), "CHANGED")
        assert _marker(str(live)) == "CHANGED"
        files = {"file": ("loom-backup.sqlite3", io.BytesIO(snapshot), "application/octet-stream")}
        r = client.post("/admin/restore", files=files)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "success"
    assert _marker(str(live)) == "ORIGINAL"
    assert fake_dbmod.engine.dispose.called
    assert (tmp_path / "live.sqlite3.pre-restore.bak").exists()
    assert _marker(str(tmp_path / "live.sqlite3.pre-restore.bak")) == "CHANGED"
    assert not (tmp_path / "live.sqlite3.incoming").exists()


def test_admin_restore_rejects_non_sqlite():
    files = {"file": ("x.sqlite3", io.BytesIO(b"not a database at all"), "application/octet-stream")}
    r = client.post("/admin/restore", files=files)
    assert r.status_code == 400 and "invalid_db_file" in r.text


def test_replace_live_db_returns_409_when_locked(tmp_path):
    from fastapi import HTTPException
    from routers import backup as _b
    src = tmp_path / "src.sqlite3"; _make_sqlite(str(src), "S")
    dest = tmp_path / "dest.sqlite3"; _make_sqlite(str(dest), "D")
    with patch("routers.backup.os.replace", side_effect=PermissionError(32, "in use")), \
         patch("routers.backup.time.sleep"), patch("routers.backup._dbmod", MagicMock()):
        with pytest.raises(HTTPException) as ei:
            _b._replace_live_db(str(src), str(dest))
    assert ei.value.status_code == 409 and ei.value.detail["error"]["code"] == "db_locked"
    assert _marker(str(dest)) == "D" and not (tmp_path / "dest.sqlite3.incoming").exists()


# ── keychain bridge fallback ─────────────────────────────────────────────────

def test_keychain_bridge_encrypted_fallback_roundtrip(tmp_path, monkeypatch):
    from services.sync import keychain_bridge as kb
    monkeypatch.setenv("LOOM_SECRETS_DIR", str(tmp_path))
    with patch.object(kb, "_keyring", return_value=None):
        kb.set_token("conn-x", "refresh-token-123")
        kb._in_memory.clear()                     # force the on-disk path
        assert kb.get_token_sync("conn-x") == "refresh-token-123"
        blob = (tmp_path / "connection.conn-x.bin").read_bytes()
        assert b"refresh-token-123" not in blob    # encrypted at rest
        kb.clear_token("conn-x")
        kb._in_memory.clear()
        assert kb.get_token_sync("conn-x") is None
        assert not (tmp_path / "connection.conn-x.bin").exists()


def test_keychain_bridge_uses_keyring_service_and_account():
    from services.sync import keychain_bridge as kb
    fake = MagicMock()
    fake.get_password.return_value = None
    with patch.object(kb, "_keyring", return_value=fake):
        kb.set_token("abc", "tok")
        fake.set_password.assert_called_once_with("com.loomassist", "connection.abc", "tok")
        kb._in_memory.clear()
        fake.get_password.return_value = "tok"
        assert kb.get_token_sync("abc") == "tok"
        fake.get_password.assert_called_with("com.loomassist", "connection.abc")


# ── logger + paths ───────────────────────────────────────────────────────────

def test_logger_writes_json_and_survives_clear():
    import loom_logger
    lg = loom_logger.get_logger("xplat-test")
    lg.warning("hello %s", "world")
    lg.warning(f"mDNS init failed (non-fatal): {Exception()}")
    lines = loom_logger.LOG_FILE.read_text(encoding="utf-8").splitlines()
    recs = [json.loads(l) for l in lines[-2:]]
    assert recs[0]["message"] == "hello world" and recs[0]["logger"] == "xplat-test"
    assert recs[1]["message"] == "mDNS init failed (non-fatal): "
    loom_logger.clear_log_file()
    lg.info("after clear")
    after = loom_logger.LOG_FILE.read_text(encoding="utf-8").splitlines()
    assert len(after) == 1 and json.loads(after[0])["message"] == "after clear"
    r = client.delete("/api/logs")
    assert r.status_code == 200


def test_paths_env_overrides(monkeypatch, tmp_path):
    from core import paths
    monkeypatch.setenv("LOOM_DB_PATH", str(tmp_path / "custom.sqlite3"))
    monkeypatch.setenv("LOOM_LOG_DIR", str(tmp_path / "logs"))
    monkeypatch.setenv("LOOM_DATA_DIR", str(tmp_path / "data"))
    assert paths.db_path() == (tmp_path / "custom.sqlite3").resolve()
    assert paths.log_dir() == (tmp_path / "logs").resolve()
    assert paths.journal_audio_dir() == (tmp_path / "data" / "journal_audio").resolve()
    assert paths.certs_dir() == (tmp_path / "data" / "certs").resolve()
    monkeypatch.delenv("LOOM_DATA_DIR")
    assert paths.journal_audio_dir() == paths.BACKEND_DIR / "journal_audio"


def test_discovery_lan_ip_prefers_route_probe():
    from services.lan import discovery as d
    with patch.object(d, "_udp_probe_ip", return_value="192.168.4.20"):
        assert d.get_lan_ip(refresh=True) == "192.168.4.20"
    with patch.object(d, "_udp_probe_ip", return_value=None), \
         patch.object(d, "_hostname_candidates", return_value=["172.28.0.1", "192.168.4.21"]):
        assert d.get_lan_ip(refresh=True) == "192.168.4.21"   # 172.16/12 (WSL/Hyper-V NAT) ranked last
    d.get_lan_ip(refresh=True)  # restore real cache


# ── Coordinator additions: journal transcribe / PUT, assignment null-clearing ─

class _Seg:
    def __init__(self, text):
        self.text = text


def _whisper_mock(*texts, duration=3.5):
    info = MagicMock()
    info.duration = duration
    model = MagicMock()
    model.transcribe.return_value = ([_Seg(t) for t in texts], info)
    return model


def test_journal_transcribe_returns_text_only():
    with patch("routers.journal.whisper.get_model", return_value=_whisper_mock(" Today was", " productive. ")):
        files = {"audio": ("note.webm", io.BytesIO(b"\x00" * 64), "audio/webm")}
        r = client.post("/journal/transcribe", files=files)
        assert r.status_code == 200, r.text
        assert r.json() == {"text": "Today was productive.", "duration_seconds": 3.5}
        # `file` field name (as POST /transcribe uses) also accepted
        files = {"file": ("note.webm", io.BytesIO(b"\x00" * 64), "audio/webm")}
        assert client.post("/journal/transcribe", files=files).json()["text"] == "Today was productive."
    # No entry written, no intents executed.
    assert client.get("/journal").json() == []
    assert client.post("/journal/transcribe").status_code == 400
    empty = {"audio": ("note.webm", io.BytesIO(b""), "audio/webm")}
    assert client.post("/journal/transcribe", files=empty).status_code == 400


def test_journal_put_updates_and_clears_fields():
    e = client.post("/journal/text", json={"text": "first draft", "mood": "ok", "event_id": 5, "date": "2026-05-02"}).json()
    r = client.put(f"/journal/{e['id']}", json={"transcript": "  edited  ", "mood": None})
    assert r.status_code == 200, r.text
    assert r.json()["transcript"] == "edited" and r.json()["mood"] is None
    assert r.json()["event_id"] == 5 and r.json()["date"] == "2026-05-02"   # untouched
    r = client.put(f"/journal/{e['id']}", json={"event_id": None, "mood": "great"})
    assert r.json()["event_id"] is None and r.json()["mood"] == "great"
    r = client.put(f"/journal/{e['id']}", json={"date": None})
    assert r.status_code == 200 and r.json()["date"] == "2026-05-02"        # null date ignored
    assert client.put(f"/journal/{e['id']}", json={"transcript": "   "}).status_code == 400
    assert client.put("/journal/99999", json={"mood": "ok"}).status_code == 404
    # persisted
    assert client.get("/journal").json()[0]["transcript"] == "edited"


def test_assignment_put_explicit_null_clears_fields():
    course = client.post("/courses", json={"name": "Algorithms", "code": "CS301"}).json()
    a = client.post("/assignments", json={"course_id": course["id"], "title": "HW1", "due_date": "2026-05-10",
                                          "weight_category": "Homework", "score": 90, "max_score": 100}).json()
    r = client.put(f"/assignments/{a['id']}", json={"score": None})
    assert r.status_code == 200, r.text
    assert r.json()["score"] is None and r.json()["max_score"] == 100 and r.json()["weight_category"] == "Homework"
    r = client.put(f"/assignments/{a['id']}", json={"weight_category": None, "max_score": None})
    assert r.json()["weight_category"] is None and r.json()["max_score"] is None
    r = client.put(f"/assignments/{a['id']}", json={})
    assert r.json()["title"] == "HW1" and r.json()["due_date"] == "2026-05-10"
    r = client.put(f"/assignments/{a['id']}", json={"score": 42.5, "title": "HW1 (revised)"})
    assert r.json()["score"] == 42.5 and r.json()["title"] == "HW1 (revised)"
    assert client.put(f"/assignments/{a['id']}", json={"title": None}).status_code == 400
