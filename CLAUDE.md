# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This App Is

LoomAssist (v2.2) is a **local-first desktop calendar app** (Tauri 2 + React 19 + FastAPI). All data and AI inference run on-device. The architecture is two processes that must both be running during development:

- **Backend** — FastAPI on `localhost:8000`, SQLite at `backend-api/loom.sqlite3`
- **Frontend** — Tauri/Vite app, communicates with backend via plain HTTP

**v2.2 cloud-sync rules:**
- Identity (Supabase Auth) is **opt-in**. Local mode is a first-class state — `GET /auth/me` returns 204, the app is fully functional with no Account row.
- Calendar/event data **never traverses a LoomAssist server**. Sync runs direct device ↔ provider.
- OAuth tokens and CalDAV passwords live in the macOS Keychain via Tauri commands; **never in SQLite**.
- The `external_uid` column stays ICS-only. Cloud sync uses the new `external_id` / `connection_calendar_id` columns. Don't conflate.

## Tech Stack

### Backend (`backend-api/`)
| Layer | Technology |
|-------|-----------|
| Framework | FastAPI 0.135 |
| ORM / DB | SQLModel 0.0.37 (Pydantic + SQLAlchemy) |
| Database | SQLite (`loom.sqlite3`) |
| Speech-to-Text | Faster-Whisper 1.2 (base.en, int8, CPU) |
| Local LLM | Ollama + Llama 3.2 |
| Embeddings | sentence-transformers (all-MiniLM-L6-v2) |
| PDF parsing | PyPDF 6.9 |
| HTTP client | httpx 0.28 |
| Encryption | cryptography 47 (AES-256-GCM + scrypt) |
| mDNS | zeroconf 0.148 |
| Cloud auth (v2.2) | Supabase Auth REST via httpx — no SDK |
| CalDAV (v2.2) | caldav 2 + vobject |
| Fuzzy matching (v2.2) | rapidfuzz 4 (token_set_ratio) |
| Python | 3.13 |

### Frontend (`frontend-ui/`)
| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 (Rust) |
| UI Framework | React 19 + TypeScript 6 |
| Build tool | Vite 8 |
| Calendar UI | FullCalendar v6 (`@fullcalendar/react`) |
| Styling | CSS Modules + CSS custom properties |
| Routing | React Router v7 |
| Testing | Vitest + @testing-library/react |

## Running the App

```bash
# Terminal 1 — backend
cd backend-api && source venv/bin/activate && python3 -m uvicorn main:app --reload

# Terminal 2 — frontend
cd frontend-ui && npm run tauri dev

# Optional: load demo data
cd backend-api && source venv/bin/activate && python3 seed_demo.py
```

## Testing & Linting

```bash
# Backend tests (pytest) — run each file in isolation (cross-file DB engine patching conflicts)
cd backend-api && pytest tests/test_journal.py -v
cd backend-api && pytest tests/test_backup.py -v
cd backend-api && pytest tests/test_sync.py -v
cd backend-api && pytest tests/test_duration.py -v
cd backend-api && pytest tests/test_find_free_quantized.py -v
cd backend-api && pytest tests/test_location_travel_time.py -v

# Frontend lint
cd frontend-ui/src && npm run lint

# Frontend type check + build
cd frontend-ui/src && npm run build

# Frontend unit tests (Vitest)
cd frontend-ui/src && npm run test
cd frontend-ui/src && npm run test:watch
```

**Important:** Never run `pytest tests/` together — each test file patches the DB engine before importing `main`, and cross-file ordering causes conflicts. Always run one file at a time with `-v`.

## Backend Architecture

**Single file** — `backend-api/main.py` (3500+ lines) contains all routes, Pydantic request models, and business logic. There is no service layer; keep new routes in `main.py`.

**Service modules** live in `backend-api/services/`:
- `scraper.py` — PDF/syllabus scraper
- `embedder.py` — lazy-loads all-MiniLM-L6-v2; `embed()`, `upsert_event_embedding()`, `search()` (cosine similarity in-memory)
- `event_resolver.py` — `resolve_event_by_query()` for fuzzy voice-edit event matching within ±30-day window
- `auth/supabase.py` (v2.2) — Supabase Auth REST client. Pure functions; called by `/auth/*` routes. Reads `SUPABASE_URL` / `SUPABASE_ANON_KEY` env vars; falls back to a structured 503 when unset.
- `sync/dedup.py` (v2.2) — pure-function fuzzy matcher. Constants `TITLE_SIMILARITY_THRESHOLD = 0.85`, `START_WINDOW_MIN = 15`, `DURATION_WINDOW_MIN = 15`. The only place fuzzy thresholds live.
- `sync/google.py` (v2.2) — Google Calendar REST + OAuth via httpx (no `google-api-python-client`). `incremental_pull()` accepts mutually-exclusive `sync_token` or `page_token`.
- `sync/caldav.py` (v2.2) — iCloud / generic CalDAV via the `caldav` Python library. Raises `CalDAVAuthError` on 401/403 and `CalDAVConflict` on 412.
- `sync/ics_normalize.py` (v2.2) — iCal ↔ event-payload conversion. Reused by both CalDAV and the existing ICS importer path.
- `sync/runner.py` (v2.2) — single asyncio task started in FastAPI `lifespan`. Iterates enabled connections every 5 min; broadcasts `{conn_id, phase, review_count}` over the SSE stream. The **only place** that creates `SyncReviewItem` rows. Uses `_pull_google_paginated` (8 pages × 250 events per cycle).
- `sync/keychain_bridge.py` (v2.2) — in-memory token cache populated by the frontend via `POST /connections/{id}/token`. Falls back to a `security find-generic-password` shell-out on macOS so tokens survive a backend restart.

**Database session pattern** — all routes use `db: Session = Depends(get_db)` where `get_db` yields a SQLAlchemy `SessionLocal`. Use `db.query(Model).filter(...).first()` — the codebase uses SQLAlchemy ORM style throughout, not SQLModel's `db.exec(select(...))`.

**Migrations** — `database/database.py:run_migrations()` runs on every boot. To add a column to an existing table, add it to the `new_columns` dict inside the PRAGMA-check block for that table. New tables use `CREATE TABLE IF NOT EXISTS`. All migrations are idempotent.

**New backend routes go in this order in main.py:**
1. Pydantic request/response models (class declarations)
2. Route function(s) immediately after

**AI integration:**
- Ollama (`llama3.2`) for NLP — called via the `ollama` library inside route handlers
- `faster_whisper` for STT — `WhisperModel("base.en")` instantiated at module level (~line 75)
- `sentence-transformers` for embeddings — lazy-loaded on first search call in `services/embedder.py`
- Embedding failures never block event writes (`_try_upsert_embedding` wraps in try/except + `db.rollback()`)

## Database Schema

18 SQLModel tables in `backend-api/database/models.py`:

### `Event`
| Field | Type | Notes |
|-------|------|-------|
| `id` | int PK | auto |
| `title` | str | indexed |
| `start_time` | str | ISO datetime |
| `end_time` | str | ISO datetime |
| `calendar_id` | int FK → Calendar | |
| `is_recurring` | bool | |
| `recurrence_days` | str | comma-sep day nums e.g. `"1,3"` |
| `recurrence_end` | str | ISO date |
| `description` | str | |
| `unique_description` | str | per-occurrence override |
| `reminder_minutes` | int | |
| `reminder_source` | str | `"user"` \| `"inferred"` \| `"none"` |
| `external_uid` | str | duplicate prevention (ICS imports / subscriptions) |
| `timezone` | str | default `'local'` |
| `is_all_day` | bool | |
| `skipped_dates` | str | comma-sep YYYY-MM-DD exceptions |
| `per_day_times` | str | JSON `{"1":["09:00","11:00"],...}` |
| `checklist` | str | JSON `[{"text":"...","done":false},...]` |
| `actual_start` | str | ISO datetime — clock-in timestamp |
| `actual_end` | str | ISO datetime — clock-out timestamp |
| `location` | str | free-text venue/address |
| `travel_time_minutes` | int | commute buffer; subtracted from event start in free-slot search |
| `depends_on_event_id` | int | Phase 10: parent event id |
| `depends_offset_minutes` | int | Phase 10: offset from parent end |
| `last_modified` | str | Phase 14c: ISO datetime, updated on every write |
| `deleted_at` | str | Phase 14c: tombstone — set instead of hard DELETE for sync |
| `connection_calendar_id` | str | v2.2: FK → `ConnectionCalendar.id`. Null = local-only event |
| `external_id` | str | v2.2: provider's stable id (Google: `event.id`; CalDAV: resource href). UNIQUE INDEX `(connection_calendar_id, external_id) WHERE external_id IS NOT NULL` |
| `external_etag` | str | v2.2: provider concurrency token; sent as `If-Match` on PUT |
| `last_synced_at` | str | v2.2: drives the QuickPeek/EventEditor freshness label |

### `Calendar` (Timeline)
| Field | Type | Notes |
|-------|------|-------|
| `id` | int PK | |
| `name` | str | indexed |
| `description` | str | |
| `color` | str | hex, default `#6366f1` |
| `created_via_sync` | bool | v2.2: true for timelines auto-created during connection setup. Drives the disconnect-confirm copy |

### `EventTemplate`
| Field | Type | Notes |
|-------|------|-------|
| `id` | int PK | |
| `name` | str | user label e.g. "Weekly Standup" |
| `title` | str | pre-filled event title |
| `description` | str | |
| `duration_minutes` | int | default 60 |
| `is_recurring` | bool | |
| `recurrence_days` | str | |
| `calendar_id` | int | optional default timeline |

### `Task` (Task Board + Focus Kanban)
| Field | Type | Notes |
|-------|------|-------|
| `id` | int PK | |
| `event_id` | int | indexed; no FK (avoids cascade on event delete) |
| `is_complete` | bool | |
| `note` | str | |
| `added_at` | str | ISO datetime |
| `status` | str | `backlog` \| `doing` \| `done` |
| `priority` | str | `high` \| `med` \| `low` |
| `due_date` | str | ISO date, nullable |
| `estimated_minutes` | int | Phase 7: autopilot duration estimate |
| `deadline` | str | Phase 7: ISO date, for autopilot ordering |
| `last_modified` | str | Phase 14c: sync watermark |
| `deleted_at` | str | Phase 14c: tombstone |

### `AvailabilityRequest`
| Field | Type | Notes |
|-------|------|-------|
| `id` | int PK | |
| `token` | str | unique, indexed — used in share URL |
| `sender_name` | str | |
| `duration_minutes` | int | default 60 |
| `slots` | str | JSON `[{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM"},...]` |
| `status` | str | `pending` \| `confirmed` \| `amended` \| `declined` |
| `confirmed_slot` | str | JSON object, null until confirmed |
| `amendment_slot` | str | JSON object, null until proposed |
| `receiver_name` | str | set when recipient responds |
| `created_at` | str | ISO datetime |
| `expires_at` | str | ISO datetime — link expiry |

### `JournalEntry` (Phase 12)
| Field | Type | Notes |
|-------|------|-------|
| `id` | int PK | |
| `date` | str | ISO date YYYY-MM-DD |
| `transcript` | str | Whisper output |
| `audio_path` | str | local file path, null if audio not saved |
| `mood` | str | `"great"` \| `"ok"` \| `"rough"` \| null |
| `created_at` | str | ISO datetime |

### `Subscription` (Phase 9)
| Field | Type | Notes |
|-------|------|-------|
| `id` | int PK | |
| `name` | str | |
| `url` | str | .ics feed URL |
| `timeline_id` | int | target Calendar id |
| `refresh_minutes` | int | default 360 |
| `last_synced` | str | ISO datetime, null until first sync |
| `last_error` | str | last error message, null on success |
| `enabled` | bool | |

### `Course` (Phase 8)
| Field | Type | Notes |
|-------|------|-------|
| `id` | int PK | |
| `name` | str | |
| `code` | str | e.g. "CS107" |
| `instructor` | str | |
| `syllabus_path` | str | local file path |
| `timeline_id` | int | default Calendar for this course |
| `grade_weights` | str | JSON `[{"name":"Midterm","weight":30},...]` |
| `color` | str | hex |

### `Assignment` (Phase 8)
| Field | Type | Notes |
|-------|------|-------|
| `id` | int PK | |
| `course_id` | int | indexed |
| `title` | str | |
| `due_date` | str | ISO date |
| `weight_category` | str | references `grade_weights[].name` |
| `score` | float | null until graded |
| `max_score` | float | |
| `event_id` | int | if scheduled on calendar |

### `EventEmbedding` (Phase 6)
| Field | Type | Notes |
|-------|------|-------|
| `event_id` | int PK | |
| `vector` | bytes | numpy float32 via `tobytes()` |
| `model` | str | default `"all-MiniLM-L6-v2"` |
| `updated_at` | str | ISO datetime |

### `InboxItem` (Phase 4)
| Field | Type | Notes |
|-------|------|-------|
| `id` | int PK | |
| `text` | str | |
| `created_at` | str | ISO datetime |
| `proposed_start` | str | ISO datetime, null until proposed |
| `proposed_duration` | int | minutes, null until proposed |
| `scheduled_event_id` | int | set after scheduling |
| `archived` | bool | soft-delete / scheduled flag |

### `Peer` (Phase 14a)
| Field | Type | Notes |
|-------|------|-------|
| `id` | int PK | |
| `name` | str | user-given device name |
| `cert_fingerprint` | str | SHA-256 hex of peer's TLS cert |
| `last_seen` | str | ISO datetime of last successful sync |
| `created_at` | str | ISO datetime |

### `DeviceConfig` (Phase 14c)
| Field | Type | Notes |
|-------|------|-------|
| `id` | int PK | single-row table |
| `device_id` | str | UUID assigned at first boot |

### `Account` (v2.2 — identity-only mirror of Supabase user)
| Field | Type | Notes |
|-------|------|-------|
| `id` | str PK | always literal `"me"` — enforces single row |
| `supabase_user_id` | str | UUID from Supabase. Foreign reference only — no token data |
| `email` | str | display email; not used as a join key elsewhere |
| `display_name` | str | editable from Settings → Account |
| `auth_provider` | str | `google` \| `apple` \| `microsoft` \| `email` (never `caldav` — those are connections) |
| `created_at` | str | ISO datetime |
| `last_login_at` | str | updated on every successful Supabase token refresh |

### `Connection` (v2.2 — provider link, e.g. Google / iCloud)
| Field | Type | Notes |
|-------|------|-------|
| `id` | str PK | UUID. Keychain slot suffix: `connection.{id}` |
| `kind` | str | `google` \| `caldav_icloud` \| `caldav_generic` |
| `display_name` | str | e.g. "Google — sam@workspace.com" |
| `account_email` | str | provider-side email |
| `caldav_base_url` | str | null for Google |
| `status` | str | `connected` \| `paused` \| `auth_expired` \| `error` |
| `last_synced_at` | str | UTC of last successful cycle |
| `last_error` | str | cleared on next successful cycle |
| `created_at` | str | |

### `ConnectionCalendar` (v2.2 — M:N join with per-pair sync state)
| Field | Type | Notes |
|-------|------|-------|
| `id` | str PK | UUID |
| `connection_id` | str FK | → `Connection.id`. CASCADE on delete |
| `local_calendar_id` | int | → `Calendar.id`. Nulled on disconnect (events become local-only) |
| `remote_calendar_id` | str | Google: calendarId. CalDAV: collection href |
| `remote_display_name` | str | cached for the disconnect screen + Sync Center |
| `sync_direction` | str | `both` \| `pull` \| `push`. Default `both` |
| `sync_token` | str | Google incremental cursor; null forces full resync |
| `caldav_ctag` | str | CalDAV collection-level cursor |
| `last_full_sync_at` | str | |
| `created_at` | str | |
| | | UNIQUE INDEX `(connection_id, remote_calendar_id)` — a remote calendar can only sync to one local timeline |

### `SyncReviewItem` (v2.2 — the queue surfaced at /calendar/sync-review)
| Field | Type | Notes |
|-------|------|-------|
| `id` | str PK | UUID |
| `connection_calendar_id` | str FK | |
| `kind` | str | `incoming_duplicate` \| `bidirectional_conflict` \| `push_rejected` |
| `local_event_id` | int | null on push_rejected of a deleted local |
| `incoming_payload` | str | JSON — provider event normalized to LoomAssist shape |
| `match_score` | float | 0.0–1.0; null for non-duplicate kinds |
| `match_reasons` | str | JSON array of `{field, similarity, value_local, value_incoming}` — drives the merge UI |
| `created_at` | str | |
| `resolved_at` | str | null = pending. The Sync Review page is `WHERE resolved_at IS NULL` |
| `resolution` | str | `approved_new` \| `merged` \| `rejected` \| `replaced_local` \| `ignored_forever` |
| `resolution_payload` | str | JSON — what we actually wrote (audit log + undo) |

### `SyncIgnoreRule` (v2.2 — per-connection denylist for "Reject & remember")
| Field | Type | Notes |
|-------|------|-------|
| `id` | int PK | autoincrement |
| `connection_id` | str FK | per-connection scope |
| `incoming_hash` | str | SHA-256 of `(remote_calendar_id + external_id + start_iso + title)` |
| `created_at` | str | |
| | | INDEX `(connection_id, incoming_hash)` |

## Backend API Routes

### Events
| Method | Path | Description |
|--------|------|-------------|
| GET | `/events/` | List all events |
| POST | `/events/` | Create event; auto-infers reminder if not set; returns `{ event, conflicts }` |
| PUT | `/events/{id}` | Update event; returns `{ event, conflicts, dependents[] }` |
| DELETE | `/events/{id}` | Delete event; nullifies dependents' `depends_on_event_id` |
| POST | `/events/check-conflicts` | Dry-run conflict check; returns `{ conflicts }` |
| POST | `/events/{id}/cascade-dependents` | Recompute and apply times for all dependent events |

### Smart Scheduling
| Method | Path | Description |
|--------|------|-------------|
| POST | `/schedule/find-free` | Find up to 5 free slots on 15-min boundaries |
| POST | `/schedule/analyze` | Wellness analysis; returns `{ warnings: string[] }` |
| POST | `/schedule/resolve-conflict` | AI suggests up to 3 rescheduling alternatives |
| POST | `/schedule/autopilot` | Auto-schedule tasks into free slots; returns `{ proposals, overflow }` |

### NLP / AI
| Method | Path | Description |
|--------|------|-------------|
| POST | `/parse/datetime` | Natural language → ISO datetime via Ollama |
| POST | `/ai/voice` | Transcribe audio → intent + event |
| POST | `/ai/intent` | Parse intent from text |
| POST | `/intent/apply` | Apply a voice intent (move/cancel/resize) after confirmation |
| POST | `/ai/infer-reminder` | Suggest reminder minutes for an event title |
| POST | `/ai/weekly-review` | Ollama narrative of past week + journal reflections |

### Semantic Search (Phase 6)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/search/semantic?q=...&k=10` | Cosine similarity search; returns `{ results: [{event, score}] }` |
| POST | `/search/reindex` | Re-embed all events (first-run / model upgrade) |

### Journal (Phase 12)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/journal` | Multipart: audio → Whisper transcription → saved entry |
| GET | `/journal?from_date=...&to_date=...` | List entries with optional date filter |
| DELETE | `/journal/{id}` | Delete entry |

### Inbox (Phase 4)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/inbox` | List non-archived items, newest first |
| POST | `/inbox` | Create item |
| POST | `/inbox/{id}/propose` | AI proposes a time slot |
| POST | `/inbox/{id}/schedule` | Create event and archive item |
| DELETE | `/inbox/{id}` | Soft-delete (set `archived=True`) |

### Courses & Assignments (Phase 8)
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/courses` | List / create courses |
| GET/PUT/DELETE | `/courses/{id}` | Read / update / delete course |
| GET | `/courses/{id}/grade` | Weighted grade calculation |
| GET/POST | `/assignments` | List / create assignments |
| GET/PUT/DELETE | `/assignments/{id}` | Read / update / delete assignment |

### iCal Subscriptions (Phase 9)
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/subscriptions` | List / create |
| GET/PUT/DELETE | `/subscriptions/{id}` | Read / update / delete |
| POST | `/subscriptions/{id}/refresh` | Fetch URL, upsert events, update `last_synced` |

### Backup (Phase 13)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/backup/export` | AES-256-GCM encrypted `.loombackup` download |
| POST | `/backup/import` | Decrypt, validate, atomic DB swap (pre-restore safety copy) |
| GET | `/admin/backup` | Plain SQLite file download (legacy) |
| POST | `/admin/restore` | Plain file restore (legacy) |

### LAN Sync (Phase 14)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/pair/start` | Generate self-signed cert + 6-digit OTP (5-min TTL) |
| POST | `/pair/complete` | Validate code, store peer |
| GET | `/pair/peers` | List paired devices |
| DELETE | `/pair/peers/{id}` | Remove peer |
| GET | `/discovery/peers` | mDNS-discovered peers not yet paired |
| POST | `/sync/exchange` | Return records modified after `since` watermark |
| POST | `/sync/apply` | Inbound sync — last-write-wins by `last_modified` |
| POST | `/sync/now/{peer_id}` | Manual sync trigger |

### Cloud Auth (v2.2 — identity-only)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/oauth/{provider}/start` | Begin OAuth via Supabase. Returns `{auth_url}`; provider ∈ google · apple · microsoft |
| POST | `/auth/oauth/complete` | Frontend forwards Supabase access_token from URL fragment; backend upserts `Account` |
| POST | `/auth/email/signup` | Email + password signup via Supabase |
| POST | `/auth/email/login` | Email + password login |
| POST | `/auth/email/reset` | Trigger Supabase password-reset email |
| GET  | `/auth/me` | Read current `Account`. **204** in local-only mode |
| PATCH | `/auth/me` | Edit `display_name` only (email is read-only at the provider) |
| POST | `/auth/logout` | Clear `Account` row. Connections + Events untouched (§11 R5) |

### Cloud Connections (v2.2)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/connections` | List all connections with status + last_error |
| POST | `/connections/google/start` | Returns `{auth_url}` for Google Calendar OAuth |
| POST | `/connections/google/complete` | Exchange the auth code; insert `Connection`; stash refresh_token in keychain bridge |
| POST | `/connections/caldav/test` | PROPFIND validate creds without saving (used by the inline Test button) |
| POST | `/connections/caldav` | Create a CalDAV connection (kind: `caldav_icloud` \| `caldav_generic`) |
| POST | `/connections/{id}/token` | Frontend pushes a Keychain-stored token into the runner's bridge cache |
| GET | `/connections/{id}/calendars` | List remote calendars on the connection (used by SubscribeDrawer) |
| POST | `/connections/{id}/subscribe` | Create a `ConnectionCalendar`; auto-creates a local timeline if `local_calendar_id` omitted |
| DELETE | `/connections/{id}/calendars/{cc_id}` | Unsubscribe from one remote calendar; nulls out events bound to this cc |
| PATCH | `/connections/{id}/calendars/{cc_id}` | Edit `sync_direction` or swap `local_calendar_id` |
| POST | `/connections/{id}/pause` | Set `status=paused`. Runner skips paused connections |
| POST | `/connections/{id}/resume` | Set `status=connected`; trigger an immediate cycle |
| DELETE | `/connections/{id}` | Full disconnect. Body: `{timelines: [{local_calendar_id, strategy: keep|move|delete, target_id?}]}`. **Non-destructive locally** |

### Cloud Sync (v2.2 — distinct namespace from LAN sync)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/sync/run` | Run all enabled connections now. Returns `{started: [conn_id]}` |
| POST | `/sync/run/{connection_id}` | Single-connection trigger (used by Sync Center 'Sync now') |
| GET | `/sync/status` | Per-connection `{status, last_synced_at, last_error, pending_review_count}` |
| GET | `/sync/events` | **SSE stream** of `{conn_id, phase, review_count?, last_synced_at?}`. SyncCenter subscribes once on mount; reconnects with backoff |

### Sync Review (v2.2 — the queue)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/sync/review?connection_id=&kind=&limit=&cursor=` | List pending items joined with connection display name |
| GET | `/sync/review/{id}` | Single item with full `incoming_payload` + `match_reasons` for the merge modal |
| POST | `/sync/review/{id}/approve` | Apply incoming as a NEW local event ("these are different events") |
| POST | `/sync/review/{id}/merge` | Body `{merged_payload}`; writes user-chosen field values to the candidate |
| POST | `/sync/review/{id}/replace-local` | Use incoming wholesale; overwrite local |
| POST | `/sync/review/{id}/reject` | Body `{remember: bool}`. If remember, writes `SyncIgnoreRule` |
| POST | `/sync/review/bulk` | Body `{item_ids: [], action: 'approve'|'reject'|'merge_default'}`. Used sparingly |

### Logs
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/logs` | Receive a frontend log batch |
| GET | `/api/logs/crash-flag` | Check if a crash was detected; clears flag on read |
| GET | `/api/logs/export` | Download last 500 log lines |
| DELETE | `/api/logs` | Clear the log file |

### Availability
| Method | Path | Description |
|--------|------|-------------|
| POST | `/availability` | Create availability request, returns share URL |
| GET | `/availability/{token}` | Fetch request by token |
| POST | `/availability/{token}/confirm` | Recipient confirms slot → auto-creates Event |
| POST | `/availability/{token}/amend` | Recipient proposes different slot |
| POST | `/availability/{token}/respond-amendment` | Sender accepts/declines/counters |
| GET | `/availability/{token}/view` | Serves `availability_receiver.html` to recipient |

## Frontend Architecture

**Source root** is `frontend-ui/src/src/` (double `src/` — the outer one is the Tauri project root).

**Pages** — `CalendarPage`, `TaskBoardPage`, `FocusPage`, `InboxPage`, `CoursesPage`, `JournalPage`, `SettingsPage`. v2.2 adds: `SignInPage`, `OnboardingPage`, `AccountSettingsPage`, `ConnectionsSettingsPage`, `ConnectionDetailPage`, `SyncReviewPage`. Each shell page exports a sidebar content component (e.g. `JournalSidebarContent`) that `App.tsx` mounts in `ContextSidebar`.

**v2.2 routing layout:** `<App/>` mounts an outer `<Routes>` with two full-bleed routes (`/auth/sign-in`, `/onboarding`) that bypass `<Shell/>` entirely (no app drawer / no top bar). Everything else routes through `<Shell/>`. Inside Shell:
- `/calendar/sync-review` → `<SyncReviewPage/>` — sub-route of Calendar (drawer + sidebar still visible).
- `/settings/account` → `<AccountSettingsPage/>`.
- `/settings/connections` → `<ConnectionsSettingsPage/>`.
- `/settings/connections/:id` → `<ConnectionDetailPage/>`.
- `/settings#appearance|keybindings|data|lan-sync` — flat Settings with anchor scroll-to.

The `pathRoot` lookup in `Shell` strips sub-routes (`/calendar/sync-review` → `/calendar`) so the destination context (drawer highlight + sidebar content) stays correct.

**API client** — `api.ts` exports typed functions using a shared `req<T>()` helper. All calls go to `http://localhost:8000`. Add new API functions here using the same pattern:
```ts
export const myFn = (arg: string): Promise<MyType> =>
  req('POST', '/my-route', { arg });
```
For multipart or binary responses (backup export, journal audio), use raw `fetch()` — `req()` only handles JSON.

**State is split across six systems:**

| System | File | Purpose |
|--------|------|---------|
| AccountContext (v2.2) | `contexts/AccountContext.tsx` | `{account?, status: 'loading'|'signedIn'|'local'|'error', signIn*, signOut, refresh}`. Reads `GET /auth/me` on boot. Local mode is a first-class state, not an error |
| SyncContext (v2.2) | `contexts/SyncContext.tsx` | `{connections, statuses, reviewCount, runAll, runOne, pause, resume}`. Owns the `EventSource` on `/sync/events`; reconnects with backoff. Window-focus listener fires `/sync/run` if any connection is stale > 60s (§11 R8) |
| ModalContext | `contexts/ModalContext.tsx` | Controls which modal is open + its props |
| UndoContext | `contexts/UndoContext.tsx` | 50-step undo/redo stack |
| CalendarNavContext | `contexts/CalendarNavContext.tsx` | Active view + date; bridges TopBar ↔ FullCalendar |
| Notifications | `store/notifications.tsx` | Pub/sub store (not React context). v2.2 adds `collapseKey` aggregation: ≥3 notifications sharing a key collapse into a single summary row |

**Provider order in `App.tsx`** (outer → inner): `BrowserRouter > AccountProvider > NotificationsProvider > SyncProvider > UndoProvider > ModalProvider > CalendarNavProvider`. SyncContext consumes notifications, so it must be inside NotificationsProvider.

**Modal system** — `ModalContext` holds `{ name: ModalName; props: Record<string, unknown> }`. `ModalRoot.tsx` switches on `modal.name` and renders the component. To add a new modal:
1. Add its name to the `ModalName` union in `ModalContext.tsx`
2. Add an opener function to `ModalContextValue` and implement it in the provider
3. Register it in `ModalRoot.tsx`
4. Wrap the component in `<ModalShell>` and `<ModalFooter>` from `./ModalShell`

Current modal names: `event-editor`, `availability`, `availability-response`, `ics-import`, `syllabus`, `settings`, `timeline-editor`, `template-editor`, `weekly-review`, `study-block`, `time-block-template`, `autopilot-review`, `sync-merge` (v2.2), `provider-picker` (v2.2), `caldav-credentials` (v2.2), `subscribe-drawer` (v2.2).

**Notification system** — non-React pub/sub in `store/notifications.tsx`. Call `addNotification({ type, title, message, autoRemoveMs?, collapseKey? })` from anywhere — no hook needed. Types: `info` | `success` | `warning` | `error` | `progress`. Actionable notifications accept `actionLabel` + `actionFn`. v2.2: pass `collapseKey` (e.g. the connection's display name) to coalesce noisy sources — three or more sharing a key collapse into a single summary row.

**Undo system** — `useUndo().push({ label, undo, redo })` where both functions are `async () => void`. Trim any existing redoable future entries when pushing. Wired to Cmd+Z / Shift+Z globally.

**App destinations** — the `Destination` type is exported from `AppDrawer.tsx` (not defined locally in `App.tsx`). Current destinations: `calendar`, `tasks`, `focus`, `inbox`, `courses`, `journal`, `settings`. v2.2 added several **sub-routes** (Sync Review under Calendar; Account / Connections / Connection Detail under Settings) — these don't change the drawer geometry; the path-root lookup keeps the destination context unchanged.

**Voice intent flow** — `App.tsx:handleMic()` records via `MediaRecorder`, calls `transcribeAudio()`, then iterates `execution_results`. Non-create intents (`move_event`, `cancel_event`, `resize_event`) that return `status: "pending_confirm"` trigger actionable notification toasts. Confirmed intents call `applyVoiceIntent()` then reload the calendar via `setReloadKey`.

**Semantic search** — toggled by `semanticEnabled` state in `App.tsx`. When on, `TopBar`'s search bar routes queries to `/search/semantic` and results appear as notifications. The toggle icon is rendered next to the search bar.

**DragShader** — `components/calendar/DragShader.tsx` injects a `<style>` tag that tints `.fc-event-mirror` and `.fc-highlight` based on whether the dragged slot overlaps existing events (red = conflict, green = free). v2.2 adds a second mode keyed off `selectRange` for drag-to-create: overlapping selections render with a 2px `--warning` left edge.

**TodayLineFreshness** (v2.2) — `components/calendar/TodayLineFreshness.tsx` renders a small monochrome "synced 3m ago" pill in the top-right of the calendar surface. Only shown in `Day`/`Week` views and only when at least one connection has a `last_synced_at`. Refreshes every 30s. Hidden in local-only mode.

**SyncCenter** (v2.2) — `components/topbar/SyncCenter.tsx` is the popover that **replaces the static sync indicator** in the top bar's right cluster. Per-connection rows with status pill, last-synced relative time, sync-now / pause / resume buttons, and a thin animated progress bar (`progressShimmer`) — the only ambient animation v2.2 introduces. Tab-trapped; Esc + click-outside close it.

**AccountAvatar** (v2.2) — `components/topbar/AccountAvatar.tsx`, rightmost element in the top bar. Shows a greyscale initials chip in local mode and an indigo-tinted avatar when signed in. Click → `/settings/account`.

**SourceBadge** (v2.2) — `components/shared/SourceBadge.tsx`. Renders a single monochrome glyph + connection display name + "synced 2m ago". Mounts in two places only: (a) the bottom of `QuickPeek` (variant `inline`), (b) the metadata cluster in `EventEditorModal` (variant `editor`, with an inline link to the connection's settings page). **Never** on the event pill — the pill anatomy is sacred per the Guardrail.

**Keychain bridge** — `lib/keychain.ts` wraps the Tauri commands defined in `src-tauri/src/lib.rs` (`keychain_set`, `keychain_get`, `keychain_delete`) using the `keyring = "3"` crate. Slot format: `com.loomassist.{kind}` where kind is `supabase` or `connection.{uuid}`. In the Vite browser preview (no Tauri), the wrapper falls back to `sessionStorage` so flows still work end-to-end during dev.

**Year view** — custom React component at `components/calendar/YearView.tsx`. Not rendered by FullCalendar. Scroll-wheel on the root div navigates years.

**DensityHeatmap** — shared component at `components/shared/DensityHeatmap.tsx`. Used on the Task Board sidebar.

**Calendar sidebar filters** — collapsible via chevron toggle (`filtersOpen` state). Default open.

**Scroll-wheel navigation** — `CalendarPage.tsx`: Ctrl/Cmd+scroll zooms granularity; plain scroll on `dayGridMonth`/`listWeek` navigates periods. Time-grid views let native scrolling pass through.

**Pomodoro ↔ Tray** — `FocusPage/PomodoroPanel.tsx` emits a Tauri event `pomodoro-state-change` via `window.__TAURI_INTERNALS__.emit` on phase transitions; the Rust tray listener updates the menu item label.

**Tauri commands (v2.2)** — `src-tauri/src/lib.rs` registers three new commands via the `keyring` crate:
- `keychain_set(slot, value)` / `keychain_get(slot)` / `keychain_delete(slot)` — all scoped to service `com.loomassist` so iCloud / Google tokens live alongside other LoomAssist secrets and survive backend restarts (the `services/sync/keychain_bridge.py` shell-out fallback uses the same service name).

## Event Expansion (Non-Obvious)

Recurring events are **stored as a single DB row** but expanded client-side by `lib/eventUtils.ts:toFCEvents()`:
- Iterates cursor from `start_time` to `recurrence_end` (falls back to +1 year)
- Checks `recurrence_days` (comma-sep 0–6) for weekday inclusion
- Applies per-day times from `per_day_times` JSON
- Skips dates in `skipped_dates`
- Each occurrence gets id `"${event.id}_${dateStr}"` and carries `instanceDate` in `extendedProps`

The full `Event` object lives at `info.event.extendedProps.event` inside FullCalendar's `eventContent` renderer.

## CSS Conventions

- CSS Modules per component, no global utility classes except `loom-field`, `loom-btn-primary`, `loom-btn-ghost`
- Design tokens in `styles/tokens.css`: `--bg-main`, `--bg-panel`, `--bg-elevated`, `--border`, `--border-strong`, `--text-main`, `--text-muted`, `--accent` (#6366f1), `--error`, `--success`
- Dark mode is default; light mode toggled via `body.light-mode` class + localStorage `loom-theme`

## Backend Test Setup Pattern

Because `main.py` calls `run_migrations()` and instantiates `WhisperModel` at module level, tests must patch the DB engine and stub heavy imports **before** importing `main`:

```python
import sys
from unittest.mock import MagicMock
from sqlmodel import create_engine, Session, SQLModel
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

import database.database as _db
_TEST_ENGINE = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
_db.engine = _TEST_ENGINE
_db.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_TEST_ENGINE)

sys.modules.setdefault("faster_whisper", MagicMock())
sys.modules["faster_whisper"].WhisperModel = MagicMock(return_value=MagicMock())
sys.modules.setdefault("ollama", MagicMock())
sys.modules.setdefault("pypdf", MagicMock())
sys.modules["pypdf"].PdfReader = MagicMock()
sys.modules.setdefault("sentence_transformers", MagicMock())
sys.modules.setdefault("zeroconf", MagicMock())

from main import app, get_db
from fastapi.testclient import TestClient

app.dependency_overrides[get_db] = lambda: (yield Session(_TEST_ENGINE))
client = TestClient(app)
```

Always use `@pytest.fixture(autouse=True)` to call `SQLModel.metadata.create_all` / `drop_all` around each test. See `tests/test_duration.py` for the full reference implementation.

**Run each test file in isolation** — never `pytest tests/` together:
```bash
cd backend-api && pytest tests/test_journal.py -v
cd backend-api && pytest tests/test_backup.py -v
cd backend-api && pytest tests/test_sync.py -v        # LAN sync (Phase 14)
cd backend-api && pytest tests/test_auth.py -v        # v2.2 cloud identity
cd backend-api && pytest tests/test_dedup.py -v       # v2.2 fuzzy matcher
cd backend-api && pytest tests/test_ics_normalize.py -v # v2.2 iCal roundtrip
cd backend-api && pytest tests/test_connections.py -v # v2.2 connection CRUD + non-destructive disconnect
cd backend-api && pytest tests/test_sync_review.py -v # v2.2 review item lifecycle
```

**v2.2 test setup additions** — when the test stubs heavy modules, also stub `caldav` so importing `services/sync/caldav.py` doesn't pull the real library:

```python
sys.modules.setdefault("caldav", MagicMock())
```

The dedup tests (`test_dedup.py`) need the real `rapidfuzz` package because the matcher's pure-function fallback uses simple Jaccard which doesn't match `token_set_ratio`'s output. Install via `pip install rapidfuzz`.
