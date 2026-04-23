# 🧶 LoomAssist v2.0 — Privacy-First Local AI Calendar

LoomAssist is a local-first desktop calendar app for students and developers. All data and AI inference run on-device. Nothing leaves your machine.

---

## ✨ In this update

- **ICS Import** — bulk-import `.ics` calendars through a dedicated modal with duplicate prevention
- **Syllabus Scanner** — inline sidebar scan flow with per-event cards; edit title, date, time, and timeline before approving each item individually
- **@mention Dropdown** — type `@` in event descriptions to tag people or events with an autocomplete dropdown
- **Counter-Proposal Flow** — availability notifications gain a "View Proposal" button that opens a modal to accept or decline a recipient's counter-slot
- **Light / Dark Mode Toggle** — switch themes from Settings; preference persisted to localStorage
- **Configurable Keybinds** — rebind any shortcut from the Settings page with live key-capture UI; persisted to localStorage and applied globally at runtime
- **Drag & Resize Fix** — event drag and resize now sends the full payload to the backend (was returning 422 on partial updates)

---

## 🚀 Key Features

- **🎙️ Voice-to-Intent** — Faster-Whisper + Ollama (Llama 3.2) transcribes speech and creates events from natural language.
- **📅 Five Calendar Views** — Month, Week, Day, Year, and Agenda. Ctrl/Cmd+scroll cycles view granularity; plain scroll navigates dates in month and agenda views.
- **🗓️ Year View** — Click a month name to jump to that month view; click a day to jump to day view. Scroll to navigate years.
- **🔄 Advanced Recurring Events** — Weekly schedules with per-day times, skip-date exceptions, and per-occurrence description overrides.
- **📍 Location & Travel Time** — Each event stores a location and an optional travel time (minutes). The free-slot finder blocks out the travel buffer automatically.
- **🔍 Smart Scheduler** — Find up to 5 free slots in a rolling window; all slots land on :00/:15/:30/:45 boundaries. Slot duration is configurable (30 min – 2 hours).
- **📋 Task Board** — Pin any event as a task. Group by timeline, due date, priority, or status. Activity heatmap with busy-level legend lives here.
- **🎯 Focus Mode** — Fullscreen Pomodoro session with today's events in a Kanban rail.
- **🗂️ Event Templates & Time Block Templates** — Save reusable single events or full week schedules and apply them in one click.
- **✅ Per-Event Checklists** — Sub-tasks stored in the event; progress chip shown on the calendar grid.
- **⏱️ Duration Tracking** — Clock in/out on any event; the Stats panel shows planned vs. actual time with delta highlighting.
- **📚 Study Block Generator** — AI-assisted session scheduling from a subject and deadline date.
- **📊 Weekly Review** — Ollama-powered narrative summary of the past and upcoming week.
- **📅 Appointment Scheduling** — Generate a shareable availability link; recipients confirm, decline, or propose a counter-slot. Accepted slots auto-create events.
- **📥 ICS Import / Export** — Bulk-import `.ics` calendars with duplicate prevention via `external_uid`. Export individual timelines.
- **📄 Syllabus PDF Scanner** — AI extracts deadlines and events from uploaded PDFs.
- **🔽 Collapsible Sidebar Filters** — Toggle filters (Has checklist, Recurring only, This week) via a chevron-controlled dropdown. Timelines, templates, and the Smart Scheduler live in the same sidebar.
- **⏪ Global Undo/Redo** — 50-step stack (Cmd/Ctrl+Z / Shift+Z).
- **⚠️ Wellness Warnings** — Ollama detects over-scheduled days and surfaces reminders for meals, breaks, and commute time.
- **🔔 In-App Notifications** — Bell panel with info, success, warning, error, and progress types; auto-dismiss; unread badge.
- **👁️ Quick-Peek Hover Card** — Rich event preview (time, timeline, description, checklist) on mouse-over without opening the editor.
- **📋 Structured Logging** — JSON log pipeline with rotating backend logs, batched frontend shipping, crash snapshots, and a log viewer.
- **💾 Sync Status Indicator** — Live timestamp in the top bar; turns red on connection failure.
- **🖱️ Multi-Select & Bulk Delete** — Drag across the grid to select; Delete/Backspace removes all selected events.
- **🖨️ Print Week View** — Print-optimized layout opens in a new tab.

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
| `Delete` | Delete selected event(s) |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Escape` | Close modal / dismiss dropdown |
| `Ctrl/Cmd+Scroll` | Zoom view granularity |
| `Scroll` | Navigate prev/next period (month/agenda views) |

---

## 🗺️ Project Roadmap

### Completed (v1.x)
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

### Completed (v2.0-react)
- **Full React 19 + TypeScript rewrite** (replaced vanilla JS)
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
- Year view — 12-month grid; click month name → month view; click day → day view
- Scroll-wheel date navigation (plain scroll in month/agenda; Ctrl+scroll zooms granularity)
- Collapsible sidebar filter dropdown
- View order: Month → Week → Day → Year → Agenda
- Activity heatmap with busy-level legend bar (on Task Board)
- Duration tracking (clock in/out, planned vs. actual stats panel)
- Study block generator (AI session scheduling from subject + deadline)
- Weekly review (Ollama narrative summary)
- Time block templates (save and apply full week schedules)
- Find free time — 15-minute-aligned slot starts (:00/:15/:30/:45)
- Event location field + travel time (auto-blocks commute buffer in free-slot search)

### Upcoming
- Cloud premium layer (Supabase + Stripe + LiteLLM)
- One-key capture (Ctrl+L) — premium audio capture
- AI study guide / cheat sheet generator — premium
- Mobile app (iOS/Android)

---

## 📂 File Structure
```
LoomAssist/
├── backend-api/
│   ├── database/
│   │   ├── database.py      # DB engine, session, run_migrations()
│   │   └── models.py        # SQLModel table definitions
│   ├── services/
│   │   └── scraper.py       # PDF/syllabus scraper
│   ├── tests/               # pytest unit + integration tests
│   ├── main.py              # FastAPI app and all routes (1200+ lines)
│   └── loom.sqlite3         # Local SQLite database
├── frontend-ui/
│   ├── src/
│   │   └── src/             # React source root
│   │       ├── components/  # Calendar, modals, shared widgets
│   │       ├── contexts/    # Modal, Undo, CalendarNav contexts
│   │       ├── hooks/       # useShortcuts, useReminders
│   │       ├── lib/         # eventUtils (expansion, formatting)
│   │       ├── pages/       # CalendarPage, TaskBoardPage, FocusPage, SettingsPage
│   │       ├── store/       # notifications pub/sub
│   │       ├── styles/      # tokens.css (design system)
│   │       ├── api.ts       # Typed API client (all HTTP calls)
│   │       └── types.ts     # TypeScript interfaces for all models
│   ├── src-tauri/           # Rust desktop wrapper (Tauri v2)
│   └── package.json
├── CLAUDE.md
├── .gitignore
├── LICENSE
└── README.md
```
