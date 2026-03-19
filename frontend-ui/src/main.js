const API_URL = "http://127.0.0.1:8000";
let calendarInstance;
let currentEvents = [];
let currentTimelines = [];

// ==========================================
// UNDO / REDO HISTORY STACK
// ==========================================
let undoStack = [];
let redoStack = [];

function pushHistory(undoFn, redoFn, label) {
    undoStack.push({ undo: undoFn, redo: redoFn, label });
    if (undoStack.length > 50) undoStack.shift();
    redoStack = []; 
    updateUndoRedoButtons();
}

async function performUndo() {
    if (undoStack.length === 0) return;
    const action = undoStack.pop();
    await action.undo();
    redoStack.push(action);
    await loadData();
    updateUndoRedoButtons();
}

async function performRedo() {
    if (redoStack.length === 0) return;
    const action = redoStack.pop();
    await action.redo();
    undoStack.push(action);
    await loadData();
    updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
    document.getElementById("undo-btn").disabled = undoStack.length === 0;
    document.getElementById("redo-btn").disabled = redoStack.length === 0;
}

// ==========================================
// SIDEBAR STATE & SHARED LOGIC
// ==========================================
let sidebarMode = "normal"; // "normal" | "search" | "approval" | "export"
let pendingTimelineSelect = null;

function updateSidebarMode(mode) {
    sidebarMode = mode;
    const mainSections = document.querySelectorAll('.sidebar-section, .record-section');
    const searchResults = document.getElementById('sidebar-search-results');
    const approvalPanel = document.getElementById('sidebar-approval-panel');
    const exportPanel = document.getElementById('sidebar-export-panel');
    
    mainSections.forEach(el => el.classList.add('hidden'));
    searchResults.classList.add('hidden');
    approvalPanel.classList.add('hidden');
    exportPanel.classList.add('hidden');
    
    if (mode === "normal") {
        mainSections.forEach(el => el.classList.remove('hidden'));
    } else if (mode === "search") {
        searchResults.classList.remove('hidden');
    } else if (mode === "approval") {
        approvalPanel.classList.remove('hidden');
    } else if (mode === "export") {
        exportPanel.classList.remove('hidden');
    }
}

function populateTimelineDropdown(selectEl) {
    if (!selectEl) return;
    const currentVal = selectEl.value;
    
    selectEl.innerHTML = `
        <option value="" disabled hidden>Select timeline...</option>
        <option value="__new__" class="new-timeline-option" style="color: var(--accent); font-style: italic;">＋ New Timeline</option>
    `;
    
    currentTimelines.forEach(t => {
        selectEl.appendChild(new Option(t.name, t.id));
    });
    
    if (currentVal && currentVal !== "__new__" && currentTimelines.find(t => t.id == currentVal)) {
        selectEl.value = currentVal;
    } else if (currentTimelines.length > 0) {
        selectEl.value = currentTimelines[0].id;
    } else {
        selectEl.value = ""; 
    }
}

function bindTimelineDropdowns() {
    ['event-timeline', 'ics-timeline-select', 'approval-timeline-select'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.bound) {
            el.dataset.bound = "true";
            el.addEventListener('change', (e) => {
                if (e.target.value === '__new__') {
                    pendingTimelineSelect = el;
                    document.getElementById('timeline-modal').classList.remove('hidden');
                    
                    if (currentTimelines.length > 0) {
                        el.value = currentTimelines[0].id; 
                    } else {
                        el.value = "";
                    }
                }
            });
        }
    });
}

// ==========================================
// RENDER DESCRIPTION & MENTIONS
// ==========================================
function renderDescription(text) {
    if (!text) return "";
    let safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); 
    safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>'); 
    safe = safe.replace(/(^|\s)(https?:\/\/[^\s]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>'); 
    safe = safe.replace(/@\[([^\]]+)\]\(event:(\d+)\)/g, '<span class="mention-chip" data-id="$2">@$1</span>'); 
    safe = safe.replace(/\n/g, "<br>"); 
    return safe;
}

document.addEventListener('click', (e) => {
    if (e.target.classList.contains('mention-chip')) {
        const evId = e.target.getAttribute('data-id');
        const rawEvent = currentEvents.find(ev => ev.id == evId);
        if (rawEvent) openEventModal(rawEvent);
    }
});

function handleMentions(e) {
    const textarea = e.target;
    const text = textarea.value;
    const cursor = textarea.selectionStart;
    const lastAt = text.lastIndexOf('@', cursor - 1);
    const dropdown = document.getElementById("mention-dropdown");
    
    if (lastAt !== -1) {
        const term = text.substring(lastAt + 1, cursor);
        if (!term.includes('\n')) {
            const matches = currentEvents.filter(ev => (ev.title||"").toLowerCase().includes(term.toLowerCase())).slice(0, 10);
            if (matches.length > 0) {
                dropdown.innerHTML = "";
                matches.forEach(m => {
                    const item = document.createElement("div");
                    item.className = "dropdown-item";
                    item.textContent = m.title;
                    item.addEventListener("click", () => {
                        textarea.value = text.substring(0, lastAt) + `@[${m.title}](event:${m.id}) ` + text.substring(cursor);
                        dropdown.classList.add("hidden");
                        textarea.focus();
                    });
                    dropdown.appendChild(item);
                });
                
                const rect = textarea.getBoundingClientRect();
                dropdown.style.top = `${rect.bottom + window.scrollY}px`;
                dropdown.style.left = `${rect.left + window.scrollX}px`;
                dropdown.classList.remove("hidden");
                return;
            }
        }
    }
    dropdown.classList.add("hidden");
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.getElementById("mention-dropdown").classList.add("hidden");
});

// ==========================================
// CALENDAR INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async function() {
    if (localStorage.getItem("loom-sidebar") === "hidden") {
        document.querySelector('.app-layout').classList.add('sidebar-hidden');
        document.getElementById('sidebar-toggle').textContent = "›";
    }

    const calendarEl = document.getElementById('calendar-container');
    
    calendarInstance = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' },
      height: '100%',
      events: [],
      eventClick: function(info) {
        const rawEvent = currentEvents.find(e => e.id == info.event.id);
        openEventModal(rawEvent || info.event);
      },
      dateClick: function(info) { openEventModal(null, info.dateStr); }
    });
    
    calendarInstance.render();
    bindTimelineDropdowns();
    await loadData();
    setupEventListeners();
});

// ==========================================
// DATA LOADING
// ==========================================
async function loadData() {
    try {
        const calResponse = await fetch(`${API_URL}/calendars/`);
        if (calResponse.ok) {
            currentTimelines = await calResponse.json();
            renderSidebar(currentTimelines);
            ['event-timeline', 'ics-timeline-select', 'approval-timeline-select'].forEach(id => populateTimelineDropdown(document.getElementById(id)));
        }
    } catch (error) { console.error("Failed to load timelines:", error); }

    try {
        const evResponse = await fetch(`${API_URL}/events/`);
        if (evResponse.ok) {
            currentEvents = await evResponse.json();
            const searchTerm = document.getElementById("event-search")?.value.toLowerCase() || "";
            renderCalendarEvents(searchTerm);
            if (sidebarMode === "search") showSidebarSearchResults(searchTerm);
        } else {
            renderCalendarEvents("");
        }
    } catch (error) { console.error("Failed to load events:", error); }
}

// ==========================================
// RENDERING WITH SEARCH & COLOR LOGIC
// ==========================================
function renderSidebar(timelines) {
    const listElement = document.getElementById("timeline-list");
    listElement.innerHTML = "";

    timelines.forEach(timeline => {
        const li = document.createElement("li");
        li.className = "sidebar-item";
        const safeColor = timeline.color || "#6366f1";

        li.innerHTML = `
            <input type="checkbox" class="timeline-checkbox" data-id="${timeline.id}" checked>
            <input type="color" class="timeline-color-picker" data-id="${timeline.id}" value="${safeColor}" title="Change timeline color">
            <span class="timeline-name">${timeline.name}</span>
            <button class="delete-timeline-btn delete-btn-action" data-id="${timeline.id}">×</button>
        `;
        listElement.appendChild(li);
    });

    document.querySelectorAll('.timeline-checkbox').forEach(box => {
        box.addEventListener('change', () => {
            const searchTerm = document.getElementById("event-search")?.value.toLowerCase() || "";
            renderCalendarEvents(searchTerm);
        });
    });

    document.querySelectorAll('.timeline-color-picker').forEach(picker => {
        picker.addEventListener('change', async (e) => {
            const id = e.target.getAttribute('data-id');
            const timeline = currentTimelines.find(t => t.id === parseInt(id));
            if (timeline) {
                try {
                    const payload = { name: timeline.name, description: timeline.description, color: e.target.value };
                    const response = await fetch(`${API_URL}/calendars/${id}`, { method: 'PUT', headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                    if (response.ok) await loadData();
                } catch (err) { console.error("Network error saving color:", err); }
            }
        });
    });
}

function renderCalendarEvents(searchTerm = "") {
    calendarInstance.removeAllEvents();
    const activeTimelineIds = Array.from(document.querySelectorAll('.timeline-checkbox:checked')).map(cb => parseInt(cb.dataset.id));

    const formattedEvents = currentEvents
        .filter(event => activeTimelineIds.includes(event.calendar_id))
        .filter(event => (event.title || "").toLowerCase().includes(searchTerm))
        .map(event => {
            const parentTimeline = currentTimelines.find(t => t.id === event.calendar_id);
            const timelineColor = (parentTimeline && parentTimeline.color) ? parentTimeline.color : "#6366f1";

            if (event.is_recurring) {
                const startDate = new Date(event.start_time);
                const endDate = new Date(event.end_time);
                return {
                    id: event.id, title: event.title,
                    daysOfWeek: event.recurrence_days ? event.recurrence_days.split(',').map(Number) : [],
                    startTime: startDate.toTimeString().substring(0, 5), endTime: endDate.toTimeString().substring(0, 5),
                    startRecur: event.start_time.split('T')[0], endRecur: event.recurrence_end,
                    backgroundColor: timelineColor, borderColor: timelineColor, textColor: "#ffffff",
                    extendedProps: { calendar_id: event.calendar_id, is_recurring: true }
                };
            }
            return {
                id: event.id, title: event.title, start: event.start_time, end: event.end_time,
                backgroundColor: timelineColor, borderColor: timelineColor, textColor: "#ffffff",
                extendedProps: { calendar_id: event.calendar_id, is_recurring: false }
            };
        });
    calendarInstance.addEventSource(formattedEvents);
}

// ==========================================
// MODAL & RECURRENCE LOGIC
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
    
    const isRecurringCheckbox = document.getElementById("event-is-recurring");
    const recurrenceFields = document.getElementById("recurrence-fields");
    const singleFields = document.getElementById("single-date-fields");
    const descArea = document.getElementById("event-description");
    const uDescArea = document.getElementById("event-unique-description");
    const uDescContainer = document.getElementById("unique-desc-container");
    const descDisplay = document.getElementById("event-description-display");

    document.querySelectorAll('.recur-day').forEach(cb => cb.checked = false);

    if (existingEvent && existingEvent.id) {
        document.getElementById("event-modal-title").innerText = "Edit Event";
        document.getElementById("event-id").value = existingEvent.id;
        document.getElementById("event-title").value = existingEvent.title;
        document.getElementById("event-timeline").value = existingEvent.calendar_id || existingEvent.extendedProps?.calendar_id;
        document.getElementById("delete-event-btn").classList.remove("hidden");
        
        descArea.value = existingEvent.description || "";
        uDescArea.value = existingEvent.unique_description || "";
        
        let hasDesc = (existingEvent.description || existingEvent.unique_description);
        toggleDescMode(!hasDesc); 
        if (hasDesc) {
            let combined = existingEvent.description || "";
            if (existingEvent.is_recurring && existingEvent.unique_description) {
                combined += `\n\n*Note:* ${existingEvent.unique_description}`;
            }
            descDisplay.innerHTML = renderDescription(combined);
        }

        if (existingEvent.is_recurring) {
            isRecurringCheckbox.checked = true;
            recurrenceFields.classList.remove("hidden");
            singleFields.classList.add("hidden");
            uDescContainer.classList.remove("hidden");
            
            if (existingEvent.recurrence_days) {
                existingEvent.recurrence_days.split(',').forEach(d => {
                    const cb = document.querySelector(`.recur-day[value="${d}"]`);
                    if (cb) cb.checked = true;
                });
            }
            const st = new Date(existingEvent.start_time);
            const et = new Date(existingEvent.end_time);
            document.getElementById("recur-start-time").value = st.toTimeString().substring(0, 5);
            document.getElementById("recur-end-time").value = et.toTimeString().substring(0, 5);
            document.getElementById("recur-end-date").value = existingEvent.recurrence_end;
        } else {
            isRecurringCheckbox.checked = false;
            recurrenceFields.classList.add("hidden");
            singleFields.classList.remove("hidden");
            uDescContainer.classList.add("hidden");
            document.getElementById("event-start").value = formatForInput(existingEvent.start_time || existingEvent.start);
            document.getElementById("event-end").value = formatForInput(existingEvent.end_time || existingEvent.end);
        }
    } else {
        document.getElementById("event-modal-title").innerText = "New Event";
        document.getElementById("event-id").value = "";
        document.getElementById("event-title").value = "";
        descArea.value = "";
        uDescArea.value = "";
        toggleDescMode(true); 

        isRecurringCheckbox.checked = false;
        recurrenceFields.classList.add("hidden");
        singleFields.classList.remove("hidden");
        uDescContainer.classList.add("hidden");
        
        const startStr = clickedDate ? new Date(clickedDate) : new Date();
        const endStr = new Date(startStr.getTime() + 60 * 60 * 1000); 
        document.getElementById("event-start").value = formatForInput(startStr);
        document.getElementById("event-end").value = formatForInput(endStr);
    }
    modal.classList.remove("hidden");
}

function toggleDescMode(isEdit) {
    const editBtn = document.getElementById("toggle-desc-mode-btn");
    if (isEdit) {
        document.getElementById("event-description-display").classList.add("hidden");
        document.getElementById("event-description").classList.remove("hidden");
        if(document.getElementById("event-is-recurring").checked) document.getElementById("unique-desc-container").classList.remove("hidden");
        editBtn.textContent = "👁 View";
    } else {
        document.getElementById("event-description-display").classList.remove("hidden");
        document.getElementById("event-description").classList.add("hidden");
        document.getElementById("unique-desc-container").classList.add("hidden");
        editBtn.textContent = "✏️ Edit";
    }
}

document.getElementById("toggle-desc-mode-btn").addEventListener("click", (e) => {
    e.preventDefault();
    const isEditing = !document.getElementById("event-description").classList.contains("hidden");
    if (isEditing) {
        const d1 = document.getElementById("event-description").value;
        const d2 = document.getElementById("event-unique-description").value;
        const isRecur = document.getElementById("event-is-recurring").checked;
        let combined = d1;
        if (isRecur && d2) combined += `\n\n*Note:* ${d2}`;
        document.getElementById("event-description-display").innerHTML = renderDescription(combined);
    }
    toggleDescMode(!isEditing);
});

document.getElementById("event-is-recurring").addEventListener("change", (e) => {
    const isEditMode = !document.getElementById("event-description").classList.contains("hidden");
    if (e.target.checked) {
        document.getElementById("recurrence-fields").classList.remove("hidden");
        document.getElementById("single-date-fields").classList.add("hidden");
        if(isEditMode) document.getElementById("unique-desc-container").classList.remove("hidden");
    } else {
        document.getElementById("recurrence-fields").classList.add("hidden");
        document.getElementById("single-date-fields").classList.remove("hidden");
        document.getElementById("unique-desc-container").classList.add("hidden");
    }
});

document.getElementById("event-description").addEventListener("input", handleMentions);
document.getElementById("event-unique-description").addEventListener("input", handleMentions);

// ==========================================
// SEARCH & SIDEBAR LOGIC
// ==========================================
function showSidebarSearchResults(searchTerm) {
    if (sidebarMode !== "search") updateSidebarMode("search");
    
    const resultsContainer = document.getElementById("sidebar-search-results");
    resultsContainer.innerHTML = "";

    const matches = currentEvents.filter(ev => (ev.title || "").toLowerCase().includes(searchTerm));
    
    if (matches.length === 0) {
        resultsContainer.innerHTML = `<p class="muted-text" style="padding: 10px;">No events found.</p>`;
        return;
    }

    matches.forEach(ev => {
        const tColor = currentTimelines.find(t => t.id === ev.calendar_id)?.color || "var(--accent)";
        const tName = currentTimelines.find(t => t.id === ev.calendar_id)?.name || "Unknown";
        const dateStr = ev.is_recurring ? "Recurring" : new Date(ev.start_time).toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'});

        const div = document.createElement('div');
        div.className = "search-result-card";
        div.innerHTML = `
            <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 2px;">${ev.title}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
                <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${tColor}"></span>
                ${tName} &middot; ${dateStr}
            </div>
        `;
        div.addEventListener("click", () => openEventModal(ev));
        resultsContainer.appendChild(div);
    });
}

function clearSidebarSearch() { updateSidebarMode("normal"); }

// ==========================================
// PDF APPROVAL FLOW
// ==========================================
let approvalState = [];

function openSidebarApproval(events) {
    if (document.querySelector('.app-layout').classList.contains('sidebar-hidden')) {
        document.querySelector('.app-layout').classList.remove('sidebar-hidden');
        document.getElementById('sidebar-toggle').textContent = "‹";
    }

    updateSidebarMode("approval");
    const list = document.getElementById("approval-event-list");
    list.innerHTML = "";
    approvalState = events.map(ev => ({ event: ev, approved: true }));

    populateTimelineDropdown(document.getElementById("approval-timeline-select"));

    approvalState.forEach((item, idx) => {
        const card = document.createElement("div");
        card.className = "approval-card approved";
        card.innerHTML = `
            <div style="display: flex; gap: 8px; margin-bottom: 5px;">
                <button class="approval-toggle-btn" style="color: #10b981; font-weight:bold;">✓</button>
                <input type="text" class="form-input approval-title" value="${item.event.title || 'Untitled'}" style="margin:0; padding: 6px;">
            </div>
            <input type="date" class="form-input approval-date" value="${item.event.date || ''}" style="margin:0; padding: 6px; margin-bottom: 5px;">
            <div style="font-size: 0.7rem; color: var(--text-muted); font-style: italic;">Extracted: ${item.event.title} on ${item.event.date}</div>
        `;

        const toggleBtn = card.querySelector('.approval-toggle-btn');
        toggleBtn.addEventListener('click', () => {
            item.approved = !item.approved;
            if (item.approved) {
                card.classList.add('approved'); card.classList.remove('skipped');
                toggleBtn.textContent = "✓"; toggleBtn.style.color = "#10b981";
            } else {
                card.classList.remove('approved'); card.classList.add('skipped');
                toggleBtn.textContent = "✗"; toggleBtn.style.color = "var(--danger)";
            }
        });

        card.querySelector('.approval-title').addEventListener('input', e => item.event.editedTitle = e.target.value);
        card.querySelector('.approval-date').addEventListener('input', e => item.event.editedDate = e.target.value);
        list.appendChild(card);
    });
}

document.getElementById("approval-cancel-btn").addEventListener("click", () => {
    updateSidebarMode("normal");
    approvalState = [];
});

document.getElementById("approval-save-btn").addEventListener("click", async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = "Saving...";

    const calendarId = document.getElementById("approval-timeline-select").value;
    if(!calendarId || calendarId === "__new__") { 
        alert("Please create and select a timeline first."); 
        btn.disabled=false; 
        btn.textContent="✓ Save Approved"; 
        return; 
    }

    const finalEvents = approvalState.filter(i => i.approved).map(i => {
        const finalTitle = i.event.editedTitle || i.event.title;
        const finalDate = i.event.editedDate || i.event.date;
        return {
            title: finalTitle, start_time: `${finalDate}T09:00:00`, end_time: `${finalDate}T10:00:00`, is_recurring: false
        };
    });

    try {
        const res = await fetch(`${API_URL}/documents/save-approved-events/`, {
            method: 'POST', headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ calendar_id: parseInt(calendarId), events: finalEvents })
        });
        const data = await res.json();
        if (res.ok) {
            let addedIds = data.event_ids || [];
            pushHistory(
                async () => { for (let eid of addedIds) await fetch(`${API_URL}/events/${eid}`, {method: 'DELETE'}); },
                async () => {
                    let r = await fetch(`${API_URL}/documents/save-approved-events/`, {method: 'POST', headers: {"Content-Type":"application/json"}, body: JSON.stringify({ calendar_id: parseInt(calendarId), events: finalEvents }) });
                    let d = await r.json();
                    addedIds = d.event_ids; 
                },
                "PDF Import"
            );
            await loadData();
            updateSidebarMode("normal");
        }
    } catch (err) { console.error(err); }
    finally { btn.disabled = false; btn.textContent = "✓ Save Approved"; }
});

// ==========================================
// EXPORT TIMELINES LOGIC
// ==========================================
let exportFormat = "json";

document.getElementById('menu-export-btn').addEventListener('click', () => {
    document.getElementById('sidebar-dropdown').classList.add('hidden');
    openSidebarExport();
});

function openSidebarExport() {
    if (document.querySelector('.app-layout').classList.contains('sidebar-hidden')) {
        document.querySelector('.app-layout').classList.remove('sidebar-hidden');
        document.getElementById('sidebar-toggle').textContent = "‹";
    }
    updateSidebarMode("export");
    
    const list = document.getElementById("export-timeline-list");
    list.innerHTML = "";
    currentTimelines.forEach(t => {
        const row = document.createElement("div");
        row.className = "export-timeline-row";
        row.innerHTML = `
            <input type="checkbox" class="export-cb" value="${t.id}" checked>
            <span style="display:inline-block; width:12px; height:12px; border-radius:50%; background-color:${t.color || 'var(--accent)'}"></span>
            <span style="flex-grow: 1;">${t.name}</span>
        `;
        row.addEventListener('click', (e) => {
            if(e.target.tagName !== "INPUT") {
                const cb = row.querySelector('.export-cb');
                cb.checked = !cb.checked;
            }
        });
        list.appendChild(row);
    });
    
    document.getElementById("export-status").textContent = "";
    document.getElementById("export-toggle-all").textContent = "Deselect All";
}

function closeSidebarExport() {
    updateSidebarMode("normal");
}

document.getElementById("close-export-btn").addEventListener("click", closeSidebarExport);
document.getElementById("export-cancel-btn").addEventListener("click", closeSidebarExport);

document.getElementById("export-fmt-json").addEventListener("click", () => {
    exportFormat = "json";
    document.getElementById("export-fmt-json").classList.add("active");
    document.getElementById("export-fmt-ics").classList.remove("active");
});
document.getElementById("export-fmt-ics").addEventListener("click", () => {
    exportFormat = "ics";
    document.getElementById("export-fmt-ics").classList.add("active");
    document.getElementById("export-fmt-json").classList.remove("active");
});

document.getElementById("export-toggle-all").addEventListener("click", (e) => {
    const cbs = document.querySelectorAll('.export-cb');
    const isSelecting = e.target.textContent === "Select All";
    cbs.forEach(cb => cb.checked = isSelecting);
    e.target.textContent = isSelecting ? "Deselect All" : "Select All";
});

document.getElementById("export-confirm-btn").addEventListener("click", async () => {
    const checked = Array.from(document.querySelectorAll('.export-cb:checked')).map(cb => cb.value);
    const statusEl = document.getElementById("export-status");
    
    if (checked.length === 0) {
        statusEl.textContent = "Select at least one timeline.";
        statusEl.style.color = "var(--danger)";
        return;
    }
    
    const btn = document.getElementById("export-confirm-btn");
    btn.disabled = true;
    btn.textContent = "Exporting...";
    statusEl.textContent = "Generating file...";
    statusEl.style.color = "var(--accent)";
    
    try {
        const query = `calendar_ids=${checked.join(',')}&format=${exportFormat}`;
        const res = await fetch(`${API_URL}/export/timelines/?${query}`);
        
        if (!res.ok) {
            const errData = await res.json();
            statusEl.textContent = `Error: ${errData.error?.detail || 'Export failed'}`;
            statusEl.style.color = "var(--danger)";
            btn.disabled = false;
            btn.textContent = "↓ Export";
            return;
        }
        
        let blob;
        let filename;
        if (exportFormat === "json") {
            const data = await res.json();
            const jsonStr = JSON.stringify(data, null, 2);
            blob = new Blob([jsonStr], { type: 'application/json' });
            filename = "loom-export.json";
        } else {
            const textStr = await res.text();
            blob = new Blob([textStr], { type: 'text/calendar' });
            filename = "loom-export.ics";
        }
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        statusEl.textContent = "✓ Export downloaded";
        statusEl.style.color = "#10b981";
        
        setTimeout(() => {
            closeSidebarExport();
            btn.disabled = false;
            btn.textContent = "↓ Export";
        }, 1500);
        
    } catch (err) {
        statusEl.textContent = "Network error during export.";
        statusEl.style.color = "var(--danger)";
        btn.disabled = false;
        btn.textContent = "↓ Export";
    }
});


// ==========================================
// EVENT LISTENERS & UI
// ==========================================
function setupEventListeners() {
    // --- Undo / Redo Keybinds & Buttons ---
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
            if (e.shiftKey) { e.preventDefault(); performRedo(); }
            else { e.preventDefault(); performUndo(); }
        }
    });
    document.getElementById("undo-btn").addEventListener("click", performUndo);
    document.getElementById("redo-btn").addEventListener("click", performRedo);

    // --- Hamburger Menu ---
    document.getElementById('sidebar-menu-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('sidebar-dropdown').classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#sidebar-menu-btn') && !e.target.closest('#sidebar-dropdown')) {
            document.getElementById('sidebar-dropdown').classList.add('hidden');
        }
    });
    document.getElementById('menu-import-btn').addEventListener('click', () => {
        document.getElementById('sidebar-dropdown').classList.add('hidden');
        document.getElementById('import-error').classList.add('hidden');
        document.getElementById('import-file-input').click();
    });
    document.getElementById('menu-new-timeline-btn').addEventListener('click', () => {
        document.getElementById('sidebar-dropdown').classList.add('hidden');
        document.getElementById('timeline-modal').classList.remove('hidden');
    });

    // --- Scroll Wheel Zoom (Debounced) ---
    const views = ['dayGridMonth', 'timeGridWeek', 'timeGridDay'];
    let zoomDebounce = null;
    document.getElementById('calendar-container').addEventListener('wheel', (e) => {
        e.preventDefault();
        if (zoomDebounce) return;
        zoomDebounce = setTimeout(() => zoomDebounce = null, 300);
        const currentView = calendarInstance.view.type;
        let idx = views.indexOf(currentView);
        if (e.deltaY < 0 && idx < views.length - 1) calendarInstance.changeView(views[idx + 1]);
        else if (e.deltaY > 0 && idx > 0) calendarInstance.changeView(views[idx - 1]);
    });

    // --- Sidebar Toggle ---
    const sidebarToggle = document.getElementById("sidebar-toggle");
    sidebarToggle.addEventListener("click", () => {
        const layout = document.querySelector('.app-layout');
        layout.classList.toggle('sidebar-hidden');
        sidebarToggle.textContent = layout.classList.contains('sidebar-hidden') ? "›" : "‹";
        localStorage.setItem("loom-sidebar", layout.classList.contains('sidebar-hidden') ? "hidden" : "visible");
    });

    // --- Search Listener ---
    const searchInput = document.getElementById("event-search");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            const val = e.target.value.trim().toLowerCase();
            if (val === "") clearSidebarSearch(); else showSidebarSearchResults(val);
            renderCalendarEvents(val);
        });
    }

    // --- GLOBAL FORCED DELETE LISTENER (Timeline) ---
    window.onclick = async (e) => {
        const deleteBtn = e.target.closest('.delete-btn-action');
        if (deleteBtn) {
            e.preventDefault(); e.stopPropagation();
            let id = deleteBtn.getAttribute('data-id');
            const targetT = currentTimelines.find(t => t.id == id);
            try {
                const response = await fetch(`${API_URL}/calendars/${id}`, { method: 'DELETE', mode: 'cors' });
                if (response.ok) {
                    pushHistory(
                        async () => {
                            let r = await fetch(`${API_URL}/calendars/`, {method: 'POST', headers: {"Content-Type":"application/json"}, body: JSON.stringify({name: targetT.name, description: targetT.description, color: targetT.color})});
                            let d = await r.json(); id = d.id;
                        },
                        async () => { await fetch(`${API_URL}/calendars/${id}`, {method: 'DELETE'}); },
                        "Delete Timeline"
                    );
                    await loadData();
                }
            } catch (err) { console.error("Fetch failed entirely:", err); }
        }
    };

    // --- Event Modal Saves (With History) ---
    document.getElementById("add-event-btn").addEventListener("click", () => openEventModal());
    document.getElementById("cancel-event-btn").addEventListener("click", () => document.getElementById("event-modal").classList.add("hidden"));
    
    document.getElementById("save-event-btn").addEventListener("click", async () => {
        let id = document.getElementById("event-id").value;
        const isRecurring = document.getElementById("event-is-recurring").checked;
        const calId = document.getElementById("event-timeline").value;
        
        if(!calId || calId === "__new__") { alert("Please save the new timeline first."); return; }
        
        let payload = {
            title: document.getElementById("event-title").value,
            calendar_id: parseInt(calId),
            is_recurring: isRecurring,
            description: document.getElementById("event-description").value,
            unique_description: document.getElementById("event-unique-description").value
        };

        if (isRecurring) {
            const tStart = document.getElementById("recur-start-time").value || "09:00";
            const tEnd = document.getElementById("recur-end-time").value || "10:00";
            const today = new Date().toISOString().split('T')[0];
            payload.start_time = `${today}T${tStart}:00`; payload.end_time = `${today}T${tEnd}:00`;
            payload.recurrence_end = document.getElementById("recur-end-date").value;
            payload.recurrence_days = Array.from(document.querySelectorAll('.recur-day:checked')).map(cb => cb.value).join(',');
        } else {
            payload.start_time = new Date(document.getElementById("event-start").value).toISOString();
            payload.end_time = new Date(document.getElementById("event-end").value).toISOString();
            payload.recurrence_days = null; payload.recurrence_end = null;
        }

        const method = id ? "PUT" : "POST";
        const url = id ? `${API_URL}/events/${id}` : `${API_URL}/events/`;
        let preEditSnapshot = null;
        if (id) preEditSnapshot = currentEvents.find(e => e.id == id); 

        const response = await fetch(url, { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (response.ok) {
            const savedData = await response.json();
            if (!id) {
                let newId = savedData.id;
                pushHistory(
                    async () => { await fetch(`${API_URL}/events/${newId}`, {method: 'DELETE'}); },
                    async () => { let r = await fetch(`${API_URL}/events/`, {method: 'POST', headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload)}); let d = await r.json(); newId = d.id; },
                    "Create Event"
                );
            } else {
                pushHistory(
                    async () => { await fetch(`${API_URL}/events/${id}`, {method: 'PUT', headers: {"Content-Type":"application/json"}, body: JSON.stringify(preEditSnapshot)}); },
                    async () => { await fetch(`${API_URL}/events/${id}`, {method: 'PUT', headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload)}); },
                    "Edit Event"
                );
            }
        }
        document.getElementById("event-modal").classList.add("hidden");
        loadData();
    });

    document.getElementById("delete-event-btn").addEventListener("click", async () => {
        const id = document.getElementById("event-id").value;
        const targetEv = currentEvents.find(e => e.id == id);
        const response = await fetch(`${API_URL}/events/${id}`, { method: 'DELETE' });
        if (response.ok) {
            let restoredId = id;
            pushHistory(
                async () => { let r = await fetch(`${API_URL}/events/`, {method: 'POST', headers: {"Content-Type":"application/json"}, body: JSON.stringify(targetEv)}); let d = await r.json(); restoredId = d.id; },
                async () => { await fetch(`${API_URL}/events/${restoredId}`, {method: 'DELETE'}); },
                "Delete Event"
            );
        }
        document.getElementById("event-modal").classList.add("hidden");
        loadData();
    });

    // --- Timeline Modal ---
    document.getElementById("cancel-timeline-btn").addEventListener("click", () => {
        document.getElementById("timeline-modal").classList.add("hidden");
        pendingTimelineSelect = null; 
    });
    
    document.getElementById("save-timeline-btn").addEventListener("click", async () => {
        const name = document.getElementById("timeline-name").value;
        if (!name) return;
        const payload = { name: name, description: "" };
        const response = await fetch(`${API_URL}/calendars/`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
        });
        if (response.ok) {
            const savedData = await response.json();
            let newId = savedData.id;
            pushHistory(
                async () => { await fetch(`${API_URL}/calendars/${newId}`, {method: 'DELETE'}); },
                async () => { let r = await fetch(`${API_URL}/calendars/`, {method:'POST', headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload)}); let d = await r.json(); newId = d.id; },
                "Create Timeline"
            );
            await loadData();
            if (pendingTimelineSelect) {
                populateTimelineDropdown(pendingTimelineSelect);
                pendingTimelineSelect.value = newId;
                pendingTimelineSelect = null;
            }
        }
        document.getElementById("timeline-modal").classList.add("hidden");
        document.getElementById("timeline-name").value = "";
    });

    // Settings
    document.getElementById("settings-btn").onclick = () => document.getElementById("settings-modal").classList.remove("hidden");
    document.getElementById("close-settings-btn").onclick = () => document.getElementById("settings-modal").classList.add("hidden");
    document.getElementById("theme-toggle").onclick = () => {
        document.body.classList.toggle("light-mode");
        localStorage.setItem("loom-theme", document.body.classList.contains("light-mode") ? "light" : "dark");
    };
    if (localStorage.getItem("loom-theme") === "light") document.body.classList.add("light-mode");
    document.getElementById("week-start-select").onchange = (e) => calendarInstance.setOption('firstDay', parseInt(e.target.value));

    // ==========================================
    // ICS IMPORT LOGIC
    // ==========================================
    const importFileInput = document.getElementById('import-file-input');
    const importError = document.getElementById('import-error');
    const icsModal = document.getElementById('ics-import-modal');
    const confirmIcsBtn = document.getElementById('confirm-ics-btn');

    importFileInput.addEventListener('change', async (e) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        const filename = file.name.toLowerCase();
        
        ['event-timeline', 'ics-timeline-select', 'approval-timeline-select'].forEach(id => populateTimelineDropdown(document.getElementById(id)));

        if (filename.endsWith('.ics')) {
            document.getElementById('ics-import-status').textContent = `File: ${file.name}`;
            document.getElementById('ics-import-status').style.color = "var(--text-main)";
            confirmIcsBtn.disabled = false;
            confirmIcsBtn.textContent = "Import";
            icsModal.classList.remove('hidden');
        } else if (filename.endsWith('.pdf')) {
            importError.textContent = "🔍 Reading syllabus with AI... this may take 10-15 seconds.";
            importError.style.color = "var(--accent)";
            importError.classList.remove('hidden');
            
            const formData = new FormData(); formData.append('file', file);
            try {
                const response = await fetch(`${API_URL}/documents/extract-syllabus/`, { method: 'POST', body: formData });
                const result = await response.json();
                if (response.ok && result.events && result.events.length > 0) {
                    importError.classList.add('hidden');
                    openSidebarApproval(result.events);
                } else {
                    importError.textContent = "No valid dates could be extracted from this PDF.";
                    importError.style.color = "var(--danger)";
                    setTimeout(() => updateSidebarMode("normal"), 3000);
                }
            } catch (err) { importError.textContent = "Network error during AI extraction."; importError.style.color = "var(--danger)"; }
        }
    });

    document.getElementById('cancel-ics-btn').addEventListener('click', () => { icsModal.classList.add('hidden'); importFileInput.value = ""; });
    confirmIcsBtn.addEventListener('click', async () => {
        const calId = document.getElementById('ics-timeline-select').value;
        if(!calId || calId === "__new__") { alert("Please save the new timeline first."); return; }
        
        confirmIcsBtn.disabled = true; confirmIcsBtn.textContent = "Importing...";
        const file = importFileInput.files[0];
        const formData = new FormData(); formData.append('file', file); formData.append('calendar_id', calId);

        try {
            const response = await fetch(`${API_URL}/integrations/import-ics-file/`, { method: 'POST', body: formData });
            const data = await response.json();
            if (response.ok) {
                document.getElementById('ics-import-status').textContent = `✓ Imported successfully!`;
                document.getElementById('ics-import-status').style.color = "#10b981";
                
                let addedIds = data.event_ids || [];
                let fileClone = new File([file], file.name, {type: file.type});
                pushHistory(
                    async () => { for (let eid of addedIds) await fetch(`${API_URL}/events/${eid}`, {method: 'DELETE'}); },
                    async () => {
                        let fd = new FormData(); fd.append('file', fileClone); fd.append('calendar_id', calId);
                        let r = await fetch(`${API_URL}/integrations/import-ics-file/`, {method: 'POST', body: fd});
                        let d = await r.json(); addedIds = d.event_ids; 
                    },
                    "ICS Import"
                );
                
                await loadData();
                setTimeout(() => { icsModal.classList.add('hidden'); importFileInput.value = ""; }, 1500);
            } else { confirmIcsBtn.disabled = false; }
        } catch (err) { confirmIcsBtn.disabled = false; }
    });
}

// ==========================================
// MICROPHONE LOGIC
// ==========================================
let mediaRecorder; let audioChunks = []; let isRecording = false;
const micBtn = document.getElementById("mic-btn"); const consentModal = document.getElementById("consent-modal");

if (micBtn) {
    micBtn.addEventListener("click", () => {
        if (!isRecording) consentModal.classList.remove("hidden"); else stopRecording();
    });
}
document.getElementById("decline-btn").addEventListener("click", () => consentModal.classList.add("hidden"));
document.getElementById("accept-btn").addEventListener("click", () => { consentModal.classList.add("hidden"); startRecording(); });

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream); audioChunks = [];
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.start(); isRecording = true;
        micBtn.innerHTML = "🛑 Stop Listening"; micBtn.className = "mic-active";
    } catch (err) { alert("Microphone access denied."); }
}
async function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(track => track.stop());
        micBtn.innerHTML = "⏳ Processing..."; micBtn.className = "mic-inactive";
        mediaRecorder.onstop = async () => {
            const formData = new FormData(); formData.append("file", new Blob(audioChunks, { type: 'audio/webm' }), "recording.webm");
            try { await fetch(`${API_URL}/transcribe`, { method: "POST", body: formData }); await loadData(); } catch (err) { console.error(err); } 
            finally { micBtn.innerHTML = "🎤 Listen"; isRecording = false; }
        };
    }
}