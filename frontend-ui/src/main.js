const API_URL = "http://127.0.0.1:8000";
let calendarInstance;
let currentEvents = [];
let currentTimelines = [];

// ==========================================
// CALENDAR INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async function() {
    const calendarEl = document.getElementById('calendar-container');
    
    calendarInstance = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,timeGridDay'
      },
      height: '100%',
      events: [],
      eventClick: function(info) {
        openEventModal(info.event);
      },
      dateClick: function(info) {
        openEventModal(null, info.dateStr);
      }
    });
    
    calendarInstance.render();
    await loadData();
    setupEventListeners();
});

// ==========================================
// DATA LOADING (Bulletproof)
// ==========================================
async function loadData() {
    // 1. Fetch timelines FIRST. If events are corrupted, timelines still load so you can delete them.
    try {
        const calResponse = await fetch(`${API_URL}/calendars/`);
        if (calResponse.ok) {
            currentTimelines = await calResponse.json();
            renderSidebar(currentTimelines);
            populateTimelineDropdown();
        }
    } catch (error) {
        console.error("Failed to load timelines:", error);
    }

    // 2. Fetch events separately.
    try {
        const evResponse = await fetch(`${API_URL}/events/`);
        if (evResponse.ok) {
            currentEvents = await evResponse.json();
            // Get current search term if any exists
            const searchTerm = document.getElementById("event-search")?.value.toLowerCase() || "";
            renderCalendarEvents(searchTerm);
        } else {
            console.warn("Could not load events. Database might have corrupted entries.");
            // Still render empty events so the grid doesn't hang
            renderCalendarEvents("");
        }
    } catch (error) {
        console.error("Failed to load events:", error);
    }
}

// ==========================================
// RENDERING WITH SEARCH FILTER
// ==========================================
function renderSidebar(timelines) {
    const listElement = document.getElementById("timeline-list");
    listElement.innerHTML = "";

    timelines.forEach(timeline => {
        const li = document.createElement("li");
        li.className = "sidebar-item";
        // We use a specific class 'delete-btn-action' to identify the click target
        li.innerHTML = `
            <input type="checkbox" class="timeline-checkbox" data-id="${timeline.id}" checked>
            <span class="timeline-name">${timeline.name}</span>
            <button class="delete-timeline-btn delete-btn-action" data-id="${timeline.id}">×</button>
        `;
        listElement.appendChild(li);
    });

    // Handle Checkboxes
    document.querySelectorAll('.timeline-checkbox').forEach(box => {
        box.onchange = () => renderCalendarEvents(document.getElementById("event-search").value.toLowerCase());
    });
}

function renderCalendarEvents(searchTerm = "") {
    calendarInstance.removeAllEvents();
    
    const activeTimelineIds = Array.from(document.querySelectorAll('.timeline-checkbox:checked'))
                                   .map(cb => parseInt(cb.dataset.id));

    const formattedEvents = currentEvents
        // Filter 1: Is the timeline toggled on?
        .filter(event => activeTimelineIds.includes(event.calendar_id))
        // Filter 2: Does it match the search query? (Safe check for null titles)
        .filter(event => (event.title || "").toLowerCase().includes(searchTerm))
        .map(event => ({
            id: event.id,
            title: event.title,
            start: event.start_time,
            end: event.end_time,
            extendedProps: { calendar_id: event.calendar_id }
        }));

    calendarInstance.addEventSource(formattedEvents);
}

function populateTimelineDropdown() {
    const select = document.getElementById("event-timeline");
    if (!select) return;
    select.innerHTML = "";
    currentTimelines.forEach(t => {
        const option = document.createElement("option");
        option.value = t.id;
        option.textContent = t.name;
        select.appendChild(option);
    });
}

// ==========================================
// MODAL LOGIC
// ==========================================
function formatForInput(dateObj) {
    if (!dateObj) return "";
    const d = new Date(dateObj);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

function openEventModal(existingEvent = null, clickedDate = null) {
    const modal = document.getElementById("event-modal");
    document.getElementById("delete-event-btn").classList.add("hidden");

    if (existingEvent) {
        document.getElementById("event-modal-title").innerText = "Edit Event";
        document.getElementById("event-id").value = existingEvent.id;
        document.getElementById("event-title").value = existingEvent.title;
        document.getElementById("event-start").value = formatForInput(existingEvent.start);
        document.getElementById("event-end").value = formatForInput(existingEvent.end);
        document.getElementById("event-timeline").value = existingEvent.extendedProps.calendar_id;
        document.getElementById("delete-event-btn").classList.remove("hidden");
    } else {
        document.getElementById("event-modal-title").innerText = "New Event";
        document.getElementById("event-id").value = "";
        document.getElementById("event-title").value = "";
        
        const startStr = clickedDate ? new Date(clickedDate) : new Date();
        const endStr = new Date(startStr.getTime() + 60 * 60 * 1000); 
        
        document.getElementById("event-start").value = formatForInput(startStr);
        document.getElementById("event-end").value = formatForInput(endStr);
    }
    
    modal.classList.remove("hidden");
}

// ==========================================
// EVENT LISTENERS
// ==========================================
function setupEventListeners() {
    // --- New Search Listener ---
    const searchInput = document.getElementById("event-search");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            renderCalendarEvents(e.target.value.toLowerCase());
        });
    }

// --- GLOBAL FORCED DELETE LISTENER ---
    window.onclick = async (e) => {
        const deleteBtn = e.target.closest('.delete-btn-action');
        
        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            
            const id = deleteBtn.getAttribute('data-id');
            const deleteUrl = `${API_URL}/calendars/${id}`;
            
            console.log("Attempting DELETE request to:", deleteUrl);
            
            // For now, let's remove the 'confirm' just to test if the line appears in Network
            try {
                const response = await fetch(deleteUrl, { 
                    method: 'DELETE',
                    mode: 'cors' // Explicitly handle potential CORS issues
                });

                if (response.ok) {
                    console.log("Delete successful for ID:", id);
                    await loadData();
                } else {
                    const errorData = await response.json();
                    console.error("Server Error:", errorData);
                }
            } catch (err) {
                console.error("Fetch failed entirely:", err);
            }
        }
    };
    // Event Modal
    document.getElementById("add-event-btn").addEventListener("click", () => openEventModal());
    document.getElementById("cancel-event-btn").addEventListener("click", () => document.getElementById("event-modal").classList.add("hidden"));
    
    document.getElementById("save-event-btn").addEventListener("click", async () => {
        const id = document.getElementById("event-id").value;
        const payload = {
            title: document.getElementById("event-title").value,
            start_time: new Date(document.getElementById("event-start").value).toISOString(),
            end_time: new Date(document.getElementById("event-end").value).toISOString(),
            calendar_id: parseInt(document.getElementById("event-timeline").value)
        };

        const method = id ? "PUT" : "POST";
        const url = id ? `${API_URL}/events/${id}` : `${API_URL}/events/`;

        await fetch(url, {
            method: method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        document.getElementById("event-modal").classList.add("hidden");
        loadData();
    });

    document.getElementById("delete-event-btn").addEventListener("click", async () => {
        const id = document.getElementById("event-id").value;
        await fetch(`${API_URL}/events/${id}`, { method: 'DELETE' });
        document.getElementById("event-modal").classList.add("hidden");
        loadData();
    });

    // Timeline Modal
    document.getElementById("add-timeline-btn").addEventListener("click", () => document.getElementById("timeline-modal").classList.remove("hidden"));
    document.getElementById("cancel-timeline-btn").addEventListener("click", () => document.getElementById("timeline-modal").classList.add("hidden"));
    
    document.getElementById("save-timeline-btn").addEventListener("click", async () => {
        const name = document.getElementById("timeline-name").value;
        if (!name) return;
        await fetch(`${API_URL}/calendars/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name, description: "" })
        });
        document.getElementById("timeline-modal").classList.add("hidden");
        document.getElementById("timeline-name").value = "";
        loadData();
    });
    // --- Settings Modal ---
    document.getElementById("settings-btn").onclick = () => {
        document.getElementById("settings-modal").classList.remove("hidden");
    };
    
    document.getElementById("close-settings-btn").onclick = () => {
        document.getElementById("settings-modal").classList.add("hidden");
    };

    // --- Theme Toggle ---
    document.getElementById("theme-toggle").onclick = () => {
        document.body.classList.toggle("light-mode");
        const isLight = document.body.classList.contains("light-mode");
        localStorage.setItem("loom-theme", isLight ? "light" : "dark");
    };

    // Check saved theme on load
    if (localStorage.getItem("loom-theme") === "light") {
        document.body.classList.add("light-mode");
    }

    // --- Week Start ---
    document.getElementById("week-start-select").onchange = (e) => {
        calendarInstance.setOption('firstDay', parseInt(e.target.value));
    };
}

// ==========================================
// MICROPHONE LOGIC
// ==========================================
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
const micBtn = document.getElementById("mic-btn");
const consentModal = document.getElementById("consent-modal");

if (micBtn) {
    micBtn.addEventListener("click", () => {
        if (!isRecording) consentModal.classList.remove("hidden");
        else stopRecording();
    });
}

document.getElementById("decline-btn").addEventListener("click", () => consentModal.classList.add("hidden"));
document.getElementById("accept-btn").addEventListener("click", () => {
    consentModal.classList.add("hidden");
    startRecording();
});

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.start();
        isRecording = true;
        micBtn.innerHTML = "🛑 Stop Listening";
        micBtn.className = "mic-active";
    } catch (err) { alert("Microphone access denied."); }
}

async function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        micBtn.innerHTML = "⏳ Processing...";
        micBtn.className = "mic-inactive";

        mediaRecorder.onstop = async () => {
            const formData = new FormData();
            formData.append("file", new Blob(audioChunks, { type: 'audio/webm' }), "recording.webm");
            try {
                await fetch(`${API_URL}/transcribe`, { method: "POST", body: formData });
                await loadData();
            } catch (err) { console.error(err); } 
            finally {
                micBtn.innerHTML = "🎤 Listen";
                isRecording = false;
            }
        };
    }
}