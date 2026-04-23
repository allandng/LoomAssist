# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This App Is

LoomAssist is a **local-first desktop calendar app** (Tauri 2 + React 19 + FastAPI). All data and AI inference run on-device. The architecture is two processes that must both be running during development:

- **Backend** — FastAPI on `localhost:8000`, SQLite at `backend-api/loom.sqlite3`
- **Frontend** — Tauri/Vite app, communicates with backend via plain HTTP

## Tech Stack

### Backend (`backend-api/`)
| Layer | Technology |
|-------|-----------|
| Framework | FastAPI 0.135 |
| ORM / DB | SQLModel 0.0.37 (Pydantic + SQLAlchemy) |
| Database | SQLite (`loom.sqlite3`) |
| Speech-to-Text | Faster-Whisper 1.2 (base.en, int8, CPU) |
| Local LLM | Ollama + Llama 3.2 |
| PDF parsing | PyPDF 6.9 |
| HTTP client | httpx 0.28 |
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
```

## Testing & Linting

```bash
# Backend tests (pytest) — run all tests
cd backend-api && pytest tests/ -v

# Run a single test file or single test
cd backend-api && pytest tests/test_duration.py -v
cd backend-api && pytest tests/test_duration.py::TestClockRoute::test_clock_in_sets_actual_start -v

# New tests (run in isolation — cross-file DB engine patching causes ordering conflicts)
cd backend-api && pytest tests/test_find_free_quantized.py -v   # 15-min quantization + travel_time
cd backend-api && pytest tests/test_location_travel_time.py -v  # location/travel_time field round-trips

# Frontend lint
cd frontend-ui/src && npm run lint

# Frontend type check
cd frontend-ui/src && npm run build   # tsc + vite build

# Frontend unit tests (Vitest)
cd frontend-ui/src && npm run test
cd frontend-ui/src && npm run test:watch
```

## Backend Architecture

**Single file** — `backend-api/main.py` (1200+ lines) contains all routes, Pydantic request models, and business logic. There is no service layer; keep new routes in `main.py`.

**Database session pattern** — all routes use `db: Session = Depends(get_db)` where `get_db` yields a SQLAlchemy `SessionLocal`. Use `db.query(Model).filter(...).first()` — the codebase uses SQLAlchemy ORM style throughout, not SQLModel's `db.exec(select(...))`.

**Migrations** — `database/database.py:run_migrations()` runs on every boot. To add a column to an existing table, add it to the `new_columns` dict inside the PRAGMA-check block for that table. New columns are added idempotently.

**New backend routes go in this order in main.py:**
1. Pydantic request/response models (class declarations)
2. Route function(s) immediately after

**AI integration** — Ollama (`llama3.2`) for NLP, `faster_whisper` for STT. Both are called via HTTP/library inside async route handlers, not at startup (except `WhisperModel("base.en")` which is instantiated at module level on line ~75).

## Database Schema

Five SQLModel tables in `backend-api/database/models.py`:

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
| `external_uid` | str | duplicate prevention (ICS imports) |
| `timezone` | str | default `'local'` |
| `is_all_day` | bool | |
| `skipped_dates` | str | comma-sep YYYY-MM-DD exceptions |
| `per_day_times` | str | JSON `{"1":["09:00","11:00"],...}` |
| `checklist` | str | JSON `[{"text":"...","done":false},...]` |
| `actual_start` | str | ISO datetime — clock-in timestamp |
| `actual_end` | str | ISO datetime — clock-out timestamp |
| `location` | str | free-text venue/address |
| `travel_time_minutes` | int | commute buffer; subtracted from event start in free-slot search |

### `Calendar` (Timeline)
| Field | Type | Notes |
|-------|------|-------|
| `id` | int PK | |
| `name` | str | indexed |
| `description` | str | |
| `color` | str | hex, default `#6366f1` |

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

## Backend API Routes

### Events
| Method | Path | Description |
|--------|------|-------------|
| GET | `/events/` | List all events |
| POST | `/events/` | Create event; returns `{ event, conflicts }` |
| PUT | `/events/{id}` | Update event; returns `{ event, conflicts }` |
| DELETE | `/events/{id}` | Delete event |
| POST | `/events/check-conflicts` | Dry-run conflict check; returns `{ conflicts }` |

### Smart Scheduling
| Method | Path | Description |
|--------|------|-------------|
| POST | `/schedule/find-free` | Find up to 5 free slots on 15-min boundaries; body: `{ window_start, window_end, duration_minutes, working_hours_start, working_hours_end }`; busy windows expand backward by each event's `travel_time_minutes` |
| POST | `/schedule/analyze` | Wellness analysis; body: `{ events: [{title, start_time, end_time}] }`; returns `{ warnings: string[] }` |

### NLP / AI
| Method | Path | Description |
|--------|------|-------------|
| POST | `/parse/datetime` | Natural language → ISO datetime via Ollama; body: `{ input }`; returns `{ iso, display }` |
| POST | `/ai/voice` | Transcribe audio → intent; returns `{ text, event? }` |
| POST | `/ai/intent` | Parse intent from text |

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

**API client** — `api.ts` exports typed functions using a shared `req<T>()` helper. All calls go to `http://localhost:8000`. Add new API functions here using the same pattern:
```ts
export const myFn = (arg: string): Promise<MyType> =>
  req('POST', '/my-route', { arg });
```

**State is split across four systems:**

| System | File | Purpose |
|--------|------|---------|
| ModalContext | `contexts/ModalContext.tsx` | Controls which modal is open + its props |
| UndoContext | `contexts/UndoContext.tsx` | 50-step undo/redo stack |
| CalendarNavContext | `contexts/CalendarNavContext.tsx` | Active view + date; bridges TopBar ↔ FullCalendar |
| Notifications | `store/notifications.tsx` | Pub/sub store (not React context) |

**Modal system** — `ModalContext` holds `{ name: ModalName; props: Record<string, unknown> }`. `ModalRoot.tsx` switches on `modal.name` and renders the component. To add a new modal:
1. Add its name to the `ModalName` union in `ModalContext.tsx`
2. Add an opener function to `ModalContextValue` and implement it in the provider
3. Register it in `ModalRoot.tsx`
4. Wrap the component in `<ModalShell>` and `<ModalFooter>` from `./ModalShell`

**Notification system** — non-React pub/sub in `store/notifications.tsx`. Call `addNotification({ type, title, message, autoRemoveMs? })` from anywhere — no hook needed. Types: `info` | `success` | `warning` | `error` | `progress`.

**Undo system** — `useUndo().push({ label, undo, redo })` where both functions are `async () => void`. Trim any existing redoable future entries when pushing. Wired to Cmd+Z / Shift+Z globally.

**Year view** — custom React component at `components/calendar/YearView.tsx`. Props: `events`, `onDayClick` (switches to Day view), `onMonthClick` (switches to Month view). Clicking the month-name button at the top of each mini-calendar triggers `onMonthClick`. Scroll-wheel on the root div navigates years. Not rendered by FullCalendar.

**DensityHeatmap** — extracted shared component at `components/shared/DensityHeatmap.tsx`. Renders a month-at-a-glance event density grid with a 5-level color legend bar (hmL0–hmL4). Used on the Task Board sidebar; no longer in the Calendar sidebar.

**Calendar sidebar filters** — filter list is collapsible via a chevron toggle (`filtersOpen` state). Default open. Same chevron pattern as the Find Free Time section.

**Scroll-wheel navigation** — the `wheel` handler in `CalendarPage.tsx` handles two cases: Ctrl/Cmd+scroll zooms view granularity (month→week→day); plain scroll on `dayGridMonth`/`listWeek` navigates prev/next period. Time-grid views (`timeGridWeek`, `timeGridDay`) let native hour-scrolling pass through.

## Event Expansion (Non-Obvious)

Recurring events are **stored as a single DB row** but expanded into multiple FullCalendar events client-side by `lib/eventUtils.ts:toFCEvents()`. The expansion logic:
- Iterates a cursor from `start_time` to `recurrence_end` (falls back to +1 year)
- Checks `recurrence_days` (comma-sep 0–6) to decide which weekdays to include
- Applies per-day times from `per_day_times` (JSON `{"0":{"start":"09:00","end":"17:00"}}`)
- Skips dates in `skipped_dates` (comma-sep YYYY-MM-DD)
- Each occurrence gets id `"${event.id}_${dateStr}"` and carries `instanceDate` in extendedProps

The full `Event` object is stored at `info.event.extendedProps.event` inside FullCalendar's `eventContent` renderer — so `EventPill` accesses all fields via `ev.field`.

## CSS Conventions

- CSS Modules per component, no global utility classes except `loom-field`, `loom-btn-primary`, `loom-btn-ghost`
- Design tokens in `styles/tokens.css`: `--bg-main`, `--bg-panel`, `--bg-elevated`, `--border`, `--border-strong`, `--text-main`, `--text-muted`, `--accent` (#6366f1), `--error`, `--success`
- Dark mode is default; light mode toggled via `body.light-mode` class + localStorage `loom-theme`

## Backend Test Setup Pattern

Because `main.py` calls `run_migrations()` and instantiates `WhisperModel` at module level, tests must patch the DB engine and stub heavy imports **before** importing `main`:

```python
import sys
from unittest.mock import MagicMock
from sqlmodel import create_engine, Session
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
# httpx is used for Ollama HTTP calls in route handlers — mock if needed in specific tests:
# from unittest.mock import patch
# with patch("httpx.post") as mock_post: ...

from main import app, get_db
from fastapi.testclient import TestClient

app.dependency_overrides[get_db] = lambda: (yield Session(_TEST_ENGINE))
client = TestClient(app)
```

Use `@pytest.fixture(autouse=True)` to call `SQLModel.metadata.create_all` / `drop_all` around each test. See `tests/test_duration.py` for the full reference implementation.
