# LoomAssist
Assistant for making all different apps seemless for calendar use!


🧶 Loom: Privacy-First Local AI Assistant
Loom is a high-performance, local-first personal assistant designed for students and developers. It transforms your voice into structured calendar events using state-of-the-art speech-to-text and local LLMs—ensuring your data never leaves your Mac.


============
🚀 Key Features
============
🎙️ Voice-to-Intent: Use Faster-Whisper and Ollama (Llama 3.2) to schedule events naturally.

📅 Interactive Grid: A beautiful, responsive calendar powered by FullCalendar with Month, Week, and Day views.

🔍 Smart Search: Lightning-fast, real-time filtering of events using the integrated search bar.

📂 Timeline Management: Create, toggle, and manage multiple calendars (Timelines) for school, work, and personal life.

🌓 Sleek UI: A modern "Slate & Indigo" dark mode designed for focus and clarity.

🔒 100% Local: Everything—from the database to the AI models—runs on your machine.


============
🛠️ Tech Stack
============
Backend:
- FastAPI: High-performance Python web framework.
- SQLAlchemy: SQLite database for local data persistence.
- Faster-Whisper: Fast STT (Speech-to-Text) engine.
- Ollama (Llama 3.2): Local LLM for natural language processing and intent extraction.

Frontend:
- Tauri: Build tiny, blazing-fast desktop apps with a Web frontend.
- FullCalendar: Professional-grade calendar grid.
- Vanilla JS/CSS: Clean, performant frontend logic and custom dark-mode styling.


============
📦 Installation & Setup
============
Prerequisites
- Ollama installed and running (ollama pull llama3.2)
- Node.js & Rust (for Tauri)
- Python 3.10+

1. Backend Setup
Bash
cd backend-api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 -m uvicorn main:app --reload
2. Frontend Setup
Bash
cd frontend-ui
npm install
npm run tauri dev


============
🎙️ Usage Guide
============
Click the 🎤 Listen button in the sidebar and try commands like:
1. "Schedule an Operating Systems study session for tomorrow at 4 PM."
2. "Add an event called 'Azores Flight' on June 15th at 10 AM."
3. "Lunch with the team on Friday at noon."
Loom will automatically transcribe your voice, determine the intent, and place the event on the correct timeline.


============
🗺️ Project Roadmap
============
- [x] FullCalendar Interactive Grid
- [x] Local AI Intent Extraction
- [x] Global Search & Filtering
- [ ] Next: Custom Timeline Color Picking
- [ ] Next: .ics (iCalendar) File Import
- [ ] Next: Syllabus/Document PDF Reading for auto-scheduling