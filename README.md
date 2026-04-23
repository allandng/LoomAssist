# 🧶 LoomAssist 1.5: Privacy-First Local AI Assistant

Loom is a high-performance, local-first personal assistant designed for students and developers. It transforms your voice into structured calendar events using state-of-the-art speech-to-text and local LLMs—ensuring your data never leaves your Mac.

---
## 🚀 Key Features

* **🎙️ Voice-to-Intent:** Use Faster-Whisper and Ollama (Llama 3.2) to schedule events naturally.
* **📅 Interactive Grid:** A beautiful, responsive calendar powered by FullCalendar with Month, Week, and Day views (including scroll-wheel zoom).
* **🔄 Advanced Recurring Events:** Support for complex weekly schedules with occurrence-specific notes.
* **⌨️ Power User Shortcuts:** Navigate efficiently with keyboard shortcuts (`N` for new, `T` for today, `1-4` for views, `/` for search) alongside a 50-step global Undo/Redo stack.
* **🔍 Smart Search & Mentions:** Lightning-fast filtering, plus `@[Event]` tagging and Markdown link support in event descriptions.
* **📥 Universal Import & Export:** Bulk-import `.ics` calendars, use AI to automatically extract dates from Syllabus PDFs, and export timelines to JSON/ICS.
* **⏪ Global Undo/Redo:** A 50-step history stack (Ctrl+Z) for safe event and timeline management.
* **🌓 Sleek UI:** A modern "Slate & Indigo" dark mode featuring a hidable sidebar and clean hamburger navigation.
* **🔒 100% Local:** Everything—from the database to the AI models—runs on your machine.
* **🖱️ Advanced Event Interaction:** Single-click to select, double-click to edit. Drag across the grid to multi-select. Delete/Backspace for bulk removal.
* **📋 Task Board:** Pin any event to the Task Board with one click. Track completion, add notes, and group tasks by timeline.
* **🗂️ Event Templates:** Save any event as a reusable template and apply it from the hamburger menu.
* **🎯 Focus Mode:** Press `F` for a fullscreen session with a running timer, Pomodoro mode, and today's events.
* **📊 Usage Statistics:** Hours logged per timeline, busiest day of the week, and monthly event count — all local.
* **🌅 Daily Agenda Overlay:** On startup, shows today's events as a fullscreen summary before revealing the full calendar.
* **⚠️ Wellness Warnings:** Ollama detects over-scheduled days and surfaces reminders to plan meals, breaks, and commute time.
* **🗓️ All-Day & Multi-Day Events:** Full-width banner display for all-day events. Span across multiple days for trips and conferences.
* **⏭️ Skip Recurring Occurrences:** Skip a single instance of a recurring event without deleting the whole series.
* **⏱️ Per-Day Times on Recurring Events:** Different start/end times per day on a single recurring event (e.g. Mon 9–11am, Fri 2–4pm).
* **✅ Per-Event Checklists:** Sub-task checklist per event with a progress chip on the calendar grid (e.g. 2/5).
* **🖥️ App Drawer:** A collapsible strip on the far left that slides open to reveal module navigation (Calendar, Task Board, Focus Mode).
* **🔄 Timeline Rename:** Double-click any timeline name to rename it inline. Delete button only appears when the timeline is checked.
* **🖨️ Print Week View:** Print-optimized week layout opens in a new tab and triggers the browser print dialog.
* **💾 Sync Status:** Live timestamp in the top bar showing last successful sync. Turns red on connection failure.
* **🔔 In-App Notifications:** A bell-icon panel in the top bar for info, success, warning, error, and progress alerts. Supports actionable cards, auto-dismiss, progress bars, unread badge, and full keyboard accessibility.
* **📅 Appointment Scheduling:** Send a shareable availability link to contacts. They confirm, decline, or propose a counter-slot; accepted slots auto-create a calendar event. Includes mini-calendar slot picker and real-time polling.
* **👁️ Quick-Peek Hover Card:** Hover over any calendar event to see a rich preview — title, time range, timeline, rendered description, and checklist items — without opening the full editor.
* **📋 Structured Logging:** Full-stack JSON log pipeline. The backend writes rotating logs to `~/Library/Logs/LoomAssist/`; the frontend ships batched entries every 10 s; Rust panics write a dedicated crash file. A log viewer and crash-recovery notification are built in.

---

## 🛠️ Tech Stack

### **Backend**
* **FastAPI:** High-performance Python web framework.
* **SQLModel:** Unified Pydantic and SQLAlchemy models for a clean data layer.
* **Faster-Whisper:** High-speed STT (Speech-to-Text) engine.
* **Ollama (Llama 3.2):** Local LLM for NLP, intent extraction, and PDF parsing.
* **PyPDF:** Unstructured document ingestion.

### **Frontend**
* **Tauri:** Lightweight desktop wrapper for a fast, native feel.
* **FullCalendar:** Professional-grade calendar grid.
* **Vanilla JS/CSS:** Performant frontend logic and custom dark-mode styling.

---

## 📦 Installation & Setup

### Prerequisites
* [Ollama](https://ollama.com/) installed and running (`ollama pull llama3.2`)
* [Node.js](https://nodejs.org/) & [Rust](https://www.rust-lang.org/) (for Tauri/Cargo)
* Python 3.10+

### 1. Backend Setup
```bash
cd backend-api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 -m uvicorn main:app --reload
```

### 2. Frontend Setup
```bash
cd frontend-ui
npm install
npm run tauri dev
```


---
## 🎙️ Usage Guide

Click the 🎤 Listen button in the sidebar and try commands like:
1. "Schedule an Operating Systems study session for tomorrow at 4 PM."
2. "Add an event called 'Azores Flight' on June 15th at 10 AM."
3. "Lunch with the team on Friday at noon."
Loom will automatically transcribe your voice, determine the intent, and place the event on the correct timeline.

You can also type in the search bar — when your text doesn't match an existing event, a **+** button appears to create it instantly using natural language.


---
## ⌨️ Keyboard Shortcuts

| Shortcut          | Action                          |
|-------------------|---------------------------------|
| `N`               | New event                       |
| `T`               | Jump to today                   |
| `1`               | Month view                      |
| `2`               | Week view                       |
| `3`               | Day view                        |
| `4`               | Agenda / List view              |
| `[` / `]`         | Previous / Next period          |
| `B`               | Toggle sidebar                  |
| `/`               | Focus search bar                |
| `F`               | Toggle Focus Mode               |
| `Delete`          | Delete selected event(s)        |
| `Ctrl+Z`          | Undo                            |
| `Ctrl+Shift+Z`    | Redo                            |
| `Escape`          | Close modal / dismiss dropdown  |

---
## 🗺️ Project Roadmap
- [x] FullCalendar Interactive Grid
- [x] Local AI Intent Extraction
- [x] Global Search & Filtering 
- [x] Custom Timeline Color Picking
- [x] .ics (iCalendar) File Import
- [x] Syllabus/Document PDF Reading for auto-scheduling
- [x] Hidable Sidebar & Scroll-wheel Zoom
- [x] Timeline Export (JSON/ICS)
- [x] Global Undo/Redo History Stack
- [x] Markdown Links & @Mention Tagging
- [x] Reminders & Browser Notifications
- [x] Database Backup & Restore & Timezone Handling
- [x] Drag-and-Drop Event Rescheduling & Resizing
- [x] All-Day and Multi-Day Event Support
- [x] Per-Day Different Times on Recurring Events
- [x] Skip Individual Recurring Event Occurrences
- [x] Per-Event Task Checklists
- [x] Task Board (pin events as tasks)
- [x] Event Templates
- [x] Focus Mode with Pomodoro Timer
- [x] Wellness Warnings via Local AI
- [x] Usage Statistics Panel
- [x] Daily Agenda Startup Overlay
- [x] Sync Status Indicator
- [x] Unified Search + Quick-Add Bar
- [x] Timeline Rename and Conditional Delete Button
- [x] Multi-Select and Bulk Delete Events
- [x] Print Week View
- [x] App Drawer Navigation Strip
- [x] Duplicate Import Prevention
- [x] In-App Notification Panel (bell icon, badge, progress, actionable cards)
- [x] Appointment Scheduling via Shareable Availability Link
- [x] Quick-Peek Hover Card (rich event preview on mouse-over)
- [x] Structured Full-Stack Logging (rotating JSON logs, crash snapshots, log viewer)
- [ ] Next: Cloud Premium Layer (Supabase + Stripe + LiteLLM)
- [ ] Next: One-Key Capture (Ctrl+L) — premium audio capture
- [ ] Next: AI Study Guide / Cheat Sheet Generator — premium
- [ ] Next: Mobile App (iOS/Android)

---
## 📂 File Structure
```
LoomAssist/
├── backend-api/              # FastAPI, SQLModel, & AI Logic
│   ├── database/             # DB Engine and SQLModels
│   │   ├── database.py       # DB session and engine
│   │   └── models.py         # SQLModel table definitions
│   ├── services/             # Transcription and Scraping
│   │   └── scraper.py        # PDF/Syllabus scraper
│   ├── main.py               # FastAPI app and routes
│   └── loom.sqlite3          # Local SQLite database
├── frontend-ui/              # Tauri & FullCalendar Interface
│   ├── src/                  # HTML/JS/CSS source
│   │   ├── index.html        # App shell
│   │   ├── main.js           # Calendar logic and API calls
│   │   └── styles.css        # Dark mode styling
│   ├── src-tauri/            # Rust Desktop Wrapper
│   │   ├── src/              # Rust source (lib.rs, main.rs)
│   │   └── tauri.conf.json   # Tauri configuration
│   └── package.json          # JS dependencies
├── .gitignore
├── LICENSE
└── README.md
```
