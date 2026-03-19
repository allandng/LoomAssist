#🧶 LoomAssist 1.2: Privacy-First Local AI Assistant
###Loom is a high-performance, local-first personal assistant designed for students and developers. It transforms your voice into structured calendar events using state-of-the-art speech-to-text and local LLMs—ensuring your data never leaves your Mac.


---
## 🚀 Key Features

* **🎙️ Voice-to-Intent:** Use Faster-Whisper and Ollama (Llama 3.2) to schedule events naturally.
* **📅 Interactive Grid:** A beautiful, responsive calendar powered by FullCalendar with Month, Week, and Day views.
* **🔍 Smart Search:** Lightning-fast, real-time filtering of events using the integrated search bar.
* **📂 Timeline Management:** Create, toggle, and manage multiple calendars (Timelines) for school, work, and personal life.
* **🌓 Sleek UI:** A modern "Slate & Indigo" dark mode designed for focus and clarity.
* **🔒 100% Local:** Everything—from the database to the AI models—runs on your machine.
* **🛡️ Robust Design:** Structured error contracts and unified SQLModel data layers for high reliability.

---

## 🛠️ Tech Stack

### **Backend**
* **FastAPI:** High-performance Python web framework.
* **SQLModel:** Unified Pydantic and SQLAlchemy models for a clean data layer.
* **Faster-Whisper:** High-speed STT (Speech-to-Text) engine.
* **Ollama (Llama 3.2):** Local LLM for NLP and intent extraction.

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
python3 -m uvicorn main:app --reload```

###2. Frontend Setup
```Bash
cd frontend-ui
npm install
npm run tauri dev```


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
- [ ] Next: Custom Timeline Color Picking
- [ ] Next: .ics (iCalendar) File Import
- [ ] Next: Syllabus/Document PDF Reading for auto-scheduling

---
## 📂 File Structure
LoomAssist/
├── backend-api/        # FastAPI, SQLModel, & AI Logic
│   ├── database/       # DB Engine and SQLModels
│   └── services/       # Transcription and Scraping
├── frontend-ui/        # Tauri & FullCalendar Interface
│   ├── src/            # HTML/JS/CSS source
│   └── src-tauri/      # Rust Desktop Wrapper
└── README.md