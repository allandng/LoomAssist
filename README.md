# 🧶 LoomAssist 1.3: Privacy-First Local AI Assistant

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

###2. Frontend Setup
```Bash
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
- [ ] Next: Flight Searcher Intent Execution
- [ ] Next: Keyboard Navigation for Mention Dropdown

---
## 📂 File Structure
```File structure
LoomAssist/
├── backend-api/        # FastAPI, SQLModel, & AI Logic
│   ├── database/       # DB Engine and SQLModels
│   └── services/       # Transcription and Scraping
├── frontend-ui/        # Tauri & FullCalendar Interface
│   ├── src/            # HTML/JS/CSS source
│   └── src-tauri/      # Rust Desktop Wrapper
└── README.md
```