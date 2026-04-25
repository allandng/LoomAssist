# 🧶 LoomAssist v2.2 — Privacy-First Local AI Calendar

LoomAssist is a local-first desktop calendar app for students and developers. All data and AI inference run on-device. Nothing leaves your machine — even when you connect a cloud calendar, sync runs **directly device ↔ provider**, never through a LoomAssist server.

---

## ✨ What's new in v2.2

- **☁️ Optional Cloud Identity** — sign in with Google · Apple · Microsoft · email. Identity-only — your email + display name are stored on Supabase and **nothing else ever leaves the device**. Local mode stays first-class; sign-in is always optional.
- **🔗 Direct Calendar Sync** — connect Google Calendar (OAuth) and any CalDAV server (iCloud, Fastmail, Nextcloud, generic) for two-way sync. OAuth tokens and CalDAV passwords live in the macOS Keychain, never SQLite.
- **🧪 Sync Review Queue** — every ambiguous match (fuzzy duplicates, two-sided edits, push rejections) is routed to a triage surface at `/calendar/sync-review`. Approve, merge field-by-field, replace local, or reject-and-remember. **Never silently merges.**
- **⧉ Sync Merge Modal** — three-column field diff (Local · Incoming · live Result preview) with per-field accept toggles. `↵` saves, `Esc` closes.
- **↻ Sync Center Popover** — top-bar status surface with per-connection rows: status pill, last-synced timestamp, sync-now / pause / resume actions, and a thin progress bar while a cycle is in flight. SSE-driven, reconnects with backoff.
- **🪄 Onboarding Wizard** — a 4-step first-launch flow (Welcome → Account → Connect → Subscribe). Every step has a working **Skip**; the wizard never blocks the local-mode app.
- **🪪 Source Badge** — synced events show a monochrome provider glyph + "synced 2m ago" in the QuickPeek hover card and in the Event Editor metadata cluster. The event pill itself stays untouched.
- **⚙️ Settings — Account & Connections** — new Account settings page with display-name edit and non-destructive sign-out. Connections page lists every linked provider; per-connection detail surfaces subscribed calendars, sync direction, pause/resume, and a non-destructive disconnect (events become local-only, never deleted; provider events untouched).
- **🟧 Drag-to-Create Conflict Edge** — drag-selecting on a busy range now shows a 2px warning left edge before the event is created.
- **🕒 Today-Line Freshness** — Day/Week views show a small "synced 3m ago" pill in the top-right when at least one connection exists. Hidden in local-only mode.
- **🔔 Bell Panel Collapse** — three or more sync notifications from the same connection collapse into a single summary row.
- **🗂️ Settings Two-Pane Layout** — Settings sidebar groups Account / App with section anchors; smooth-scroll to Appearance, Keybindings, Data, LAN Sync, etc.

---

## 🚀 Key Features

### Cloud sync (v2.2)
- **☁️ Cloud Identity (optional)** — Supabase Auth with Google · Apple · Microsoft · email/password. Identity is email + display name + provider IDs only. No event data ever traverses a LoomAssist server.
- **🔗 Direct Calendar Sync** — two-way sync with Google Calendar (OAuth) + any CalDAV server (iCloud, Fastmail, Nextcloud, generic). Tokens live in the macOS Keychain.
- **🧪 Sync Review Queue** — fuzzy duplicates (title ≥ 0.85 token-set ratio + start within 15 min + duration within 15 min) and two-sided edits become explicit decisions, never silent merges.
- **⧉ Sync Merge Modal** — three-column field-by-field diff with per-field accept toggles and a live result preview.
- **↻ Sync Center** — top-bar popover with per-connection status, last-synced freshness, sync-now / pause / resume, and an animated progress indicator during cycles. SSE-driven.
- **🪄 Onboarding Wizard** — first-launch 4-step setup (welcome → optional account → optional connection → calendar pick). Skip on every step.
- **🪪 Source Badge** — provenance glyph + connection name + freshness in QuickPeek + Event Editor only. Pill anatomy is sacred — never tinted by source.
- **🕒 Today-Line Freshness** — small monochrome "synced 3m ago" pill in time-grid views, hidden when no connections exist.
- **🛡️ Non-Destructive Disconnect** — disconnecting a provider keeps every local event; provider events are untouched. Events simply lose their sync metadata.

### Privacy & local-first
- **🎙️ Voice-to-Intent** — Faster-Whisper + Ollama transcribes speech and creates, moves, cancels, or resizes events from natural language
- **📅 Five Calendar Views** — Month, Week, Day, Year, and Agenda. Ctrl/Cmd+scroll cycles view granularity; plain scroll navigates dates in month and agenda views
- **🗓️ Year View** — Click a month name to jump to that month view; click a day to jump to day view. Scroll to navigate years
- **🔄 Advanced Recurring Events** — Weekly schedules with per-day times, skip-date exceptions, and per-occurrence description overrides
- **📍 Location & Travel Time** — Each event stores a location and optional travel time. The free-slot finder blocks the commute buffer automatically
- **🔍 Smart Scheduler** — Find up to 5 free slots in a rolling window; all slots land on :00/:15/:30/:45 boundaries. Slot duration is configurable
- **🟩 Conflict-Aware Drag Preview** — real-time red/green tint while dragging over busy or free slots
- **💡 Smart Conflict Resolution** — AI suggests up to 3 rescheduling alternatives with rationale when a conflict is detected
- **🤖 Adaptive Reminders** — Ollama infers reminder lead time from the event title; "Suggested" pill distinguishes AI from user-set reminders
- **📥 Quick-Capture Inbox** — `I` key drops unscheduled items into an inbox; AI proposes a time slot and calendar
- **🎙️ Voice-Driven Editing** — natural language event edits (move, cancel, resize) with confirmation toasts and undo support
- **🔍 Local Semantic Search** — sentence-transformers cosine similarity; toggle on the top bar, results show similarity %
- **🗓️ Time-Blocking Autopilot** — auto-schedules tasks by deadline and estimated duration; review and accept proposals before they're applied
- **🔀 Cross-Event Dependencies** — link events with time offsets; cascade moves recompute and update all dependents in one step
- **📋 Task Board** — Kanban grouping by status, priority, timeline, or due date. "Plan week" button launches the autopilot
- **🎯 Focus Mode** — Fullscreen Pomodoro session with today's events in a Kanban rail
- **📓 Voice Journal** — 60-second audio recordings with Whisper transcription, mood selector, and mood timeline chart
- **📚 Course Manager** — track courses, assignments, weighted grades, and syllabus events all in one place
- **🔗 iCal Subscription URLs** — auto-refreshing read-only calendar feeds with configurable interval and status badges
- **🗂️ Event Templates & Time Block Templates** — save reusable single events or full week schedules and apply them in one click
- **✅ Per-Event Checklists** — sub-tasks stored in the event; progress chip shown on the calendar grid
- **⏱️ Duration Tracking** — Clock in/out on any event; the Stats panel shows planned vs. actual time with delta highlighting
- **📚 Study Block Generator** — AI-assisted session scheduling from a subject and deadline date
- **📊 Weekly Review** — Ollama-powered narrative summary of the past and upcoming week, including journal reflections
- **📅 Appointment Scheduling** — Generate a shareable availability link; recipients confirm, decline, or counter-propose. Accepted slots auto-create events
- **📥 ICS Import / Export** — Bulk-import `.ics` calendars with duplicate prevention via `external_uid`. Export individual timelines
- **📄 Syllabus PDF Scanner** — AI extracts deadlines and events from uploaded PDFs and assigns them to a course
- **🔽 Collapsible Sidebar Filters** — Toggle filters via a chevron-controlled dropdown. Timelines, templates, and Smart Scheduler live in the same sidebar
- **⏪ Global Undo/Redo** — 50-step stack (Cmd/Ctrl+Z / Shift+Z), including cascade moves
- **⚠️ Wellness Warnings** — Ollama detects over-scheduled days and surfaces reminders for meals, breaks, and commute time
- **🔔 In-App Notifications** — Bell panel with info, success, warning, error, and progress types; actionable cards; auto-dismiss; unread badge
- **👁️ Quick-Peek Hover Card** — Rich event preview (time, timeline, description, checklist) on mouse-over without opening the editor
- **🖥️ macOS Menu-Bar Tray** — next event and Pomodoro state visible from the menu bar at all times
- **🔐 Encrypted Local Backup** — AES-256-GCM with scrypt key derivation; atomic encrypted restore with automatic pre-restore safety backup
- **📡 LAN Multi-Device Sync** — mDNS discovery, OTP pairing, and last-write-wins sync with tombstone deletes
- **📋 Structured Logging** — JSON log pipeline with rotating backend logs, batched frontend shipping, crash snapshots, and a log viewer
- **💾 Sync Status Indicator** — Live timestamp in the top bar; turns red on connection failure
- **🖱️ Multi-Select & Bulk Delete** — Drag across the grid to select; Delete/Backspace removes all selected events
- **🖨️ Print Week View** — Print-optimized layout opens in a new tab
- **🌗 Light / Dark Mode** — Toggle from Settings; persisted to localStorage
- **⌨️ Configurable Keybinds** — Rebind any shortcut from Settings with live key-capture UI

---

## 🛠️ Tech Stack

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
| Cloud auth (v2.2) | Supabase Auth REST (httpx — no SDK) |
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

---

## 📦 Installation & Setup

### Prerequisites
- [Ollama](https://ollama.com/) installed and running (`ollama pull llama3.2`)
- [Node.js](https://nodejs.org/) & [Rust](https://www.rust-lang.org/) (for Tauri/Cargo)
- Python 3.13

### 1. Backend
```bash
cd backend-api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 -m uvicorn main:app --reload
```

### 2. Frontend
```bash
cd frontend-ui
npm install
npm run tauri dev
```

### 3. Load demo data (optional)
```bash
cd backend-api && source venv/bin/activate && python3 seed_demo.py
```

Populates 4 calendars, 25 events, 13 tasks, 6 journal entries, 7 inbox items, 2 courses, 14 assignments, and 5 event templates across a realistic two-week window. Re-running the script resets everything cleanly.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `N` | New event |
| `T` | Jump to today |
| `1` | Month view |
| `2` | Week view |
| `3` | Day view |
| `4` | Year view |
| `5` | Agenda view |
| `[` / `]` | Previous / Next period |
| `B` | Toggle sidebar |
| `/` | Focus search bar |
| `F` | Toggle Focus Mode |
| `I` | Toggle Inbox panel |
| `Delete` | Delete selected event(s) |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Escape` | Close modal / dismiss dropdown |
| `Ctrl/Cmd+Scroll` | Zoom view granularity |
| `Scroll` | Navigate prev/next period (month/agenda views) |

All shortcuts are rebindable from **Settings → Keyboard Shortcuts**.

---

## 🗺️ Project Roadmap

### ✅ Completed (v1.x)
- FullCalendar interactive grid
- Local AI intent extraction (Ollama)
- Global search & filtering
- Custom timeline color picking
- ICS import / duplicate prevention
- Syllabus PDF scanning
- Hidable sidebar
- Timeline export (JSON/ICS)
- Global undo/redo stack
- Markdown links & @mention tagging
- Reminders & browser notifications
- Database backup, restore, & timezone handling
- Drag-and-drop rescheduling & resizing
- All-day and multi-day event support
- Per-day different times on recurring events
- Skip individual recurring event occurrences
- Per-event task checklists
- Event templates

### ✅ Completed (v2.0)
- Full React 19 + TypeScript rewrite (replaced vanilla JS)
- Task Board — Kanban grouping by timeline, due date, priority, status
- Focus Mode — fullscreen Pomodoro with today's events rail
- Wellness warnings via Ollama
- Usage statistics panel
- Daily agenda startup overlay
- Sync status indicator
- Unified search + quick-add bar
- Timeline rename and conditional delete
- Multi-select and bulk delete
- Print week view
- App drawer navigation strip
- In-app notification panel (bell, badge, progress, actionable cards)
- Appointment scheduling via shareable availability link
- Quick-peek hover card
- Structured full-stack logging (rotating JSON logs, crash snapshots)
- Year view
- Scroll-wheel date navigation
- Collapsible sidebar filter dropdown
- Activity heatmap with busy-level legend bar
- Duration tracking (clock in/out, planned vs. actual stats)
- Study block generator
- Weekly review
- Time block templates
- Find free time (15-min aligned slots)
- Event location field + travel time
- Light / Dark mode toggle
- Configurable keybinds

### ✅ Completed (v2.1)
- Adaptive AI reminders
- Conflict-aware drag preview
- Smart conflict resolution with AI suggestions
- Quick-capture inbox with AI time proposals
- Voice-driven event editing (move, cancel, resize)
- Local semantic search with sentence-transformers
- Time-blocking autopilot
- Course manager with weighted grade tracking
- iCal subscription URL auto-refresh
- Cross-event dependencies with cascade moves
- macOS menu-bar tray
- Voice journal with Whisper + mood tracking
- AES-256-GCM encrypted local backup
- LAN multi-device sync with mDNS + OTP pairing

### ✅ Completed (v2.2)
- Optional cloud identity via Supabase Auth (Google · Apple · Microsoft · email)
- Two-way Google Calendar sync (OAuth 2.0, incremental sync tokens, paginated initial pull)
- CalDAV sync — iCloud preset + generic CalDAV (Fastmail, Nextcloud, anything CalDAV)
- macOS Keychain storage for OAuth tokens & CalDAV passwords (Tauri `keyring` crate)
- Sync Review queue with `incoming_duplicate` / `bidirectional_conflict` / `push_rejected` kinds
- Sync Merge modal — three-column field-by-field diff with per-field accept + live preview
- Sync Center top-bar popover (SSE-driven, reconnect with backoff)
- Onboarding wizard (4 steps, Skip on every step)
- Provenance badge in QuickPeek + Event Editor (pill anatomy untouched)
- Settings → Account + Settings → Connections + Connection detail page
- Non-destructive disconnect (events stay local-only; provider untouched)
- Drag-to-create conflict warning edge
- Today-line synced freshness label
- Bell panel `collapseKey` to coalesce noisy sync notifications
- Sync Review keyboard shortcuts (`j`/`k`/`Enter`/`r`) via `useShortcuts`
- Sleep/wake refresh — fires `/sync/run` on window focus when stale > 60s
- Settings two-pane navigation with section anchors

### 🔜 Upcoming
- Microsoft Graph (Outlook) connection
- Tray-mode background sync (5-min cycles when window is closed)
- Bulk-merge UI beyond approve-all / reject-all
- One-key capture (Ctrl+L) — premium audio capture
- AI study guide / cheat sheet generator — premium
- Mobile app (iOS/Android)

---

## 📂 File Structure
```
LoomAssist/
├── backend-api/
│   ├── database/
│   │   ├── database.py        # DB engine, session, run_migrations()
│   │   └── models.py          # SQLModel table definitions (13 tables)
│   ├── services/
│   │   ├── scraper.py         # PDF/syllabus scraper
│   │   ├── embedder.py        # sentence-transformers embedding + cosine search
│   │   ├── event_resolver.py  # Fuzzy event matching for voice editing
│   │   ├── auth/
│   │   │   └── supabase.py    # Supabase Auth REST client (v2.2)
│   │   └── sync/              # v2.2 cloud sync
│   │       ├── google.py      # Google Calendar REST + OAuth
│   │       ├── caldav.py      # iCloud / generic CalDAV via the caldav lib
│   │       ├── dedup.py       # Pure-function fuzzy matcher (the §10 Q5 thresholds)
│   │       ├── ics_normalize.py # iCal ↔ event payload conversion
│   │       ├── runner.py      # 5-min asyncio loop; broadcasts SSE events
│   │       └── keychain_bridge.py # Frontend-Keychain ↔ runner token bridge
│   ├── tests/                 # pytest unit + integration tests (run each file in isolation)
│   ├── main.py                # FastAPI app — all routes (3500+ lines)
│   ├── seed_demo.py           # Demo data seed script
│   └── loom.sqlite3           # Local SQLite database
├── frontend-ui/
│   ├── src/
│   │   └── src/               # React source root
│   │       ├── components/
│   │       │   ├── calendar/  # DragShader, YearView, EventPill, TodayLineFreshness, …
│   │       │   ├── connections/ # ProviderPickerModal, CalDAVCredentialsModal, SubscribeDrawerModal (v2.2)
│   │       │   ├── focus/     # PomodoroPanel, KanbanBoard, …
│   │       │   ├── inbox/     # InboxPanel
│   │       │   ├── journal/   # JournalRecorder
│   │       │   ├── modals/    # EventEditorModal, AutopilotReviewModal, SyllabusModal, SyncMergeModal (v2.2), …
│   │       │   ├── topbar/    # AccountAvatar, SyncCenter (v2.2)
│   │       │   └── shared/    # AppDrawer, TopBar, SourceBadge (v2.2), Icon, …
│   │       ├── contexts/      # ModalContext, UndoContext, CalendarNavContext, AccountContext (v2.2), SyncContext (v2.2)
│   │       ├── hooks/         # useShortcuts, useReminders
│   │       ├── lib/           # eventUtils, keybindConfig, keychain (v2.2 — wraps Tauri keyring commands)
│   │       ├── pages/         # CalendarPage, TaskBoardPage, FocusPage, InboxPage,
│   │       │                  # CoursesPage, JournalPage, SettingsPage,
│   │       │                  # SignInPage / OnboardingPage / AccountSettingsPage (v2.2),
│   │       │                  # ConnectionsSettingsPage / ConnectionDetailPage / SyncReviewPage (v2.2)
│   │       ├── store/         # notifications pub/sub (collapseKey grouping in v2.2)
│   │       ├── styles/        # tokens.css (design system)
│   │       ├── api.ts         # Typed API client (all HTTP calls)
│   │       └── types.ts       # TypeScript interfaces for all models
│   ├── src-tauri/             # Rust desktop wrapper (Tauri v2)
│   │   ├── Cargo.toml         # +keyring crate (v2.2 — macOS Keychain access)
│   │   └── src/lib.rs         # Menu-bar tray, window management, keychain_set/get/delete commands (v2.2)
│   └── package.json
├── CLAUDE.md
├── .gitignore
├── LICENSE
└── README.md
```
