import { logger } from './logger.js';
import { initNotifications, addNotification, updateNotification } from './notifications.js';
import { initAppDrawer } from './components/appDrawer.js';
import { initContextSidebar, expand as expandSidebar } from './components/contextSidebar.js';
import { initTopBar, setActiveView } from './components/topBar.js';

const API_URL = "http://127.0.0.1:8000";

window.__loomCrashHandler = function showCrashDialog(errorInfo) {
    const modal = document.getElementById('crash-modal');
    if (!modal || modal.__shown) return;
    modal.__shown = true;
    const detail = document.getElementById('crash-modal-detail');
    if (detail) detail.textContent = errorInfo?.message ?? 'Unknown error';
    modal.classList.remove('hidden');
};
let calendarInstance;
let currentEvents = [];
let currentTimelines = [];
let isLoading = true;
let tooltipTimer;
let onboardingStep = 0;
const ONBOARD_STEPS = 3;
let activeReminders = {};
let currentEventTimezone = 'local'; 
let lastSyncTime = null;
let syncIntervalId = null;
let syncState = 'ok'; // L5: tracks last sync outcome to prevent stale display
let selectedEventIds = new Set(); // H1: multi-select for bulk operations
let doubleClickTimers = {}; // H1: per-event double-click detection map
let focusIntervals = []; // L2: all setInterval IDs created by focus mode (cleared on close)
let agendaTimeout = null; // M4: auto-dismiss timer handle
let firstLoadDone = false; // M4: show daily agenda only after the very first data load
let focusMode = 'session'; // L2: 'session' (count-up) | 'pomodoro' (countdown)
let focusStartTime = null; // L2: epoch ms when session timer started
let pomodoroSecondsLeft = 25 * 60; // L2: countdown state
let currentChecklist = []; // L3: in-memory checklist for the event currently open in the modal
let currentTasks = []; // Task Board: in-memory task list (replaces M1 todos)
let currentTaskFilter = 'all'; // Task Board: current filter state
let analyzeDebounceTimer = null; // M2: debounce handle for schedule analysis
// TODO v2.0 cleanup: drawerOpen obsolete — app drawer is now always-visible (components/appDrawer.js)
let drawerOpen = false;

// H5: day-of-week index to abbreviation
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleReminders();
});
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
// SYNC STATUS INDICATOR (L5)
// ==========================================
function updateSyncStatus(state) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    syncState = state;
    if (state === 'ok') {
        lastSyncTime = new Date();
        el.style.color = 'var(--text-muted)';
        updateSyncTimeDisplay();
    } else {
        el.textContent = 'Sync failed';
        el.style.color = 'var(--danger)';
    }
    // Start the 30-second relative-time refresh if not already running
    if (!syncIntervalId) {
        syncIntervalId = setInterval(updateSyncTimeDisplay, 30000);
    }
}

function updateSyncTimeDisplay() {
    // Only update text when last sync was successful
    if (syncState !== 'ok' || !lastSyncTime) return;
    const el = document.getElementById('sync-status');
    if (!el) return;
    const diffSec = Math.floor((Date.now() - lastSyncTime.getTime()) / 1000);
    let rel;
    if (diffSec < 10) rel = 'just now';
    else if (diffSec < 60) rel = `${diffSec}s ago`;
    else rel = `${Math.floor(diffSec / 60)}m ago`;
    el.textContent = `Synced ${rel}`;
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
    const statsPanel = document.getElementById('sidebar-stats-panel'); // M5
    const templatesPanel = document.getElementById('sidebar-templates-panel'); // M3
    const taskboardPanel = document.getElementById('sidebar-taskboard-panel'); // Task Board

    mainSections.forEach(el => el.classList.add('hidden'));
    searchResults.classList.add('hidden');
    approvalPanel.classList.add('hidden');
    exportPanel.classList.add('hidden');
    if (statsPanel) statsPanel.classList.add('hidden'); // M5
    if (templatesPanel) templatesPanel.classList.add('hidden'); // M3
    if (taskboardPanel) taskboardPanel.classList.add('hidden'); // Task Board

    if (mode === "normal") {
        mainSections.forEach(el => el.classList.remove('hidden'));
    } else if (mode === "search") {
        searchResults.classList.remove('hidden');
    } else if (mode === "approval") {
        approvalPanel.classList.remove('hidden');
    } else if (mode === "export") {
        exportPanel.classList.remove('hidden');
    } else if (mode === "stats") { // M5
        if (statsPanel) statsPanel.classList.remove('hidden');
    } else if (mode === "templates") { // M3
        if (templatesPanel) templatesPanel.classList.remove('hidden');
    } else if (mode === "taskboard") { // Task Board
        if (taskboardPanel) taskboardPanel.classList.remove('hidden');
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

function positionTooltip(cx, cy) {
  const t = document.getElementById('event-tooltip');
  t.style.left = '-9999px'; t.style.top = '-9999px'; t.style.visibility = 'hidden';
  // Measure after positioning offscreen
  requestAnimationFrame(() => {
    const rect = t.getBoundingClientRect();
    let x = cx + 14, y = cy - 10;
    if (x + rect.width > window.innerWidth - 12) x = cx - rect.width - 14;
    if (y + rect.height > window.innerHeight - 12) y = window.innerHeight - rect.height - 12;
    if (y < 8) y = 8;
    t.style.left = x + 'px'; t.style.top = y + 'px'; t.style.visibility = 'visible';
  });
}

function showOnboardingStep(index) {
  document.querySelectorAll('.onboarding-step').forEach((el, i) => el.classList.toggle('active', i === index));
  document.querySelectorAll('.onboarding-dot').forEach((dot, i) => dot.classList.toggle('active', i === index));
  document.getElementById('onboarding-prev-btn').disabled = index === 0;
  const isLast = index === ONBOARD_STEPS - 1;
  document.getElementById('onboarding-next-btn').textContent = isLast ? 'Get Started' : 'Next';
}

// ==========================================
// CALENDAR INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async function() {
    // v2.0: Context sidebar handles its own state restore
    initContextSidebar();

    const calendarEl = document.getElementById('calendar-container');
    const isTouch = 'ontouchstart' in window;
    
    const calendarOptions = {
      initialView: 'dayGridMonth',
      editable: true, // Enables drag & drop / resize
      eventResizableFromStart: true, // NEW: Enables resizing from the start edge
      droppable: true, // NEW: Enables external/internal dropping capabilities
      selectable: true, // H1: enable drag-select across the grid to create events
      headerToolbar: false, // v2.0: view switcher + date nav live in .top-bar (topBar.js)
      height: '100%',
      events: [],

      // v2.0: custom event pill rendering
      eventContent: function(arg) {
          const ev = arg.event;
          const color = ev.extendedProps.timelineColor || '#6366f1';
          const isAllDay = ev.allDay;
          const el = document.createElement('div');
          el.className = 'loom-event-pill' + (isAllDay ? ' loom-event-pill--allday' : '');
          el.style.setProperty('--ev-color', color);
          if (!isAllDay && ev.start) {
              const t = ev.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
              const timeEl = document.createElement('span');
              timeEl.className = 'loom-event-time';
              timeEl.textContent = t;
              el.appendChild(timeEl);
          }
          const titleEl = document.createElement('span');
          titleEl.className = 'loom-event-title';
          titleEl.textContent = ev.title;
          el.appendChild(titleEl);
          return { domNodes: [el] };
      },

      // v2.0: today date circle
      dayCellContent: function(arg) {
          const el = document.createElement('div');
          el.className = 'loom-day-num' + (arg.isToday ? ' loom-day-num--today' : '');
          el.textContent = arg.date.getDate();
          return { domNodes: [el] };
      },

      // H1: drag-select across grid → open new event modal for that range
      select: function(info) {
        openEventModal(null, info.startStr);
        calendarInstance.unselect();
      },

      // H1: single click = select/deselect; double click (200ms) = open modal
      eventClick: function(info) {
        const id = parseInt(info.event.id);
        if (doubleClickTimers[id]) {
          // Second click within 200ms → open modal
          clearTimeout(doubleClickTimers[id]);
          delete doubleClickTimers[id];
          const rawEvent = currentEvents.find(e => e.id == id);
          // H4: pass the specific instance start so skip-occurrence knows which date
          openEventModal(rawEvent || info.event, null, info.event.start);
          return;
        }
        // First click → wait to see if a second click follows
        doubleClickTimers[id] = setTimeout(() => {
          delete doubleClickTimers[id];
          // Toggle selection: add/remove class and track in set (single-click = select)
          if (selectedEventIds.has(id)) {
            selectedEventIds.delete(id);
            info.el.classList.remove('fc-event-selected');
          } else {
            selectedEventIds.add(id);
            info.el.classList.add('fc-event-selected');
          }
        }, 200);
      },
      dateClick: function(info) { openEventModal(null, info.dateStr); },
      
      // NEW: Add visual class when dragging starts
      eventDragStart: function(info) {
        info.el.classList.add('fc-event-dragging');
      },

      // UPDATED: Combined Conflict Check & Drag-and-Drop Rescheduling
      eventDrop: async function(info) {
        const ev = info.event;
        const id = ev.id;
        
        // 1. Conflict Check (from previous feature)
        const conflicts = checkForConflicts(ev.startStr, ev.endStr || ev.startStr, ev.extendedProps.calendar_id, id);
        if (conflicts.length > 0) {
            const errEl = document.getElementById('import-error');
            errEl.textContent = `Warning: Dropped event overlaps with ${conflicts.slice(0,2).join(', ')}`;
            errEl.style.color = "var(--danger)";
            errEl.classList.remove('hidden');
            setTimeout(() => errEl.classList.add('hidden'), 3500);
        }

        // 2. Capture pre-drop state for Undo Stack
        const preDrop = currentEvents.find(e => e.id === parseInt(id));
        if (!preDrop) return; // Guard clause

        const payload = {
            title: ev.title,
            start_time: ev.start.toISOString(),
            // Guard: end may be null for all-day events
            end_time: ev.end ? ev.end.toISOString() : ev.start.toISOString(), 
            calendar_id: ev.extendedProps.calendar_id
        };

        // Push undo BEFORE the fetch so it's available even if fetch fails
        undoStack.push({
            label: 'Move event',
            undo: async () => {
                await fetch(`${API_URL}/events/${id}`, {
                    method: 'PUT', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ ...payload, start_time: preDrop.start_time, end_time: preDrop.end_time })
                });
            },
            redo: async () => {
                await fetch(`${API_URL}/events/${id}`, {
                    method: 'PUT', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify(payload)
                });
            }
        });
        if (undoStack.length > 50) undoStack.shift();
        redoStack = [];
        updateUndoRedoButtons();

        // 3. Persist the new time to the backend
        try {
            const res = await fetch(`${API_URL}/events/${id}`, {
                method: 'PUT', headers: {'Content-Type':'application/json'},
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                info.revert(); // FullCalendar snaps event back visually
                document.getElementById('import-error').textContent = 'Failed to save event move.';
                document.getElementById('import-error').classList.remove('hidden');
                setTimeout(() => document.getElementById('import-error').classList.add('hidden'), 3000);
            } else {
                await loadData();
            }
        } catch {
            info.revert();
        }
      },
      
      // Conflict check on duration resize
      // UPDATED: Combined Conflict Check & Event Resizing Persistence
      eventResize: async function(info) {
        const ev = info.event;
        const id = ev.id;
        
        // 1. Conflict Check (from B1F)
        const conflicts = checkForConflicts(ev.startStr, ev.endStr, ev.extendedProps.calendar_id, id);
        if (conflicts.length > 0) {
            const errEl = document.getElementById('import-error');
            errEl.textContent = `Warning: Resized event overlaps with ${conflicts.slice(0,2).join(', ')}`;
            errEl.style.color = "var(--danger)";
            errEl.classList.remove('hidden');
            setTimeout(() => errEl.classList.add('hidden'), 3500);
        }

        // 2. Capture pre-resize state for Undo Stack
        const preResize = currentEvents.find(e => e.id === parseInt(id));
        if (!preResize) return;

        const payload = {
            title: ev.title,
            start_time: ev.start.toISOString(),
            end_time: ev.end ? ev.end.toISOString() : ev.start.toISOString(),
            calendar_id: ev.extendedProps.calendar_id
        };

        // Push undo entry before fetch
        undoStack.push({
            label: 'Resize event',
            undo: async () => { 
                await fetch(`${API_URL}/events/${id}`, { 
                    method: 'PUT', headers: {'Content-Type':'application/json'}, 
                    body: JSON.stringify({...payload, start_time: preResize.start_time, end_time: preResize.end_time}) 
                }); 
            },
            redo: async () => { 
                await fetch(`${API_URL}/events/${id}`, { 
                    method: 'PUT', headers: {'Content-Type':'application/json'}, 
                    body: JSON.stringify(payload) 
                }); 
            }
        });
        if (undoStack.length > 50) undoStack.shift();
        redoStack = [];
        updateUndoRedoButtons();

        // 3. Persist the new time to the backend
        try {
            const res = await fetch(`${API_URL}/events/${id}`, { 
                method: 'PUT', headers: {'Content-Type':'application/json'}, 
                body: JSON.stringify(payload) 
            });
            if (!res.ok) { 
                info.revert(); 
                document.getElementById('import-error').textContent = 'Failed to save event resize.';
                document.getElementById('import-error').classList.remove('hidden');
                setTimeout(() => document.getElementById('import-error').classList.add('hidden'), 3000);
            } else { 
                await loadData(); 
            }
        } catch { 
            info.revert(); 
        }
      }
    };

    // Skip on touch devices
    if (!isTouch) {
        calendarOptions.eventMouseEnter = function(info) {
          tooltipTimer = setTimeout(() => {
            const ev = info.event;
            const rawId = parseInt(ev.id);
            const rawEvent = currentEvents.find(e => e.id === rawId);
            const timeline = currentTimelines.find(t => t.id === ev.extendedProps.calendar_id);
            const start = new Date(ev.start);
            const end = ev.end ? new Date(ev.end) : null;
            const timeStr = start.toLocaleString('en-US', {weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})
              + (end ? ' – ' + end.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'}) : '');

            const descHtml = renderDescription(rawEvent?.description || ev.extendedProps.description || '');

            let checklistHtml = '';
            if (rawEvent?.checklist) {
              try {
                const items = JSON.parse(rawEvent.checklist);
                if (items.length) {
                  checklistHtml = `
                    <div class="hc-divider"></div>
                    <div class="hc-checklist">
                      ${items.map(item => `
                        <div class="hc-check-item${item.done ? ' done' : ''}">
                          <span class="hc-check-icon">${item.done ? '✓' : '○'}</span>
                          <span>${item.text.replace(/</g, '&lt;')}</span>
                        </div>`).join('')}
                    </div>`;
                }
              } catch {}
            }

            const tooltip = document.getElementById('event-tooltip');
            tooltip.innerHTML = `
              <div class="hc-title">${rawEvent?.title ?? ev.title}</div>
              <div class="hc-meta">${timeStr}</div>
              ${timeline ? `<div class="hc-meta">📁 ${timeline.name}</div>` : ''}
              ${descHtml ? `<div class="hc-divider"></div><div class="hc-desc">${descHtml}</div>` : ''}
              ${checklistHtml}
            `;
            tooltip.classList.remove('hidden');
            positionTooltip(info.jsEvent.clientX, info.jsEvent.clientY);
          }, 150);
        };
        
        calendarOptions.eventMouseLeave = function() {
          clearTimeout(tooltipTimer);
          document.getElementById('event-tooltip').classList.add('hidden');
        };
    }

    calendarInstance = new FullCalendar.Calendar(calendarEl, calendarOptions);

    calendarInstance.render();

    // v2.0: wire top bar view switcher + date nav to calendarInstance
    document.addEventListener('loom:view-change', (e) => {
        calendarInstance.changeView(e.detail.view);
        setActiveView(e.detail.view);
    });
    document.addEventListener('loom:date-nav', (e) => {
        if (e.detail.action === 'prev')  calendarInstance.prev();
        else if (e.detail.action === 'next')  calendarInstance.next();
        else if (e.detail.action === 'today') calendarInstance.today();
    });
    // v2.0: app drawer navigation
    document.addEventListener('loom:navigate', (e) => {
        const dest = e.detail.destination;
        localStorage.setItem('loom:destination', dest);

        // Toggle sidebar sections by destination
        const focusSec = document.getElementById('focus-sidebar-section');
        const calSec   = document.getElementById('calendar-sidebar-section');
        const tasksSec = document.getElementById('tasks-sidebar-section');
        const notCal = dest !== 'calendar';
        if (focusSec) focusSec.classList.toggle('hidden', dest !== 'focus');
        if (calSec)   calSec.classList.toggle('hidden',   notCal);
        if (tasksSec) tasksSec.classList.toggle('hidden', dest !== 'tasks');
        document.querySelector('.record-section')?.classList.toggle('hidden', notCal);
        document.getElementById('sidebar-filters-section')?.classList.toggle('hidden', notCal);

        // Show/hide calendar container — never destroy it (FullCalendar stays mounted)
        const calContainer = document.getElementById('calendar-container');
        if (calContainer) calContainer.style.display = dest === 'calendar' ? '' : 'none';
        const schedWarnings = document.getElementById('schedule-warnings');
        if (schedWarnings) schedWarnings.style.display = dest === 'calendar' ? '' : 'none';

        // Remove any existing overlay pages (focus / tasks)
        document.getElementById('focus-page')?.remove();
        document.getElementById('taskboard-page')?.remove();
        focusIntervals.forEach(clearInterval);
        focusIntervals = [];

        if (dest === 'focus') {
            renderFocusPage();
        } else if (dest === 'tasks') {
            renderTaskBoardPage();
        } else if (dest === 'settings') {
            document.getElementById('settings-modal')?.classList.remove('hidden');
        } else if (dest === 'calendar') {
            updateSidebarMode('normal');
        }
    });

    bindTimelineDropdowns();
    await loadData();
    logger.info("LoomAssist initialized");

    // Check if the previous run crashed
    try {
        const flagRes = await fetch(`${API_URL}/api/logs/crash-flag`);
        if (flagRes.ok) {
            const { crashed, crash_file } = await flagRes.json();
            const reportsEnabled = localStorage.getItem('loom_crash_reports_enabled') !== 'false';
            if (crashed && reportsEnabled) {
                window.__loomCrashHandler({ message: `Crash detected (${crash_file ?? 'unknown'})` });
            }
        }
    } catch { /* backend not ready — skip */ }

    // Listen for Rust panic events from Tauri
    if (window.__TAURI__) {
        window.__TAURI__.event.listen('rust-panic', (ev) => {
            window.__loomCrashHandler?.(ev.payload);
        });
    }

    setupEventListeners();
    initNotifications();
    initTopBar();
    logger.setFlushCallback((batch) => {
        const errors = batch.filter(e => e.level === 'ERROR');
        errors.forEach(e => addNotification({
            type: 'warning',
            title: 'Error captured',
            message: e.message,
            dismissible: true,
        }));
    });
    initAppDrawer(); // v2.0: imported from components/appDrawer.js — wires the 56px persistent rail
    if (!localStorage.getItem('loom-onboarded')) {
        setTimeout(() => document.getElementById('onboarding-modal').classList.remove('hidden'), 600);
    }
});

// ==========================================
// DATA LOADING
// ==========================================
function scheduleReminders() {
  // Step 1: Cancel all existing scheduled reminders
  Object.values(activeReminders).forEach(clearTimeout);
  activeReminders = {};

  // Step 2: Request Notification permission if not yet granted
  // Do NOT request on page load — request only when there are events with reminders
  const hasReminders = currentEvents.some(e => e.reminder_minutes);
  if (hasReminders && Notification.permission === 'default') {
    Notification.requestPermission(); // Non-blocking — don't await
  }

  // Step 3: Schedule each reminder
  const now = Date.now();
  currentEvents.forEach(event => {
    if (!event.reminder_minutes) return;

    const startMs = new Date(event.start_time).getTime();
    const triggerMs = startMs - (event.reminder_minutes * 60 * 1000);
    const msUntil = triggerMs - now;

    if (msUntil > 0) {
      // Future reminder — schedule it
      activeReminders[event.id] = setTimeout(() => showReminder(event), msUntil);
    } else if (msUntil > -60000) {
      // Within the past 60 seconds — show immediately (missed due to tab sleep)
      showReminder(event);
    }
    // Older than 60s — skip silently
  });
}

function showReminder(event) {
  const minuteLabel = event.reminder_minutes >= 60
    ? `${event.reminder_minutes / 60} hour${event.reminder_minutes === 60 ? '' : 's'}`
    : `${event.reminder_minutes} minutes`;

  if (Notification.permission === 'granted') {
    new Notification('Loom Reminder', {
      body: `${event.title} starts in ${minuteLabel}`,
      icon: '/favicon.ico',
    });
  }

  addNotification({
    type: 'warning',
    title: 'Upcoming event',
    message: `${event.title} starts in ${minuteLabel}`,
    dismissible: true,
    autoRemoveMs: null,
    actionable: true,
    actionLabel: 'Open event →',
    actionFn: () => {
      const ev = currentEvents.find(e => e.id === event.id);
      if (ev) openEventModal(ev);
    },
  });
}
async function loadData() {
    let syncSuccess = true;
    
    try {
        const calResponse = await fetch(`${API_URL}/calendars/`);
        if (calResponse.ok) {
            currentTimelines = await calResponse.json();
            renderSidebar(currentTimelines);
            ['event-timeline', 'ics-timeline-select', 'approval-timeline-select'].forEach(id => populateTimelineDropdown(document.getElementById(id)));
        } else {
            syncSuccess = false;
        }
    } catch (error) {
        logger.warn("Failed to load timelines", { message: error?.message });
        syncSuccess = false;
    }

    try {
        const evResponse = await fetch(`${API_URL}/events/`);
        if (evResponse.ok) {
            currentEvents = await evResponse.json();
            const searchTerm = document.getElementById("event-search")?.value.toLowerCase() || "";
            renderCalendarEvents(searchTerm);
            if (sidebarMode === "search") showSidebarSearchResults(searchTerm);
        } else {
            renderCalendarEvents("");
            syncSuccess = false;
        }
    } catch (error) {
        logger.warn("Failed to load events", { message: error?.message });
        syncSuccess = false;
    }

    isLoading = false; // Disable loading flag
    updateEmptyStates(); // Update states now that data is fetched
    scheduleReminders(); // Re-evaluate notifications after data sync

    if (syncSuccess) {
        updateSyncStatus('ok');
    } else {
        updateSyncStatus('error');
    }

    // M4: show daily agenda overlay only on the very first successful load
    if (!firstLoadDone) {
        firstLoadDone = true;
        if (syncSuccess) showDailyAgenda();
    }

    // M2: debounced schedule analysis — prevents spamming Ollama on rapid loadData() calls
    clearTimeout(analyzeDebounceTimer);
    analyzeDebounceTimer = setTimeout(runScheduleAnalysis, 500);

    // Task Board: keep task list fresh after every data reload
    loadTasks();
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

        // H3: delete btn visible by default (checkbox starts checked); hidden on uncheck
        li.innerHTML = `
            <input type="checkbox" class="timeline-checkbox" data-id="${timeline.id}" checked>
            <input type="color" class="timeline-color-picker" data-id="${timeline.id}" value="${safeColor}" title="Change timeline color">
            <span class="timeline-name" data-id="${timeline.id}" title="Double-click to rename">${timeline.name}</span>
            <button class="delete-timeline-btn delete-btn-action" data-id="${timeline.id}">×</button>
        `;
        listElement.appendChild(li);

        const checkbox = li.querySelector('.timeline-checkbox');
        const deleteBtn = li.querySelector('.delete-timeline-btn');
        const nameSpan = li.querySelector('.timeline-name');
        const colorPicker = li.querySelector('.timeline-color-picker');

        // H3: toggle delete button visibility based on checkbox state
        checkbox.addEventListener('change', () => {
            deleteBtn.style.display = checkbox.checked ? '' : 'none';
            const searchTerm = document.getElementById("event-search")?.value.toLowerCase() || "";
            renderCalendarEvents(searchTerm);
        });

        // H3: double-click timeline name to rename inline; PUT on blur/Enter
        nameSpan.addEventListener('dblclick', () => {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = timeline.name;
            input.className = 'timeline-rename-input';
            nameSpan.replaceWith(input);
            input.focus();
            input.select();

            const saveRename = async () => {
                const newName = input.value.trim();
                if (newName && newName !== timeline.name) {
                    try {
                        const payload = { name: newName, description: timeline.description || '', color: safeColor };
                        const res = await fetch(`${API_URL}/calendars/${timeline.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        if (res.ok) { await loadData(); return; }
                    } catch { /* fall through to revert */ }
                }
                // Revert on cancel or error
                input.replaceWith(nameSpan);
            };

            input.addEventListener('blur', saveRename);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
                if (e.key === 'Escape') { input.removeEventListener('blur', saveRename); input.replaceWith(nameSpan); }
            });
        });

        // Color picker: PUT updated color
        colorPicker.addEventListener('change', async (e) => {
            const t = currentTimelines.find(t => t.id === timeline.id);
            if (t) {
                try {
                    const payload = { name: t.name, description: t.description, color: e.target.value };
                    const response = await fetch(`${API_URL}/calendars/${timeline.id}`, { method: 'PUT', headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                    if (response.ok) await loadData();
                } catch (err) { console.error("Network error saving color:", err); }
            }
        });
    });

    updateEmptyStates();
}

// ==========================================
// MAP EVENT — H5: extracted so per-day-times can return an array
// ==========================================
function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0,2), 16);
    const g = parseInt(h.slice(2,4), 16);
    const b = parseInt(h.slice(4,6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function mapEvent(event) {
    const parentTimeline = currentTimelines.find(t => t.id === event.calendar_id);
    const timelineColor = (parentTimeline && parentTimeline.color) ? parentTimeline.color : "#6366f1";

    // L3: build display title with checklist badge if applicable
    let displayTitle = event.title;
    if (event.checklist) {
        try {
            const items = JSON.parse(event.checklist);
            if (items.length > 0) {
                const doneCount = items.filter(i => i.done).length;
                displayTitle = `${event.title} (${doneCount}/${items.length})`;
            }
        } catch { /* malformed JSON — use raw title */ }
    }

    // H2: all-day / multi-day events — pass date-only strings; end is exclusive in FC
    if (event.is_all_day) {
        const startDate = event.start_time.split('T')[0];
        const endDateRaw = event.end_time.split('T')[0];
        // FullCalendar all-day end is exclusive — add one day
        const endDt = new Date(endDateRaw + 'T00:00:00');
        endDt.setDate(endDt.getDate() + 1);
        const endDate = endDt.toISOString().split('T')[0];
        return {
            id: event.id, title: displayTitle,
            start: startDate, end: endDate,
            allDay: true,
            backgroundColor: timelineColor, borderColor: timelineColor, textColor: '#ffffff',
            extendedProps: { calendar_id: event.calendar_id, is_recurring: false, description: event.description, timelineColor }
        };
    }

    if (event.is_recurring) {
        const startDate = new Date(event.start_time);
        const endDate = new Date(event.end_time);

        // H5: per_day_times set — expand into one FC object per day key
        if (event.per_day_times) {
            try {
                const perDayMap = JSON.parse(event.per_day_times);
                const results = Object.entries(perDayMap).map(([dayNum, [startTime, endTime]]) => ({
                    id: `${event.id}-day${dayNum}`,
                    title: displayTitle,
                    daysOfWeek: [parseInt(dayNum)],
                    startTime, endTime,
                    startRecur: event.start_time.split('T')[0],
                    endRecur: event.recurrence_end,
                    backgroundColor: hexToRgba(timelineColor, 0.15), borderColor: 'transparent', textColor: '#E2E8F0',
                    extendedProps: { calendar_id: event.calendar_id, is_recurring: true, description: event.description, parent_id: event.id, timelineColor }
                }));
                if (results.length > 0) return results;
            } catch { /* fall through to default recurring render */ }
        }

        let evtObj = {
            id: event.id, title: displayTitle,
            daysOfWeek: event.recurrence_days ? event.recurrence_days.split(',').map(Number) : [],
            startTime: startDate.toTimeString().substring(0, 5),
            endTime: endDate.toTimeString().substring(0, 5),
            startRecur: event.start_time.split('T')[0], endRecur: event.recurrence_end,
            backgroundColor: hexToRgba(timelineColor, 0.15), borderColor: 'transparent', textColor: '#E2E8F0',
            extendedProps: { calendar_id: event.calendar_id, is_recurring: true, description: event.description, timelineColor }
        };
        // H4: pass skipped dates as exdate so FC omits those instances
        if (event.skipped_dates) {
            const skipped = event.skipped_dates.split(',').filter(d => d.trim());
            if (skipped.length > 0) evtObj.exdate = skipped;
        }
        if (event.timezone && event.timezone !== 'local') evtObj.timeZone = event.timezone;
        return evtObj;
    }

    // Standard single-instance event
    let evtObj = {
        id: event.id, title: displayTitle, start: event.start_time, end: event.end_time,
        backgroundColor: hexToRgba(timelineColor, 0.15), borderColor: 'transparent', textColor: '#E2E8F0',
        extendedProps: { calendar_id: event.calendar_id, is_recurring: false, description: event.description, timelineColor }
    };
    if (event.timezone && event.timezone !== 'local') evtObj.timeZone = event.timezone;
    return evtObj;
}

function renderCalendarEvents(searchTerm = "") {
    calendarInstance.removeAllEvents();
    selectedEventIds.clear(); // H1: reset selection on every re-render
    const activeTimelineIds = Array.from(document.querySelectorAll('.timeline-checkbox:checked')).map(cb => parseInt(cb.dataset.id));

    // v2.0 sidebar filters
    const filterChecklist = document.getElementById('filter-has-checklist')?.checked ?? false;
    const filterRecurring = document.getElementById('filter-recurring')?.checked ?? false;
    const filterThisWeek  = document.getElementById('filter-this-week')?.checked ?? false;
    const nowWeekStart = (() => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay()); return d; })();
    const nowWeekEnd   = new Date(nowWeekStart.getTime() + 7 * 86400000);

    const formattedEvents = currentEvents
        .filter(event => activeTimelineIds.includes(event.calendar_id))
        .filter(event => (event.title || "").toLowerCase().includes(searchTerm))
        .filter(event => !filterChecklist || (event.checklist && JSON.parse(event.checklist || '[]').length > 0))
        .filter(event => !filterRecurring || event.is_recurring)
        .filter(event => {
            if (!filterThisWeek) return true;
            const s = new Date(event.start_time);
            return s >= nowWeekStart && s < nowWeekEnd;
        })
        .flatMap(event => {
            const r = mapEvent(event);
            return Array.isArray(r) ? r : [r];
        });
    calendarInstance.addEventSource(formattedEvents);

    updateEmptyStates();
}
function updateEmptyStates() {
  if (isLoading) return; // Don't flash empty state during fetch

  // Sidebar: no timelines
  if (currentTimelines.length === 0) {
    document.getElementById('timeline-list').innerHTML = `
      <li class='empty-state'>
        <span style='font-size:2rem'>🗓</span>
        <p style='font-weight:600; margin-bottom: 0px;'>No timelines yet</p>
        <p>Create one to get started</p>
        <button class='accept-btn' style='padding:8px 16px;width:auto;margin-top:6px;'
          onclick="document.getElementById('timeline-modal').classList.remove('hidden')">
          + Create Timeline
        </button>
      </li>`;
  }

  // Calendar overlay: timelines exist but no events
  const overlay = document.getElementById('calendar-empty-overlay');
  if (overlay) {
      if (currentTimelines.length > 0 && currentEvents.length === 0) {
        overlay.classList.remove('hidden');
        overlay.innerHTML = `<p>No events yet.</p><p>Click any date or press <kbd>N</kbd> to add one.</p>`;
      } else {
        overlay.classList.add('hidden');
      }
  }
}

// ==========================================
// H4: SKIP OCCURRENCE
// ==========================================
async function skipOccurrence(eventId, instanceDate) {
    // Convert JS Date or ISO string to YYYY-MM-DD
    const dateStr = instanceDate instanceof Date
        ? instanceDate.toISOString().split('T')[0]
        : String(instanceDate).split('T')[0];
    await fetch(`${API_URL}/events/${eventId}/skip-date`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateStr })
    });
    // Push undo: call DELETE /skip-date to restore the skipped instance
    pushHistory(
        async () => {
            await fetch(`${API_URL}/events/${eventId}/skip-date`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: dateStr })
            });
        },
        async () => {
            await fetch(`${API_URL}/events/${eventId}/skip-date`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: dateStr })
            });
        },
        'Skip occurrence'
    );
    document.getElementById('event-modal').classList.add('hidden');
    await loadData();
}

// ==========================================
// H5: PER-DAY TIMES GRID
// ==========================================
function updatePerDayGrid(existingData = null) {
    const tbody = document.getElementById('per-day-times-tbody');
    if (!tbody) return;
    const checkedDays = Array.from(document.querySelectorAll('.recur-day:checked')).map(cb => cb.value);
    tbody.innerHTML = '';
    checkedDays.forEach(dayNum => {
        const defaults = existingData && existingData[dayNum] ? existingData[dayNum] : ['09:00', '10:00'];
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding:4px 6px;color:var(--text-muted);">${DAY_NAMES[parseInt(dayNum)]}</td>
            <td style="padding:4px 4px;"><input type="time" class="per-day-start form-input" data-day="${dayNum}" value="${defaults[0]}" style="padding:6px;margin:0;"></td>
            <td style="padding:4px 4px;"><input type="time" class="per-day-end form-input" data-day="${dayNum}" value="${defaults[1]}" style="padding:6px;margin:0;"></td>
        `;
        tbody.appendChild(tr);
    });
}

function serializePerDayTimes() {
    const result = {};
    document.querySelectorAll('.per-day-start').forEach(input => {
        const dayNum = input.dataset.day;
        const endInput = document.querySelector(`.per-day-end[data-day="${dayNum}"]`);
        // Only include days that are actually checked in the recurrence days picker
        const isSelected = document.querySelector(`.recur-day[value="${dayNum}"]:checked`);
        if (isSelected && endInput) {
            result[dayNum] = [input.value, endInput.value];
        }
    });
    return Object.keys(result).length > 0 ? JSON.stringify(result) : null;
}

// ==========================================
// L3: CHECKLIST HELPERS
// ==========================================
function renderChecklist() {
    const container = document.getElementById('checklist-items');
    if (!container) return;
    container.innerHTML = '';
    currentChecklist.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'checklist-item' + (item.done ? ' checklist-item-done' : '');
        row.innerHTML = `
            <input type="checkbox" ${item.done ? 'checked' : ''} data-idx="${idx}" class="checklist-cb" style="accent-color:var(--accent);">
            <span>${item.text.replace(/</g,'&lt;')}</span>
            <button class="checklist-delete" data-idx="${idx}">×</button>
        `;
        row.querySelector('.checklist-cb').addEventListener('change', async (e) => {
            currentChecklist[parseInt(e.target.dataset.idx)].done = e.target.checked;
            renderChecklist();
            await saveChecklistImmediate();
        });
        row.querySelector('.checklist-delete').addEventListener('click', async () => {
            currentChecklist.splice(parseInt(row.querySelector('.checklist-delete').dataset.idx), 1);
            renderChecklist();
            await saveChecklistImmediate();
        });
        container.appendChild(row);
    });
}

async function saveChecklistImmediate() {
    const eventId = document.getElementById('event-id').value;
    if (!eventId) return; // New event — no PUT until the user saves
    const event = currentEvents.find(e => e.id === parseInt(eventId));
    if (!event) return;
    // Build a full payload from the stored event, updating only checklist
    const payload = { ...event, checklist: currentChecklist.length > 0 ? JSON.stringify(currentChecklist) : null };
    await fetch(`${API_URL}/events/${eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    // Keep currentEvents in sync so re-renders show the correct badge
    event.checklist = payload.checklist;
    const searchTerm = document.getElementById('event-search')?.value.toLowerCase() || '';
    renderCalendarEvents(searchTerm);
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
// NEW: Timeline Color Dot Helper 
function setModalTitleDot(calendarId) {
  const timeline = currentTimelines.find(t => t.id === parseInt(calendarId));
  const color = timeline ? (timeline.color || '#6366f1') : '#6366f1';
  const title = document.getElementById('event-modal-title');
  
  // Remove existing dot if present
  const existing = title.querySelector('.modal-timeline-dot');
  if (existing) existing.remove();
  
  const dot = document.createElement('span');
  dot.className = 'modal-timeline-dot';
  dot.style.backgroundColor = color;
  title.prepend(dot);
}
// Standard interval overlap: A overlaps B if A.start < B.end AND A.end > B.start
function checkForConflicts(startISO, endISO, calendarId, excludeId = null) {
  const newStart = new Date(startISO).getTime();
  const newEnd = new Date(endISO).getTime();

  return currentEvents
    .filter(e => {
      if (e.calendar_id !== parseInt(calendarId)) return false;   // Different timeline = no conflict
      if (excludeId && e.id === parseInt(excludeId)) return false; // Don't conflict with itself
      if (e.is_recurring) return false;                  // Skip recurring — complex, flag as future
      return true;
    })
    .filter(e => {
      const eStart = new Date(e.start_time).getTime();
      const eEnd = new Date(e.end_time).getTime();
      return newStart < eEnd && newEnd > eStart;         // Overlap formula
    })
    .map(e => e.title);
}
function showModalError(msg) {
  const el = document.getElementById('event-modal-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearModalError() {
  document.getElementById('event-modal-error').classList.add('hidden');
}
// H4: instanceDate — the specific FullCalendar occurrence date (for skip-occurrence)
function openEventModal(existingEvent = null, clickedDate = null, instanceDate = null) {
    document.getElementById('event-tooltip')?.classList.add('hidden');
    document.getElementById("save-event-btn").textContent = "Save";
    document.getElementById("conflict-warning").classList.add("hidden");
    const modal = document.getElementById("event-modal");
    document.getElementById("delete-event-btn").classList.add("hidden");
    document.getElementById("duplicate-event-btn").classList.add("hidden");
    document.getElementById("save-template-btn").classList.add("hidden"); // M3
    document.getElementById("save-template-feedback").classList.add("hidden"); // M3
    document.getElementById("add-to-taskboard-btn").classList.add("hidden"); // Task Board

    const isRecurringCheckbox = document.getElementById("event-is-recurring");
    const recurrenceFields = document.getElementById("recurrence-fields");
    const singleFields = document.getElementById("single-date-fields");
    const descArea = document.getElementById("event-description");
    const uDescArea = document.getElementById("event-unique-description");
    const uDescContainer = document.getElementById("unique-desc-container");
    const descDisplay = document.getElementById("event-description-display");

    document.querySelectorAll('.recur-day').forEach(cb => cb.checked = false);

    // Reset all-day, per-day, skip, and checklist state for every modal open
    const isAllDayCheckbox = document.getElementById('event-is-allday');
    const allDayFields = document.getElementById('allday-date-fields');
    isAllDayCheckbox.checked = false;
    isAllDayCheckbox.disabled = false;
    allDayFields.classList.add('hidden');
    document.getElementById('event-start').disabled = false;
    document.getElementById('event-end').disabled = false;
    document.getElementById('recur-start-time').disabled = false;
    document.getElementById('recur-end-time').disabled = false;
    document.querySelector('.time-lock-label')?.remove();
    document.getElementById('skip-occurrence-btn').classList.add('hidden');
    document.getElementById('recur-per-day-toggle').checked = false;
    document.getElementById('per-day-times-grid').classList.add('hidden');
    document.getElementById('recur-single-time-fields').classList.remove('hidden');
    currentChecklist = [];
    document.getElementById('checklist-items').innerHTML = '';

    if (existingEvent && existingEvent.id) {
        document.getElementById("event-modal-title").innerText = "Edit Event";
        document.getElementById("event-id").value = existingEvent.id;
        document.getElementById("event-title").value = existingEvent.title;

        const calendarId = existingEvent.calendar_id || existingEvent.extendedProps?.calendar_id;
        document.getElementById("event-timeline").value = calendarId;
        document.getElementById("delete-event-btn").classList.remove("hidden");
        document.getElementById("duplicate-event-btn").classList.remove("hidden");
        document.getElementById("save-template-btn").classList.remove("hidden"); // M3
        // Task Board: show button and reflect pinned state
        const taskboardBtn = document.getElementById("add-to-taskboard-btn");
        taskboardBtn.classList.remove("hidden");
        const alreadyPinned = currentTasks.some(t => t.event_id === existingEvent.id);
        if (alreadyPinned) {
            taskboardBtn.textContent = '✓ On Task Board';
            taskboardBtn.classList.add('on-taskboard');
        } else {
            taskboardBtn.textContent = 'Add to Task Board';
            taskboardBtn.classList.remove('on-taskboard');
        }
        
        // Update the color dot based on the timeline
        setModalTitleDot(calendarId);

        descArea.value = existingEvent.description || "";
        uDescArea.value = existingEvent.unique_description || "";

        currentEventTimezone = existingEvent.timezone || 'local';
        const tzDisplay = document.getElementById("event-timezone-display");
        if (currentEventTimezone !== 'local') {
            tzDisplay.textContent = `Stored in: ${currentEventTimezone}`;
            tzDisplay.classList.remove("hidden");
        } else {
            tzDisplay.classList.add("hidden");
        }
        document.getElementById("event-reminder").value = existingEvent.reminder_minutes || "";
        
        let hasDesc = (existingEvent.description || existingEvent.unique_description);
        toggleDescMode(!hasDesc); 
        if (hasDesc) {
            let combined = existingEvent.description || "";
            if (existingEvent.is_recurring && existingEvent.unique_description) {
                combined += `\n\n*Note:* ${existingEvent.unique_description}`;
            }
            descDisplay.innerHTML = renderDescription(combined);
        }

        // H2: all-day events — show date pickers, hide timed fields
        if (existingEvent.is_all_day) {
            isAllDayCheckbox.checked = true;
            isAllDayCheckbox.disabled = false; // disabled only while recurring is checked
            allDayFields.classList.remove('hidden');
            singleFields.classList.add('hidden');
            recurrenceFields.classList.add('hidden');
            isRecurringCheckbox.checked = false;
            isRecurringCheckbox.disabled = true; // all-day recurring is a future improvement
            document.getElementById('allday-start-date').value = existingEvent.start_time.split('T')[0];
            document.getElementById('allday-end-date').value = existingEvent.end_time.split('T')[0];
        } else if (existingEvent.is_recurring) {
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

            // H5: populate per-day toggle and grid if per_day_times is set
            if (existingEvent.per_day_times) {
                try {
                    const perDayData = JSON.parse(existingEvent.per_day_times);
                    document.getElementById('recur-per-day-toggle').checked = true;
                    document.getElementById('per-day-times-grid').classList.remove('hidden');
                    document.getElementById('recur-single-time-fields').classList.add('hidden');
                    updatePerDayGrid(perDayData);
                } catch { /* malformed — leave toggle unchecked */ }
            }

            // H4: show skip button only when opened from a specific recurring instance
            if (instanceDate) {
                const dateStr = instanceDate instanceof Date
                    ? instanceDate.toISOString().split('T')[0]
                    : String(instanceDate).split('T')[0];
                const skipBtn = document.getElementById('skip-occurrence-btn');
                skipBtn.classList.remove('hidden');
                skipBtn.dataset.date = dateStr;
                skipBtn.dataset.eventId = existingEvent.id;
            }
        } else {
            isRecurringCheckbox.checked = false;
            recurrenceFields.classList.add("hidden");
            singleFields.classList.remove("hidden");
            uDescContainer.classList.add("hidden");
            document.getElementById("event-start").value = formatForInput(existingEvent.start_time || existingEvent.start);
            document.getElementById("event-end").value = formatForInput(existingEvent.end_time || existingEvent.end);
        }

        // L3: parse and render checklist
        if (existingEvent.checklist) {
            try { currentChecklist = JSON.parse(existingEvent.checklist); } catch { currentChecklist = []; }
        } else {
            currentChecklist = [];
        }
        renderChecklist();

        if (existingEvent.title === "Meeting (availability booking)") {
            ['event-start','event-end','recur-start-time','recur-end-time'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.disabled = true;
            });
            const singleFields = document.getElementById('single-date-fields');
            if (singleFields && !singleFields.querySelector('.time-lock-label')) {
                const lbl = document.createElement('p');
                lbl.className = 'time-lock-label';
                lbl.style.cssText = 'font-size:0.8rem;color:var(--text-muted);margin:-8px 0 12px;';
                lbl.textContent = '🔒 Time set by availability booking';
                singleFields.appendChild(lbl);
            }
        }
    } else {
        document.getElementById("event-modal-title").innerText = "New Event";
        document.getElementById("event-id").value = "";
        document.getElementById("event-title").value = "";
        descArea.value = "";
        uDescArea.value = "";
        currentEventTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
        document.getElementById("event-timezone-display").classList.add("hidden");
        document.getElementById("event-reminder").value = "";
        toggleDescMode(true); 

        isRecurringCheckbox.checked = false;
        recurrenceFields.classList.add("hidden");
        singleFields.classList.remove("hidden");
        uDescContainer.classList.add("hidden");
        
        const startStr = clickedDate ? new Date(clickedDate) : new Date();
        const endStr = new Date(startStr.getTime() + 60 * 60 * 1000); 
        document.getElementById("event-start").value = formatForInput(startStr);
        document.getElementById("event-end").value = formatForInput(endStr);
        
        // Default color dot to first timeline
        if (currentTimelines.length > 0) {
            setModalTitleDot(currentTimelines[0].id);
        }
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

// H2: all-day checkbox — toggles between date-pickers and normal timed fields
document.getElementById("event-is-allday").addEventListener("change", (e) => {
    const allDayFields = document.getElementById("allday-date-fields");
    const singleFields = document.getElementById("single-date-fields");
    const recurringCb = document.getElementById("event-is-recurring");
    const recurrenceFields = document.getElementById("recurrence-fields");
    if (e.target.checked) {
        allDayFields.classList.remove("hidden");
        singleFields.classList.add("hidden");
        recurrenceFields.classList.add("hidden");
        // all-day recurring is a future improvement — disable recurring while all-day is active
        recurringCb.checked = false;
        recurringCb.disabled = true;
    } else {
        allDayFields.classList.add("hidden");
        recurringCb.disabled = false;
        // Restore the appropriate timed fields
        if (recurringCb.checked) {
            recurrenceFields.classList.remove("hidden");
        } else {
            singleFields.classList.remove("hidden");
        }
    }
});

// H5: per-day toggle — switches between single time pair and per-day grid
document.getElementById("recur-per-day-toggle").addEventListener("change", (e) => {
    const perDayGrid = document.getElementById("per-day-times-grid");
    const singleTimeFields = document.getElementById("recur-single-time-fields");
    if (e.target.checked) {
        perDayGrid.classList.remove("hidden");
        singleTimeFields.classList.add("hidden");
        updatePerDayGrid(); // build rows from currently checked days
    } else {
        perDayGrid.classList.add("hidden");
        singleTimeFields.classList.remove("hidden");
    }
});

// H5: when recurrence day checkboxes change, keep per-day grid in sync
document.querySelectorAll('.recur-day').forEach(cb => {
    cb.addEventListener('change', () => {
        if (document.getElementById('recur-per-day-toggle').checked) {
            updatePerDayGrid();
        }
    });
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
        expandSidebar();
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
            addNotification({
                type: 'success',
                title: 'Syllabus saved',
                message: `${data.events_added} event${data.events_added !== 1 ? 's' : ''} added` +
                    (data.events_skipped > 0 ? `, ${data.events_skipped} duplicate${data.events_skipped !== 1 ? 's' : ''} skipped.` : '.'),
                dismissible: true,
                autoRemoveMs: 8000,
            });
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
        expandSidebar();
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

// H6: accepts text directly (unified search + quick-add; standalone bar removed)
async function submitQuickAdd(text) {
    if (!text || !text.trim()) return;
    const trimmedText = text.trim();

    const btn = document.getElementById("search-quick-add-btn");
    if (btn) { btn.disabled = true; btn.textContent = "..."; }

    const _qaNotifId = addNotification({
        type: 'progress',
        title: 'Processing intent…',
        message: `"${trimmedText.slice(0, 50)}${trimmedText.length > 50 ? '…' : ''}"`,
        progress: 10,
        dismissible: false,
    });
    let _qaProgVal = 10;
    const _qaProgInt = setInterval(() => {
        _qaProgVal = _qaProgVal >= 90 ? 10 : _qaProgVal + 10;
        updateNotification(_qaNotifId, { progress: _qaProgVal });
    }, 400);

    try {
        const response = await fetch(`${API_URL}/intent`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: trimmedText })
        });

        if (!response.ok) throw new Error("Failed to process intent");
        const data = await response.json();

        // Push to Undo/Redo Stack
        if (data.event_id) {
            pushHistory(
                async () => {
                    // Undo: Delete the event created by quick-add
                    await fetch(`${API_URL}/events/${data.event_id}`, { method: 'DELETE' });
                },
                async () => {
                    // Redo: Re-run the same intent text
                    await fetch(`${API_URL}/intent`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: trimmedText }),
                    });
                },
                'Quick Add Event'
            );
        }

        // Clear search input and hide + button after successful add
        const searchInput = document.getElementById("event-search");
        if (searchInput) searchInput.value = "";
        if (btn) btn.classList.add('hidden');
        await loadData();
        clearInterval(_qaProgInt);
        updateNotification(_qaNotifId, {
            type: 'success',
            title: 'Event added',
            message: `"${trimmedText.slice(0, 60)}" added to calendar.`,
            progress: null,
            dismissible: true,
            autoRemoveMs: 6000,
        });
    } catch (err) {
        clearInterval(_qaProgInt);
        updateNotification(_qaNotifId, {
            type: 'error',
            title: 'Quick-add failed',
            message: 'Could not process your request. Please try again.',
            progress: null,
            dismissible: true,
        });
        const errEl = document.getElementById("import-error");
        errEl.textContent = "Quick-add failed. Please try again.";
        errEl.classList.remove("hidden");
        setTimeout(() => errEl.classList.add("hidden"), 3000);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "+"; }
    }
}
// ==========================================
// DAILY AGENDA OVERLAY (M4)
// ==========================================
function showDailyAgenda() {
    // Respect the user's setting (defaults to enabled)
    if (localStorage.getItem('loom-daily-agenda') === 'false') return;

    const today = new Date().toISOString().split('T')[0];
    const todayEvents = currentEvents
        .filter(ev => !ev.is_recurring && ev.start_time && ev.start_time.startsWith(today))
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

    if (todayEvents.length === 0) return;

    const container = document.getElementById('calendar-container');
    const overlay = document.createElement('div');
    overlay.id = 'daily-agenda-overlay';

    const listHtml = todayEvents.map(ev => {
        const time = new Date(ev.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `<div class="agenda-item"><span class="agenda-time">${time}</span><span>${ev.title}</span></div>`;
    }).join('');

    overlay.innerHTML = `
        <div class="agenda-header">
            <span>Today's Agenda (${todayEvents.length})</span>
            <button class="agenda-dismiss-btn" title="Dismiss">×</button>
        </div>
        <div class="agenda-list">${listHtml}</div>
    `;

    container.appendChild(overlay);

    const dismiss = () => {
        overlay.remove();
        if (agendaTimeout) { clearTimeout(agendaTimeout); agendaTimeout = null; }
    };

    overlay.addEventListener('click', dismiss);
    // Auto-dismiss after 3 seconds
    agendaTimeout = setTimeout(dismiss, 3000);
}

// ==========================================
// USAGE STATISTICS PANEL (M5)
// ==========================================
function openStatsPanel() {
    if (document.querySelector('.app-layout').classList.contains('sidebar-hidden')) {
        expandSidebar();
    }
    updateSidebarMode("stats");

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Events this month (non-recurring only for accurate counts)
    const monthEvents = currentEvents.filter(ev => {
        if (ev.is_recurring) return false;
        const d = new Date(ev.start_time);
        return d >= monthStart && d <= monthEnd;
    });

    // Hours per timeline this month (CSS bar chart — no library)
    const hoursByTimeline = {};
    monthEvents.forEach(ev => {
        const tl = currentTimelines.find(t => t.id === ev.calendar_id);
        const name = tl ? tl.name : 'Unknown';
        const color = tl ? (tl.color || '#6366f1') : '#6366f1';
        if (!hoursByTimeline[name]) hoursByTimeline[name] = { hours: 0, color };
        const start = new Date(ev.start_time);
        const end = new Date(ev.end_time);
        hoursByTimeline[name].hours += (end - start) / 3_600_000;
    });

    // Busiest weekday across all non-recurring events
    const dayCount = [0, 0, 0, 0, 0, 0, 0];
    currentEvents.filter(ev => !ev.is_recurring).forEach(ev => {
        dayCount[new Date(ev.start_time).getDay()]++;
    });
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const busiestIdx = dayCount.indexOf(Math.max(...dayCount));
    const busiestDay = dayCount[busiestIdx] > 0 ? dayNames[busiestIdx] : 'N/A';

    const maxHours = Math.max(...Object.values(hoursByTimeline).map(v => v.hours), 1);
    const barsHtml = Object.entries(hoursByTimeline).map(([name, { hours, color }]) => {
        const pct = Math.round((hours / maxHours) * 100);
        return `
            <div class="stats-bar-row">
                <span class="stats-bar-label" title="${name}">${name}</span>
                <div class="stats-bar-track">
                    <div class="stats-bar-fill" style="width:${pct}%;background:${color}"></div>
                </div>
                <span class="stats-bar-value">${hours.toFixed(1)}h</span>
            </div>`;
    }).join('') || '<p class="muted-text" style="font-size:0.85rem;margin-top:6px">No timed events this month.</p>';

    document.getElementById('stats-content').innerHTML = `
        <div class="stats-metric">
            <span class="stats-label">Events this month</span>
            <span class="stats-value">${monthEvents.length}</span>
        </div>
        <div class="stats-metric">
            <span class="stats-label">Busiest weekday</span>
            <span class="stats-value">${busiestDay}</span>
        </div>
        <div style="margin-top:12px;">
            <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;">Hours per timeline (this month)</p>
            ${barsHtml}
        </div>`;
}

// ==========================================
// PRINT WEEK VIEW (L4)
// ==========================================
function openPrintView() {
    const view = calendarInstance.view;
    const start = view.activeStart;
    const end = view.activeEnd;

    // Skip recurring events — accurate expansion requires complex RRULE logic
    const weekEvents = currentEvents.filter(ev => {
        if (ev.is_recurring) return false; // Recurring events skipped in print view
        const d = new Date(ev.start_time);
        return d >= start && d < end;
    });

    // Build one column per day in the current view range
    const days = [];
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        days.push(new Date(d));
    }

    const dayColsHtml = days.map(day => {
        const dayStr = day.toISOString().split('T')[0];
        const dayEvents = weekEvents
            .filter(ev => ev.start_time.startsWith(dayStr))
            .sort((a, b) => a.start_time.localeCompare(b.start_time));

        const evHtml = dayEvents.map(ev => {
            const tl = currentTimelines.find(t => t.id === ev.calendar_id);
            const color = tl ? (tl.color || '#6366f1') : '#6366f1';
            const timeStr = new Date(ev.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `<div style="border-left:3px solid ${color};padding:4px 8px;margin:4px 0;background:#f9f9f9;border-radius:3px;">
                <strong style="font-size:0.85rem">${ev.title}</strong><br>
                <small style="color:#666">${timeStr}</small>
            </div>`;
        }).join('');

        const label = day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        return `<div class="print-day">
            <div class="print-day-header">${label}</div>
            ${evHtml || '<p style="color:#888;font-size:0.8rem;padding:4px 8px;margin:0">No events</p>'}
        </div>`;
    }).join('');

    const rangeLabel = start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
        + ' – ' + new Date(end - 1).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const html = `<!DOCTYPE html><html><head><title>Loom Week</title><style>
        body{font-family:-apple-system,sans-serif;margin:20px;color:#111}
        h1{font-size:1.1rem;margin-bottom:14px;color:#333}
        .print-grid{display:grid;grid-template-columns:repeat(${days.length},1fr);gap:8px}
        .print-day{border:1px solid #ddd;border-radius:6px;overflow:hidden}
        .print-day-header{background:#6366f1;color:white;padding:5px 8px;font-weight:600;font-size:0.8rem}
        @media print{body{margin:0}.print-day-header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body>
        <h1>Loom — ${rangeLabel}</h1>
        <div class="print-grid">${dayColsHtml}</div>
    </body></html>`;

    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); win.print(); }
}

// ==========================================
// EVENT TEMPLATES (M3)
// ==========================================
async function openSidebarTemplates() {
    if (document.querySelector('.app-layout').classList.contains('sidebar-hidden')) {
        expandSidebar();
    }
    updateSidebarMode("templates");
    const list = document.getElementById('template-list');
    if (!list) return;
    list.innerHTML = '<p class="muted-text" style="font-size:0.85rem;">Loading...</p>';

    try {
        const res = await fetch(`${API_URL}/templates/`);
        const templates = await res.json();
        list.innerHTML = '';
        if (!templates.length) {
            list.innerHTML = '<p class="muted-text" style="font-size:0.85rem;">No templates saved yet. Open any event and click Save as Template.</p>';
            return;
        }
        templates.forEach(t => {
            const card = document.createElement('div');
            card.className = 'template-card';
            const recurInfo = t.is_recurring
                ? `Recurring · ${t.duration_minutes}min`
                : `${t.duration_minutes}min`;
            card.innerHTML = `
                <div class="template-card-info">
                    <div class="template-card-name">${t.name}</div>
                    <div class="template-card-preview">${t.title}</div>
                    <div class="template-card-preview">${recurInfo}</div>
                </div>
                <button class="icon-btn template-delete-btn" data-id="${t.id}" title="Delete template" style="flex-shrink:0;">×</button>
            `;
            card.querySelector('.template-delete-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                await fetch(`${API_URL}/templates/${t.id}`, { method: 'DELETE' });
                openSidebarTemplates();
            });
            card.querySelector('.template-card-info').addEventListener('click', () => {
                applyTemplate(t);
            });
            list.appendChild(card);
        });
    } catch {
        list.innerHTML = '<p class="muted-text" style="font-size:0.85rem;">Failed to load templates.</p>';
    }
}

function applyTemplate(template) {
    openEventModal(null);
    setTimeout(() => {
        document.getElementById('event-title').value = template.title;
        document.getElementById('event-description').value = template.description || '';

        const now = new Date();
        const end = new Date(now.getTime() + template.duration_minutes * 60000);
        document.getElementById('event-start').value = formatForInput(now);
        document.getElementById('event-end').value = formatForInput(end);

        // Set timeline if calendar_id exists and is valid
        if (template.calendar_id) {
            const tl = currentTimelines.find(t => t.id === template.calendar_id);
            if (tl) {
                document.getElementById('event-timeline').value = template.calendar_id;
                setModalTitleDot(template.calendar_id);
            }
        }

        // Set up recurring fields if template is recurring
        if (template.is_recurring) {
            document.getElementById('event-is-recurring').checked = true;
            document.getElementById('recurrence-fields').classList.remove('hidden');
            document.getElementById('single-date-fields').classList.add('hidden');
            if (template.recurrence_days) {
                template.recurrence_days.split(',').forEach(d => {
                    const cb = document.querySelector(`.recur-day[value="${d.trim()}"]`);
                    if (cb) cb.checked = true;
                });
            }
        }
    }, 50);
}

document.getElementById('save-template-btn').addEventListener('click', async () => {
    const defaultName = document.getElementById('event-title').value || '';
    const name = window.prompt('Template name:', defaultName);
    if (!name || !name.trim()) return;

    const isRecurring = document.getElementById('event-is-recurring').checked;
    let durationMinutes = 60;
    if (!isRecurring) {
        const startVal = document.getElementById('event-start').value;
        const endVal = document.getElementById('event-end').value;
        if (startVal && endVal) {
            durationMinutes = Math.max(1, Math.round((new Date(endVal) - new Date(startVal)) / 60000));
        }
    }

    const calId = document.getElementById('event-timeline').value;
    const payload = {
        name: name.trim(),
        title: document.getElementById('event-title').value,
        description: document.getElementById('event-description').value || null,
        duration_minutes: durationMinutes,
        is_recurring: isRecurring,
        recurrence_days: isRecurring
            ? Array.from(document.querySelectorAll('.recur-day:checked')).map(cb => cb.value).join(',') || null
            : null,
        calendar_id: calId && calId !== '__new__' ? parseInt(calId) : null
    };

    try {
        const res = await fetch(`${API_URL}/templates/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            const feedback = document.getElementById('save-template-feedback');
            feedback.textContent = 'Template saved!';
            feedback.classList.remove('hidden');
            setTimeout(() => feedback.classList.add('hidden'), 2000);
        }
    } catch { /* silently fail — template save is non-critical */ }
});

// ==========================================
// AUTO-SCHEDULE WELLNESS WARNINGS (M2)
// ==========================================
async function runScheduleAnalysis() {
    const today = new Date().toISOString().split('T')[0];
    const todayEvents = currentEvents.filter(ev =>
        !ev.is_recurring && ev.start_time && ev.start_time.startsWith(today)
    );
    if (todayEvents.length < 4) return;

    try {
        const payload = {
            events: todayEvents.map(ev => ({
                title: ev.title,
                start_time: ev.start_time,
                end_time: ev.end_time
            }))
        };
        const res = await fetch(`${API_URL}/schedule/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) return;
        const data = await res.json();
        showScheduleWarnings(data.warnings);
        if (data.warnings?.length > 0) {
            data.warnings.forEach(w => addNotification({
                type: 'warning',
                title: 'Schedule warning',
                message: w,
                dismissible: true,
            }));
        }
    } catch { /* silently return — never show a fetch error */ }
}

function showScheduleWarnings(warnings) {
    const container = document.getElementById('schedule-warnings');
    if (!container) return;
    container.innerHTML = '';
    if (!warnings || !warnings.length) return;

    warnings.forEach(warning => {
        const key = 'dismissed-warning-' + btoa(encodeURIComponent(warning));
        if (sessionStorage.getItem(key)) return; // already dismissed this session

        const div = document.createElement('div');
        div.className = 'schedule-warning';

        let textContent = warning;
        const textSpan = document.createElement('span');
        textSpan.className = 'schedule-warning-text';
        textSpan.textContent = textContent;

        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'schedule-warning-dismiss';
        dismissBtn.textContent = '×';
        dismissBtn.addEventListener('click', () => {
            sessionStorage.setItem(key, '1');
            div.remove();
        });

        div.appendChild(textSpan);

        // Premium commute link
        if (warning.toLowerCase().includes('commute')) {
            const link = document.createElement('span');
            link.style.cssText = 'cursor:pointer; color:var(--accent); font-size:0.82rem; flex-shrink:0;';
            link.textContent = '· Plan Commute Blocks →';
            link.addEventListener('click', () => {
                alert('Commute block planning is a Premium feature — coming soon!');
            });
            div.appendChild(link);
        }

        div.appendChild(dismissBtn);
        container.appendChild(div);
    });
}

// ==========================================
// TODO LIST (M1)
// ==========================================
// TASK BOARD (replaces M1 Todos)
// ==========================================
async function loadTasks() {
    try {
        const res = await fetch(`${API_URL}/tasks/`);
        if (res.ok) {
            currentTasks = await res.json();
            renderTaskBoard();
        }
    } catch (err) {
        console.error('Failed to load tasks:', err);
    }
}

function openSidebarTaskboard() {
    if (document.querySelector('.app-layout').classList.contains('sidebar-hidden')) {
        expandSidebar();
    }
    updateSidebarMode("taskboard");
    loadTasks();
}

// v2.0 full-page Task Board
let taskBoardGroupBy = 'timeline'; // timeline | due | priority | status
let taskBoardShow    = 'all';      // all | incomplete | completed | overdue

function renderTaskBoardPage() {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;
    const page = document.createElement('div');
    page.className = 'taskboard-page';
    page.id = 'taskboard-page';
    mainContent.appendChild(page);
    _renderTaskBoardContent();
    _renderTaskBoardSidebar();
}

function _renderTaskBoardSidebar() {
    const sbSec = document.getElementById('tasks-sidebar-section');
    if (!sbSec) return;
    sbSec.innerHTML = `
        <div class="sidebar-section">
            <div class="section-header"><h3>Group By</h3></div>
            ${['timeline','due','priority','status'].map(g => `
                <label class="filter-row">
                    <input type="radio" name="tb-group" value="${g}" ${taskBoardGroupBy===g?'checked':''} style="accent-color:var(--accent);">
                    <span>${g.charAt(0).toUpperCase()+g.slice(1)}</span>
                </label>`).join('')}
        </div>
        <div class="sidebar-section" style="margin-top:12px;">
            <div class="section-header"><h3>Show</h3></div>
            ${['all','incomplete','completed','overdue'].map(s => `
                <label class="filter-row">
                    <input type="radio" name="tb-show" value="${s}" ${taskBoardShow===s?'checked':''} style="accent-color:var(--accent);">
                    <span>${s.charAt(0).toUpperCase()+s.slice(1)}</span>
                </label>`).join('')}
        </div>`;

    sbSec.querySelectorAll('input[name="tb-group"]').forEach(r => {
        r.addEventListener('change', () => { taskBoardGroupBy = r.value; _renderTaskBoardContent(); });
    });
    sbSec.querySelectorAll('input[name="tb-show"]').forEach(r => {
        r.addEventListener('change', () => { taskBoardShow = r.value; _renderTaskBoardContent(); });
    });
}

function _renderTaskBoardContent() {
    const page = document.getElementById('taskboard-page') || document.querySelector('.taskboard-page');
    if (!page) return;
    page.innerHTML = '';

    const now = new Date();
    let tasks = [...currentTasks];
    if (taskBoardShow === 'incomplete') tasks = tasks.filter(t => !t.is_complete);
    else if (taskBoardShow === 'completed') tasks = tasks.filter(t => t.is_complete);
    else if (taskBoardShow === 'overdue')  tasks = tasks.filter(t => !t.is_complete && t.due_date && new Date(t.due_date) < now);

    // Build groups
    const groups = new Map();
    tasks.forEach(task => {
        const ev = currentEvents.find(e => e.id === task.event_id);
        const timeline = ev ? currentTimelines.find(tl => tl.id === ev.calendar_id) : null;
        let key, label, color;
        if (taskBoardGroupBy === 'timeline') {
            key = timeline?.id || '__none__';
            label = timeline?.name || 'No timeline';
            color = timeline?.color || 'var(--text-muted)';
        } else if (taskBoardGroupBy === 'priority') {
            key = task.priority || 'low';
            const pColors = { high:'#EF4444', med:'#F59E0B', low:'#4A5568' };
            label = (task.priority || 'low').charAt(0).toUpperCase() + (task.priority || 'low').slice(1) + ' Priority';
            color = pColors[task.priority || 'low'];
        } else if (taskBoardGroupBy === 'status') {
            key = task.status || 'backlog';
            const sColors = { backlog:'#7A8FA6', doing:'#6366F1', done:'#10B981' };
            const sLabels = { backlog:'Backlog', doing:'In Progress', done:'Done' };
            label = sLabels[task.status || 'backlog'];
            color = sColors[task.status || 'backlog'];
        } else { // due
            const d = task.due_date ? new Date(task.due_date).toLocaleDateString('en-US', {month:'short', day:'numeric'}) : 'No due date';
            key = task.due_date || '__none__';
            label = d;
            color = 'var(--text-muted)';
        }
        if (!groups.has(key)) groups.set(key, { label, color, tasks: [] });
        groups.get(key).tasks.push({ task, ev, timeline });
    });

    if (!groups.size) {
        page.innerHTML = '<p class="muted-text" style="padding:24px;font-size:0.9rem">No tasks. Open an event and click Add to Task Board.</p>';
        return;
    }

    groups.forEach(({ label, color, tasks: groupTasks }) => {
        const section = document.createElement('div');
        section.className = 'tb-section';
        const totalOpen = groupTasks.filter(({task}) => !task.is_complete).length;
        section.innerHTML = `
            <div class="tb-section-header">
                <span class="tb-tl-dot" style="background:${color}"></span>
                <span class="tb-tl-name">${label}</span>
                <span class="tb-tl-count">${totalOpen} open · ${groupTasks.length} total</span>
            </div>
            <div class="tb-cards-grid"></div>`;

        const grid = section.querySelector('.tb-cards-grid');
        groupTasks.forEach(({ task, ev, timeline }) => {
            const tlColor = timeline?.color || 'var(--text-muted)';
            const pColors = { high:'#EF4444', med:'#F59E0B', low:'#4A5568' };
            const prio = task.priority || 'low';
            let checklistBar = '';
            if (ev?.checklist) {
                try {
                    const items = JSON.parse(ev.checklist);
                    if (items.length) {
                        const done = items.filter(i => i.done).length;
                        const pct = Math.round(done / items.length * 100);
                        checklistBar = `<div class="tb-checklist-bar"><div class="tb-checklist-fill" style="width:${pct}%;background:${tlColor}"></div></div><span class="tb-checklist-ratio">${done}/${items.length}</span>`;
                    }
                } catch {}
            }
            const isOverdue = !task.is_complete && task.due_date && new Date(task.due_date) < now;

            const card = document.createElement('div');
            card.className = 'tb-card' + (task.is_complete ? ' tb-card--done' : '');
            card.innerHTML = `
                <div class="tb-card-top">
                    <input type="checkbox" class="tb-cb" ${task.is_complete?'checked':''} style="accent-color:var(--accent)">
                    <span class="tb-card-title">${ev?.title || `Task #${task.id}`}</span>
                    <span class="kanban-priority-dot" style="background:${pColors[prio]}" title="Priority: ${prio}"></span>
                </div>
                ${ev ? `<span class="tb-event-chip">🗓 ${new Date(ev.start_time).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>` : ''}
                ${isOverdue ? '<span class="tb-overdue-badge">Overdue</span>' : ''}
                ${checklistBar ? `<div class="tb-checklist-row">${checklistBar}</div>` : ''}`;

            card.querySelector('.tb-cb')?.addEventListener('change', async () => {
                const done = card.querySelector('.tb-cb').checked;
                await fetch(`${API_URL}/tasks/${task.id}`, {
                    method: 'PUT', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ is_complete: done, status: done?'done':(task.status||'backlog'), note: task.note })
                });
                await loadTasks();
                _renderTaskBoardContent();
            });

            card.querySelector('.tb-event-chip')?.addEventListener('click', () => {
                const rawEv = currentEvents.find(e => e.id === task.event_id);
                if (rawEv) openEventModal(rawEv);
            });

            grid.appendChild(card);
        });
        page.appendChild(section);
    });
}

function renderTaskBoard(filter = currentTaskFilter) {
    const list = document.getElementById('taskboard-list');
    if (!list) return;
    list.innerHTML = '';

    // Apply filter
    let filtered = currentTasks;
    if (filter === 'active') filtered = currentTasks.filter(t => !t.is_complete);
    else if (filter === 'done') filtered = currentTasks.filter(t => t.is_complete);

    // Empty state messages
    if (!filtered.length) {
        const msg = filter === 'all'
            ? 'No tasks yet. Open any event and click Add to Task Board.'
            : filter === 'active'
                ? 'No active tasks.'
                : 'No completed tasks yet.';
        list.innerHTML = `<p class="muted-text" style="font-size:0.85rem; padding: 8px 0;">${msg}</p>`;
        return;
    }

    // Group tasks by timeline (calendar_id)
    const groups = {};
    filtered.forEach(task => {
        const event = currentEvents.find(ev => ev.id === task.event_id);
        const calId = event ? event.calendar_id : '__unknown__';
        if (!groups[calId]) groups[calId] = { timeline: null, tasks: [] };
        if (event) {
            groups[calId].timeline = currentTimelines.find(tl => tl.id === event.calendar_id) || null;
        }
        groups[calId].tasks.push({ task, event });
    });

    // Sort groups by timeline name
    const sortedGroups = Object.values(groups).sort((a, b) => {
        const nameA = a.timeline ? a.timeline.name : 'Unknown';
        const nameB = b.timeline ? b.timeline.name : 'Unknown';
        return nameA.localeCompare(nameB);
    });

    sortedGroups.forEach(group => {
        const timeline = group.timeline;
        const color = timeline ? timeline.color : 'var(--text-muted)';
        const tlName = timeline ? timeline.name : 'Unknown';

        // Group header
        const header = document.createElement('div');
        header.className = 'taskboard-group-header';
        header.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;"></span>${tlName}`;
        list.appendChild(header);

        group.tasks.forEach(({ task, event }) => {
            const card = document.createElement('div');
            card.className = 'task-card' + (task.is_complete ? ' task-complete' : '');

            const eventTitle = event ? event.title : '<span style="color:var(--text-muted)">Event removed</span>';
            const dateHtml = event
                ? `<div class="task-date">${new Date(event.start_time).toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'})}</div>`
                : '';
            const noteHtml = task.note
                ? `<div class="task-note">${task.note}</div>`
                : '';
            const viewBtn = event
                ? `<button class="task-action-link view-event-btn">View Event</button>`
                : '';

            card.innerHTML = `
                <div class="task-card-top">
                    <input type="checkbox" class="task-complete-cb" ${task.is_complete ? 'checked' : ''}>
                    <div style="flex-grow:1; min-width:0;">
                        <div class="task-title">${eventTitle}</div>
                        ${dateHtml}
                        ${noteHtml}
                        <div class="task-note-edit-area"></div>
                        <div class="task-actions">
                            <button class="task-action-link edit-note-btn">Edit note</button>
                            ${viewBtn}
                            <button class="task-remove-btn" title="Remove from Task Board">×</button>
                        </div>
                    </div>
                </div>
            `;

            // Checkbox: toggle completion
            card.querySelector('.task-complete-cb').addEventListener('change', async (e) => {
                await fetch(`${API_URL}/tasks/${task.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_complete: e.target.checked, note: task.note || null })
                });
                await loadTasks();
            });

            // Edit note: replace note display with textarea on click
            card.querySelector('.edit-note-btn').addEventListener('click', () => {
                const editArea = card.querySelector('.task-note-edit-area');
                if (editArea.querySelector('textarea')) return; // Already open
                const ta = document.createElement('textarea');
                ta.className = 'task-note-input';
                ta.value = task.note || '';
                ta.rows = 2;
                editArea.appendChild(ta);
                ta.focus();
                ta.addEventListener('blur', async () => {
                    await fetch(`${API_URL}/tasks/${task.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ is_complete: task.is_complete, note: ta.value || null })
                    });
                    await loadTasks();
                });
            });

            // View Event: open event modal
            const viewEventBtn = card.querySelector('.view-event-btn');
            if (viewEventBtn && event) {
                viewEventBtn.addEventListener('click', () => {
                    updateSidebarMode('normal');
                    openEventModal(event);
                });
            }

            // Remove from Task Board
            card.querySelector('.task-remove-btn').addEventListener('click', async () => {
                await fetch(`${API_URL}/tasks/${task.id}`, { method: 'DELETE' });
                await loadTasks();
            });

            list.appendChild(card);
        });
    });
}

// ==========================================
// FOCUS MODE (L2)
// ==========================================
function openFocusMode() {
    const overlay = document.getElementById('focus-overlay');
    if (!overlay) return;

    // Populate today's events list
    const today = new Date().toISOString().split('T')[0];
    const todayEvents = currentEvents
        .filter(ev => !ev.is_recurring && ev.start_time && ev.start_time.startsWith(today))
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

    const listEl = document.getElementById('focus-event-list');
    if (listEl) {
        listEl.innerHTML = todayEvents.length === 0
            ? '<p class="muted-text" style="font-size:0.9rem">No events scheduled for today.</p>'
            : todayEvents.map(ev => {
                const time = new Date(ev.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return `<div class="focus-event-item">
                    <input type="checkbox" class="focus-done-cb" data-id="${ev.id}">
                    <div>
                        <div class="focus-event-title">${ev.title}</div>
                        <div class="focus-event-time">${time}</div>
                    </div>
                </div>`;
            }).join('');
    }

    // Reset state
    focusMode = 'session';
    focusStartTime = Date.now();
    pomodoroSecondsLeft = 25 * 60;
    const toggleBtn = document.getElementById('focus-mode-toggle');
    const timerDisplay = document.getElementById('focus-timer-display');
    if (toggleBtn) toggleBtn.textContent = 'Pomodoro 25:00';
    if (timerDisplay) timerDisplay.textContent = '00:00';

    // Clear any lingering intervals from a previous session
    focusIntervals.forEach(clearInterval);
    focusIntervals = [];

    // Session count-up timer
    const sessionInterval = setInterval(() => {
        if (focusMode !== 'session' || !timerDisplay) return;
        const elapsed = Math.floor((Date.now() - focusStartTime) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        timerDisplay.textContent = `${m}:${s}`;
    }, 1000);
    focusIntervals.push(sessionInterval);

    // Pomodoro countdown timer
    const pomodoroInterval = setInterval(() => {
        if (focusMode !== 'pomodoro' || !timerDisplay) return;
        pomodoroSecondsLeft = Math.max(0, pomodoroSecondsLeft - 1);
        const m = String(Math.floor(pomodoroSecondsLeft / 60)).padStart(2, '0');
        const s = String(pomodoroSecondsLeft % 60).padStart(2, '0');
        timerDisplay.textContent = `${m}:${s}`;
        if (pomodoroSecondsLeft === 0 && Notification.permission === 'granted') {
            new Notification('Loom — Pomodoro complete!', { body: 'Time for a 5-minute break.' });
        }
    }, 1000);
    focusIntervals.push(pomodoroInterval);

    overlay.classList.remove('hidden');
}

function closeFocusMode() {
    document.getElementById('focus-overlay')?.classList.add('hidden');
    // Clear all setIntervals created during this focus session
    focusIntervals.forEach(clearInterval);
    focusIntervals = [];
}

// ==========================================
// FOCUS MODE v2.0 — Kanban + List + Pomodoro rail
// ==========================================

let activePomodoroTask = null;   // task object currently set as "Focus on this"
let focusViewMode = localStorage.getItem('loom:focus:view') || 'kanban';
let pomodoroIsRunning = false;
let pomodoroWorkSecs  = 25 * 60;  // configurable
let pomodoroShortSecs = 5  * 60;
let pomodoroLongSecs  = 15 * 60;
let pomodoroRoundsBeforeLong = 4;
let pomodoroCurrentRound = 1;
let pomodoroPhase = 'work'; // 'work' | 'short' | 'long'
let pomodoroSessionHistory = []; // { time, taskTitle }
const PINNED_TASKS_KEY = 'loom:pinned-tasks';

function _pinnedTaskIds() {
    try { return new Set(JSON.parse(localStorage.getItem(PINNED_TASKS_KEY) || '[]')); }
    catch { return new Set(); }
}
function _pinTask(id) {
    const s = _pinnedTaskIds(); s.add(id);
    localStorage.setItem(PINNED_TASKS_KEY, JSON.stringify([...s]));
}
function _unpinTask(id) {
    const s = _pinnedTaskIds(); s.delete(id);
    localStorage.setItem(PINNED_TASKS_KEY, JSON.stringify([...s]));
}

function renderFocusPage() {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:contents';
    wrapper.innerHTML = `
        <div class="focus-page" id="focus-page">
            <div class="focus-main">
                <div class="focus-toolbar">
                    <div class="focus-view-toggle">
                        <button class="focus-view-btn${focusViewMode==='kanban'?' active':''}" data-fview="kanban" title="Kanban view">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="3" width="6" height="18" rx="1"/><rect x="9" y="3" width="6" height="18" rx="1"/><rect x="16" y="3" width="6" height="18" rx="1"/></svg>
                            Kanban
                        </button>
                        <button class="focus-view-btn${focusViewMode==='list'?' active':''}" data-fview="list" title="List view">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                            List
                        </button>
                    </div>
                    <span class="focus-task-count" id="focus-task-count"></span>
                </div>
                <div id="focus-board-area"></div>
            </div>
            <div class="pomodoro-rail" id="pomodoro-rail">
                <div class="pomo-clock" id="pomo-clock"></div>
                <div class="pomo-ring-wrap">
                    <svg class="pomo-ring" viewBox="0 0 120 120">
                        <circle class="pomo-ring-bg" cx="60" cy="60" r="54"/>
                        <circle class="pomo-ring-fill" id="pomo-ring-fill" cx="60" cy="60" r="54"
                            stroke-dasharray="339.3" stroke-dashoffset="0" transform="rotate(-90 60 60)"/>
                    </svg>
                    <div class="pomo-time-display" id="pomo-time-display">25:00</div>
                    <div class="pomo-phase-label" id="pomo-phase-label">Work</div>
                </div>
                <div class="pomo-controls">
                    <button class="pomo-btn" id="pomo-play-btn" title="Pause/Resume">⏸</button>
                    <button class="pomo-btn" id="pomo-reset-btn" title="Reset">↺</button>
                    <button class="pomo-btn" id="pomo-settings-toggle" title="Settings">⚙</button>
                </div>
                <div class="pomo-rounds" id="pomo-rounds"></div>
                <div id="pomo-settings-panel" class="pomo-settings hidden">
                    <label class="pomo-setting-row"><span>Work</span><input type="range" id="ps-work" min="5" max="60" step="5" value="${pomodoroWorkSecs/60}"><span id="ps-work-val">${pomodoroWorkSecs/60}m</span></label>
                    <label class="pomo-setting-row"><span>Short break</span><input type="range" id="ps-short" min="1" max="15" step="1" value="${pomodoroShortSecs/60}"><span id="ps-short-val">${pomodoroShortSecs/60}m</span></label>
                    <label class="pomo-setting-row"><span>Long break</span><input type="range" id="ps-long" min="5" max="30" step="5" value="${pomodoroLongSecs/60}"><span id="ps-long-val">${pomodoroLongSecs/60}m</span></label>
                </div>
                <div class="pomo-active-task" id="pomo-active-task">
                    <span class="pomo-active-label">No active task</span>
                </div>
                <div class="pomo-history" id="pomo-history"></div>
            </div>
        </div>`;

    mainContent.appendChild(wrapper);
    _renderFocusBoard();
    _startPomodoroClock();
    _renderPomodoRounds();
    _renderPomodoroHistory();
    _updatePomoTimeDisplay();
    _renderFocusSidebar();

    // View toggle
    document.querySelectorAll('.focus-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            focusViewMode = btn.dataset.fview;
            localStorage.setItem('loom:focus:view', focusViewMode);
            document.querySelectorAll('.focus-view-btn').forEach(b => b.classList.toggle('active', b.dataset.fview === focusViewMode));
            _renderFocusBoard();
        });
    });

    // Pomodoro controls
    document.getElementById('pomo-play-btn')?.addEventListener('click', _togglePomodoro);
    document.getElementById('pomo-reset-btn')?.addEventListener('click', _resetPomodoro);
    document.getElementById('pomo-settings-toggle')?.addEventListener('click', () => {
        document.getElementById('pomo-settings-panel')?.classList.toggle('hidden');
    });

    // Settings sliders
    ['work','short','long'].forEach(key => {
        const el = document.getElementById(`ps-${key}`);
        if (!el) return;
        el.addEventListener('input', () => {
            const mins = parseInt(el.value);
            document.getElementById(`ps-${key}-val`).textContent = `${mins}m`;
            if (key === 'work')  { pomodoroWorkSecs  = mins * 60; if (pomodoroPhase === 'work')  { pomodoroSecondsLeft = pomodoroWorkSecs; _updatePomoTimeDisplay(); } }
            if (key === 'short') { pomodoroShortSecs = mins * 60; if (pomodoroPhase === 'short') { pomodoroSecondsLeft = pomodoroShortSecs; _updatePomoTimeDisplay(); } }
            if (key === 'long')  { pomodoroLongSecs  = mins * 60; if (pomodoroPhase === 'long')  { pomodoroSecondsLeft = pomodoroLongSecs;  _updatePomoTimeDisplay(); } }
        });
    });

    // Only-incomplete filter in focus sidebar
    document.getElementById('focus-only-incomplete')?.addEventListener('change', () => _renderFocusBoard());
}

function _renderFocusSidebar() {
    // Up next: today's events
    const today = new Date().toISOString().split('T')[0];
    const upNext = currentEvents
        .filter(ev => !ev.is_recurring && ev.start_time?.startsWith(today))
        .sort((a, b) => a.start_time.localeCompare(b.start_time))
        .slice(0, 6);
    const upNextEl = document.getElementById('focus-upnext-list');
    if (upNextEl) {
        upNextEl.innerHTML = upNext.length ? upNext.map(ev => {
            const t = new Date(ev.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const now = new Date();
            const isNow = new Date(ev.start_time) <= now && new Date(ev.end_time) >= now;
            return `<div class="focus-upnext-item${isNow?' now':''}">
                ${isNow ? '<span class="focus-now-chip">NOW</span>' : `<span class="focus-upnext-time">${t}</span>`}
                <span class="focus-upnext-title">${ev.title}</span>
            </div>`;
        }).join('') : '<p class="muted-text" style="font-size:0.85rem">No events today.</p>';
    }

    // Pinned tasks
    const pinned = _pinnedTaskIds();
    const pinnedTasks = currentTasks.filter(t => pinned.has(t.id));
    const pinnedEl = document.getElementById('focus-pinned-list');
    if (pinnedEl) {
        pinnedEl.innerHTML = pinnedTasks.length ? pinnedTasks.map(t => {
            const ev = currentEvents.find(e => e.id === t.event_id);
            return `<div class="focus-pinned-item${t.is_complete?' done':''}">
                <span class="focus-pin-icon">📌</span>
                <span>${ev?.title || `Task #${t.id}`}</span>
            </div>`;
        }).join('') : '<p class="muted-text" style="font-size:0.85rem">No pinned tasks.</p>';
    }
}

function _tasksForFocus() {
    const onlyIncomplete = document.getElementById('focus-only-incomplete')?.checked;
    return currentTasks.filter(t => !onlyIncomplete || !t.is_complete);
}

function _renderFocusBoard() {
    const area = document.getElementById('focus-board-area');
    if (!area) return;
    if (focusViewMode === 'kanban') {
        _renderKanban(area);
    } else {
        _renderListView(area);
    }
    // Update task count
    const countEl = document.getElementById('focus-task-count');
    if (countEl) {
        const done = currentTasks.filter(t => t.status === 'done' || t.is_complete).length;
        countEl.textContent = `${currentTasks.length} tasks · ${done} done today`;
    }
}

const KANBAN_COLS = [
    { status: 'backlog',  label: 'Backlog',     color: '#7A8FA6' },
    { status: 'doing',    label: 'In Progress',  color: '#6366F1' },
    { status: 'done',     label: 'Done',         color: '#10B981' },
];

function _renderKanban(container) {
    const tasks = _tasksForFocus();
    const pinned = _pinnedTaskIds();
    container.innerHTML = '';
    container.className = 'kanban-board';

    KANBAN_COLS.forEach(col => {
        const colTasks = tasks.filter(t => (t.status || 'backlog') === col.status);
        const colEl = document.createElement('div');
        colEl.className = 'kanban-col';
        colEl.dataset.status = col.status;

        // Allow drag-over
        colEl.addEventListener('dragover', e => { e.preventDefault(); colEl.classList.add('drag-over'); });
        colEl.addEventListener('dragleave', () => colEl.classList.remove('drag-over'));
        colEl.addEventListener('drop', async e => {
            e.preventDefault();
            colEl.classList.remove('drag-over');
            const taskId = parseInt(e.dataTransfer.getData('text/plain'));
            if (!taskId) return;
            const task = currentTasks.find(t => t.id === taskId);
            if (!task) return;
            await fetch(`${API_URL}/tasks/${taskId}`, {
                method: 'PUT', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ is_complete: col.status === 'done', status: col.status, note: task.note })
            });
            await loadTasks();
            _renderFocusBoard();
        });

        colEl.innerHTML = `
            <div class="kanban-col-header">
                <span class="kanban-col-dot" style="background:${col.color}"></span>
                <span class="kanban-col-title">${col.label}</span>
                <span class="kanban-col-count">${colTasks.length}</span>
            </div>`;

        const cardsEl = document.createElement('div');
        cardsEl.className = 'kanban-col-cards';
        colTasks.forEach(task => cardsEl.appendChild(_makeKanbanCard(task, col.status, pinned)));
        colEl.appendChild(cardsEl);

        const addRow = document.createElement('div');
        addRow.className = 'kanban-add-row';
        addRow.innerHTML = `<input class="kanban-add-input" placeholder="Add a task…">`;
        addRow.querySelector('input').addEventListener('keydown', async e => {
            if (e.key !== 'Enter' || !e.target.value.trim()) return;
            // Quick-add: find first event to link or create with event_id=-1 placeholder
            const note = e.target.value.trim();
            const firstTask = currentTasks[0];
            await fetch(`${API_URL}/tasks/`, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ event_id: firstTask?.event_id || 0, note, status: col.status })
            });
            await loadTasks();
            _renderFocusBoard();
        });
        colEl.appendChild(addRow);
        container.appendChild(colEl);
    });
}

function _makeKanbanCard(task, colStatus, pinned) {
    const ev = currentEvents.find(e => e.id === task.event_id);
    const timeline = ev ? currentTimelines.find(t => t.id === ev.calendar_id) : null;
    const isActive = activePomodoroTask?.id === task.id;
    const isPinned = pinned.has(task.id);
    const priorityColor = { high:'#EF4444', med:'#F59E0B', low:'#4A5568' };
    const prio = task.priority || 'low';

    const card = document.createElement('div');
    card.className = 'kanban-card' + (isActive ? ' kanban-card--active' : '') + (task.is_complete ? ' kanban-card--done' : '');
    card.draggable = true;
    card.dataset.taskId = task.id;

    card.innerHTML = `
        <div class="kanban-card-header">
            <span class="kanban-priority-dot" style="background:${priorityColor[prio]}" title="Priority: ${prio}"></span>
            <span class="kanban-card-title">${ev?.title || `Task #${task.id}`}</span>
            ${isActive ? '<span class="kanban-focusing-chip">● FOCUSING</span>' : ''}
        </div>
        ${timeline ? `<span class="kanban-timeline-chip" style="border-color:${timeline.color}">${timeline.name}</span>` : ''}
        ${task.due_date ? `<span class="kanban-due-date">📅 ${task.due_date}</span>` : ''}
        <div class="kanban-card-menu hidden" data-task="${task.id}">
            <div class="kanban-menu-item focus-on-btn">● Focus on this</div>
            ${KANBAN_COLS.filter(c=>c.status!==colStatus).map(c=>`<div class="kanban-menu-item move-to-btn" data-status="${c.status}">Move → ${c.label}</div>`).join('')}
            <div class="kanban-menu-item pin-btn">${isPinned?'📌 Unpin':'📌 Pin'}</div>
            <div class="kanban-menu-item delete-task-menu-btn" style="color:var(--error)">🗑 Delete</div>
        </div>`;

    card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', task.id); card.classList.add('dragging'); });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));

    card.addEventListener('click', e => {
        if (e.target.closest('.kanban-card-menu')) return;
        // Toggle menu
        const menu = card.querySelector('.kanban-card-menu');
        document.querySelectorAll('.kanban-card-menu:not(.hidden)').forEach(m => { if (m !== menu) m.classList.add('hidden'); });
        menu?.classList.toggle('hidden');
    });

    card.querySelector('.focus-on-btn')?.addEventListener('click', async e => {
        e.stopPropagation();
        activePomodoroTask = task;
        card.querySelector('.kanban-card-menu')?.classList.add('hidden');
        _renderFocusBoard();
        const activeEl = document.getElementById('pomo-active-task');
        if (activeEl) activeEl.innerHTML = `<span class="pomo-active-label">Focusing on:</span><span class="pomo-active-title">${ev?.title || 'Task'}</span>`;
    });

    card.querySelectorAll('.move-to-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const newStatus = btn.dataset.status;
            await fetch(`${API_URL}/tasks/${task.id}`, {
                method: 'PUT', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ is_complete: newStatus==='done', status: newStatus, note: task.note })
            });
            await loadTasks(); _renderFocusBoard();
        });
    });

    card.querySelector('.pin-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        if (isPinned) _unpinTask(task.id); else _pinTask(task.id);
        card.querySelector('.kanban-card-menu')?.classList.add('hidden');
        _renderFocusSidebar();
        _renderFocusBoard();
    });

    card.querySelector('.delete-task-menu-btn')?.addEventListener('click', async e => {
        e.stopPropagation();
        await fetch(`${API_URL}/tasks/${task.id}`, { method: 'DELETE' });
        await loadTasks(); _renderFocusBoard();
    });

    return card;
}

function _renderListView(container) {
    const tasks = _tasksForFocus();
    container.innerHTML = '';
    container.className = 'focus-list-view';
    const priorityColor = { high:'#EF4444', med:'#F59E0B', low:'#4A5568' };

    KANBAN_COLS.forEach(col => {
        const group = tasks.filter(t => (t.status || 'backlog') === col.status);
        const groupEl = document.createElement('div');
        groupEl.className = 'list-group';

        const header = document.createElement('div');
        header.className = 'list-group-header';
        header.innerHTML = `<span class="kanban-col-dot" style="background:${col.color}"></span><span>${col.label}</span><span class="kanban-col-count">${group.length}</span>`;
        header.style.cursor = 'pointer';

        const rowsEl = document.createElement('div');
        rowsEl.className = 'list-group-rows';
        group.forEach(task => {
            const ev = currentEvents.find(e => e.id === task.event_id);
            const timeline = ev ? currentTimelines.find(t => t.id === ev.calendar_id) : null;
            const prio = task.priority || 'low';
            const row = document.createElement('div');
            row.className = 'list-task-row' + (task.is_complete ? ' done' : '');
            row.tabIndex = 0;
            row.dataset.taskId = task.id;
            row.innerHTML = `
                <input type="checkbox" class="list-task-cb" ${task.is_complete?'checked':''} style="accent-color:var(--accent)">
                <span class="kanban-priority-dot" style="background:${priorityColor[prio]}"></span>
                <span class="list-task-title">${ev?.title || `Task #${task.id}`}</span>
                ${timeline ? `<span class="kanban-timeline-chip" style="border-color:${timeline.color}">${timeline.name}</span>` : ''}
                ${task.due_date ? `<span class="kanban-due-date">${task.due_date}</span>` : ''}`;
            row.querySelector('.list-task-cb')?.addEventListener('change', async () => {
                const done = row.querySelector('.list-task-cb').checked;
                await fetch(`${API_URL}/tasks/${task.id}`, {
                    method: 'PUT', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ is_complete: done, status: done?'done':(task.status||'backlog'), note: task.note })
                });
                await loadTasks(); _renderFocusBoard();
            });
            row.addEventListener('keydown', async e => {
                if (e.key === ' ') {
                    e.preventDefault();
                    const cb = row.querySelector('.list-task-cb');
                    cb.checked = !cb.checked;
                    cb.dispatchEvent(new Event('change'));
                }
            });
            rowsEl.appendChild(row);
        });

        header.addEventListener('click', () => rowsEl.classList.toggle('hidden'));
        groupEl.appendChild(header);
        groupEl.appendChild(rowsEl);
        container.appendChild(groupEl);
    });
}

// Pomodoro rail helpers
function _updatePomoTimeDisplay() {
    const m = String(Math.floor(pomodoroSecondsLeft / 60)).padStart(2, '0');
    const s = String(pomodoroSecondsLeft % 60).padStart(2, '0');
    const display = document.getElementById('pomo-time-display');
    const ring    = document.getElementById('pomo-ring-fill');
    const label   = document.getElementById('pomo-phase-label');
    if (display) display.textContent = `${m}:${s}`;
    if (label) {
        const phaseLabels = { work:'Work', short:'Short Break', long:'Long Break' };
        label.textContent = phaseLabels[pomodoroPhase] || 'Work';
    }
    if (ring) {
        const total = pomodoroPhase === 'short' ? pomodoroShortSecs : pomodoroPhase === 'long' ? pomodoroLongSecs : pomodoroWorkSecs;
        const progress = pomodoroSecondsLeft / total;
        const circ = 339.3;
        ring.style.strokeDashoffset = String(circ * (1 - progress));
    }
}

function _startPomodoroClock() {
    const clockEl = document.getElementById('pomo-clock');
    const update = () => {
        if (!clockEl || !document.getElementById('pomo-clock')) return;
        const now = new Date();
        const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
        const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        clockEl.textContent = `${days[now.getDay()]} ${months[now.getMonth()]} ${now.getDate()} · ${now.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'})}`;
    };
    update();
    const id = setInterval(update, 1000);
    focusIntervals.push(id);
}

function _togglePomodoro() {
    pomodoroIsRunning = !pomodoroIsRunning;
    const btn = document.getElementById('pomo-play-btn');
    if (btn) btn.textContent = pomodoroIsRunning ? '⏸' : '▶';
    if (pomodoroIsRunning) {
        const id = setInterval(() => {
            if (!pomodoroIsRunning) return;
            pomodoroSecondsLeft = Math.max(0, pomodoroSecondsLeft - 1);
            _updatePomoTimeDisplay();
            if (pomodoroSecondsLeft === 0) {
                pomodoroIsRunning = false;
                if (pomodoroPhase === 'work') {
                    pomodoroSessionHistory.unshift({ time: new Date().toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'}), taskTitle: activePomodoroTask ? (currentEvents.find(e=>e.id===activePomodoroTask.event_id)?.title || 'Task') : '—' });
                    pomodoroCurrentRound++;
                    pomodoroPhase = (pomodoroCurrentRound % pomodoroRoundsBeforeLong === 1 && pomodoroCurrentRound > 1) ? 'long' : 'short';
                    pomodoroSecondsLeft = pomodoroPhase === 'long' ? pomodoroLongSecs : pomodoroShortSecs;
                } else {
                    pomodoroPhase = 'work';
                    pomodoroSecondsLeft = pomodoroWorkSecs;
                }
                _renderPomodoRounds();
                _renderPomodoroHistory();
                _updatePomoTimeDisplay();
                if (Notification.permission === 'granted') {
                    new Notification('Loom — Pomodoro complete!', { body: pomodoroPhase === 'work' ? 'Back to work!' : 'Time for a break.' });
                }
            }
        }, 1000);
        focusIntervals.push(id);
    }
}

function _resetPomodoro() {
    pomodoroIsRunning = false;
    pomodoroPhase = 'work';
    pomodoroSecondsLeft = pomodoroWorkSecs;
    const btn = document.getElementById('pomo-play-btn');
    if (btn) btn.textContent = '▶';
    _updatePomoTimeDisplay();
}

function _renderPomodoRounds() {
    const el = document.getElementById('pomo-rounds');
    if (!el) return;
    el.innerHTML = Array.from({ length: pomodoroRoundsBeforeLong }, (_, i) => {
        const cls = i + 1 < pomodoroCurrentRound ? 'pomo-round-dot done' : i + 1 === pomodoroCurrentRound ? 'pomo-round-dot current' : 'pomo-round-dot';
        return `<span class="${cls}"></span>`;
    }).join('');
}

function _renderPomodoroHistory() {
    const el = document.getElementById('pomo-history');
    if (!el || !pomodoroSessionHistory.length) return;
    el.innerHTML = `<div class="pomo-history-title">Today</div>` +
        pomodoroSessionHistory.slice(0, 5).map(h =>
            `<div class="pomo-history-row"><span class="pomo-history-time">${h.time}</span><span class="pomo-history-task">✓ ${h.taskTitle}</span></div>`
        ).join('');
}

// ==========================================
// BULK DELETE SELECTED EVENTS (H1)
// ==========================================
async function bulkDeleteSelected() {
    if (selectedEventIds.size === 0) return;
    const ids = [...selectedEventIds];
    // Capture snapshots for undo before deletion
    const snapshots = ids.map(id => currentEvents.find(e => e.id === id)).filter(Boolean);

    await Promise.all(ids.map(id => fetch(`${API_URL}/events/${id}`, { method: 'DELETE' })));

    // Single undo entry for the entire bulk delete
    pushHistory(
        async () => {
            for (const snap of snapshots) {
                await fetch(`${API_URL}/events/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(snap)
                });
            }
        },
        async () => {
            await Promise.all(ids.map(id => fetch(`${API_URL}/events/${id}`, { method: 'DELETE' })));
        },
        `Delete ${ids.length} event${ids.length > 1 ? 's' : ''}`
    );

    selectedEventIds.clear();
    await loadData();
}

// ==========================================
// APP DRAWER (L1)
// ==========================================
// TODO v2.0 cleanup: _legacyInitAppDrawer replaced by components/appDrawer.js
function _legacyInitAppDrawer() {
    // kept for reference only — no longer called
}

// TODO v2.0 cleanup: openDrawer/closeDrawer/setActiveDrawerBtn obsolete — drawer is now persistent
function openDrawer() { drawerOpen = true; }
function closeDrawer() { drawerOpen = false; }
function setActiveDrawerBtn(_activeId) { /* superseded by appDrawer.js */ }

// ==========================================
// EVENT LISTENERS & UI
// ==========================================
function setupEventListeners() {
    // --- Undo / Redo Keybinds & Buttons ---
    // --- Keyboard Shortcuts ---
    document.addEventListener('keydown', (e) => {
        // Global Undo/Redo logic (bypasses modal/typing guards so it works anywhere)
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
            if (e.shiftKey) { e.preventDefault(); performRedo(); }
            else { e.preventDefault(); performUndo(); }
            return;
        }

        // Guard: do not fire shortcuts while typing in form inputs
        const typing = e.target.matches('input, textarea, select');
        // Guard: do not fire if ANY modal is currently visible
        const modalOpen = document.querySelector('.modal:not(.hidden)') !== null;

        if (!typing && !modalOpen) {
            switch(e.key.toLowerCase()) { // use toLowerCase() to catch 'N' or 'n'
                case 'n': e.preventDefault(); openEventModal(); break;
                case 't': calendarInstance.today(); break;
                case '1': calendarInstance.changeView('dayGridMonth'); setActiveView('dayGridMonth'); break;
                case '2': calendarInstance.changeView('timeGridWeek'); setActiveView('timeGridWeek'); break;
                case '3': calendarInstance.changeView('timeGridDay'); setActiveView('timeGridDay'); break;
                case '4': calendarInstance.changeView('listWeek'); setActiveView('listWeek'); break;
                case '[': calendarInstance.prev(); break;
                case ']': calendarInstance.next(); break;
                case 'b': document.getElementById('sidebar-toggle').click(); break;
                case '/': e.preventDefault(); document.getElementById('event-search').focus(); break;
                case 'f': e.preventDefault(); document.dispatchEvent(new CustomEvent('loom:navigate', { detail: { destination: 'focus' } })); break;
                // H1: bulk-delete all selected events with a single undo entry
                case 'delete':
                case 'backspace':
                    if (selectedEventIds.size > 0) { e.preventDefault(); bulkDeleteSelected(); }
                    break;
            }
        }

        // Ensure Escape closes the mention dropdown and exits focus mode (L2)
        if (e.key === 'Escape') {
            document.getElementById("mention-dropdown").classList.add("hidden");
            if (!document.getElementById('focus-overlay')?.classList.contains('hidden')) closeFocusMode();
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
    // M3: Templates panel
    document.getElementById('menu-templates-btn').addEventListener('click', () => {
        document.getElementById('sidebar-dropdown').classList.add('hidden');
        openSidebarTemplates();
    });
    document.getElementById('close-templates-btn').addEventListener('click', () => updateSidebarMode('normal'));

    // Task Board panel
    document.getElementById('menu-taskboard-btn').addEventListener('click', () => {
        document.getElementById('sidebar-dropdown').classList.add('hidden');
        openSidebarTaskboard();
    });
    document.getElementById('close-taskboard-btn').addEventListener('click', () => {
        updateSidebarMode('normal');
    });
    document.getElementById('add-to-taskboard-btn').addEventListener('click', async () => {
        const id = document.getElementById('event-id').value;
        if (!id) return;
        const btn = document.getElementById('add-to-taskboard-btn');
        if (btn.classList.contains('on-taskboard')) return; // Already added
        try {
            const res = await fetch(`${API_URL}/tasks/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event_id: parseInt(id), note: null })
            });
            if (res.ok) {
                btn.textContent = '✓ On Task Board';
                btn.classList.add('on-taskboard');
                await loadTasks();
            }
        } catch (err) {
            console.error('Failed to add to task board:', err);
        }
    });
    // Task Board filter pills
    ['task-filter-all', 'task-filter-active', 'task-filter-done'].forEach(id => {
        document.getElementById(id).addEventListener('click', () => {
            currentTaskFilter = id.replace('task-filter-', '');
            document.querySelectorAll('#sidebar-taskboard-panel .format-pill')
                .forEach(p => p.classList.remove('active'));
            document.getElementById(id).classList.add('active');
            renderTaskBoard(currentTaskFilter);
        });
    });

    // M5: Statistics panel
    document.getElementById('menu-stats-btn').addEventListener('click', () => {
        document.getElementById('sidebar-dropdown').classList.add('hidden');
        openStatsPanel();
    });
    document.getElementById('close-stats-btn').addEventListener('click', () => updateSidebarMode('normal'));
    // L4: Print week view
    document.getElementById('menu-print-btn').addEventListener('click', () => {
        document.getElementById('sidebar-dropdown').classList.add('hidden');
        openPrintView();
    });
    // L2: Focus mode via hamburger menu
    document.getElementById('menu-focus-btn').addEventListener('click', () => {
        document.getElementById('sidebar-dropdown').classList.add('hidden');
        openFocusMode();
    });
    document.getElementById('focus-close-btn').addEventListener('click', closeFocusMode);
    document.getElementById('focus-mode-toggle').addEventListener('click', () => {
        const timerDisplay = document.getElementById('focus-timer-display');
        const toggleBtn = document.getElementById('focus-mode-toggle');
        if (focusMode === 'session') {
            focusMode = 'pomodoro';
            pomodoroSecondsLeft = 25 * 60;
            if (timerDisplay) timerDisplay.textContent = '25:00';
            if (toggleBtn) toggleBtn.textContent = 'Session Timer';
        } else {
            focusMode = 'session';
            focusStartTime = Date.now();
            if (timerDisplay) timerDisplay.textContent = '00:00';
            if (toggleBtn) toggleBtn.textContent = 'Pomodoro 25:00';
        }
    });
    document.getElementById('focus-timer-reset').addEventListener('click', () => {
        const timerDisplay = document.getElementById('focus-timer-display');
        if (focusMode === 'session') {
            focusStartTime = Date.now();
            if (timerDisplay) timerDisplay.textContent = '00:00';
        } else {
            pomodoroSecondsLeft = 25 * 60;
            if (timerDisplay) timerDisplay.textContent = '25:00';
        }
    });

    // --- Scroll Wheel Zoom (Debounced) ---
    const views = ['dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listWeek'];
    let zoomDebounce = null;
    document.getElementById('calendar-container').addEventListener('wheel', (e) => {
        e.preventDefault();
        if (zoomDebounce) return;
        zoomDebounce = setTimeout(() => zoomDebounce = null, 300);
        const currentView = calendarInstance.view.type;
        let idx = views.indexOf(currentView);
        
        // Scroll down from day view goes to list view
        if (e.deltaY < 0 && idx < views.length - 1) calendarInstance.changeView(views[idx + 1]);
        else if (e.deltaY > 0 && idx > 0) calendarInstance.changeView(views[idx - 1]);
    });

    // --- Timeline Change Listener for Dot Color ---
    const eventTimelineSelect = document.getElementById("event-timeline");
    if (eventTimelineSelect) {
        eventTimelineSelect.addEventListener('change', (e) => {
            setModalTitleDot(e.target.value);
        });
    }
    // v2.0: sidebar toggle is handled by contextSidebar.js (click listener on #sidebar-toggle)

    // --- Search Listener (H6: also controls + quick-add button visibility) ---
    const searchInput = document.getElementById("event-search");
    const searchQABtn = document.getElementById("search-quick-add-btn");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            const val = e.target.value.trim().toLowerCase();
            if (val === "") {
                clearSidebarSearch();
                if (searchQABtn) searchQABtn.classList.add('hidden');
            } else {
                showSidebarSearchResults(val);
                // H6: show + button only when typed text has no exact title match
                const hasExact = currentEvents.some(ev => (ev.title || "").toLowerCase() === val);
                if (searchQABtn) searchQABtn.classList.toggle('hidden', hasExact);
            }
            renderCalendarEvents(val);
        });
    }
    // --- v2.0 Sidebar footer quick actions ---
    document.getElementById('sidebar-new-event-btn')?.addEventListener('click', () => openEventModal());
    document.getElementById('sidebar-avail-btn')?.addEventListener('click', () => openAvailabilityModal());
    document.getElementById('sidebar-import-btn')?.addEventListener('click', () => {
        document.getElementById('import-error')?.classList.add('hidden');
        document.getElementById('import-file-input')?.click();
    });
    document.getElementById('sidebar-pdf-btn')?.addEventListener('click', () => {
        document.getElementById('import-error')?.classList.add('hidden');
        document.getElementById('import-file-input')?.click();
    });

    // --- v2.0 Sidebar filter checkboxes ---
    ['filter-has-checklist', 'filter-recurring', 'filter-this-week'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            const searchTerm = document.getElementById('event-search')?.value.toLowerCase() || '';
            renderCalendarEvents(searchTerm);
        });
    });

    // H6: + button inside search calls submitQuickAdd with current search text
    if (searchQABtn) {
        searchQABtn.addEventListener("click", () => {
            const val = searchInput?.value.trim();
            if (val) submitQuickAdd(val);
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

    // H4: skip this occurrence of a recurring event
    document.getElementById("skip-occurrence-btn").addEventListener("click", async () => {
        const btn = document.getElementById("skip-occurrence-btn");
        const eventId = btn.dataset.eventId;
        const dateStr = btn.dataset.date;
        if (!eventId || !dateStr) return;
        await skipOccurrence(eventId, dateStr);
    });

    // L3: checklist — add item via button click
    document.getElementById("checklist-add-btn").addEventListener("click", async () => {
        const input = document.getElementById("checklist-new-item");
        const text = input.value.trim();
        if (!text) return;
        currentChecklist.push({ text, done: false });
        input.value = "";
        renderChecklist();
        await saveChecklistImmediate();
    });

    // L3: checklist — add item via Enter key
    document.getElementById("checklist-new-item").addEventListener("keydown", async (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const text = e.target.value.trim();
        if (!text) return;
        currentChecklist.push({ text, done: false });
        e.target.value = "";
        renderChecklist();
        await saveChecklistImmediate();
    });
    
    document.getElementById("save-event-btn").addEventListener("click", async (e) => {
        const btn = e.target;
        // Frontend Validation
        clearModalError();
        const title = document.getElementById('event-title').value.trim();
        if (!title) { showModalError('Event title is required.'); return; }
        
        const isAllDay = document.getElementById('event-is-allday').checked;
        // Skip time-order validation for all-day events (uses date pickers, not datetime-local)
        if (!isAllDay) {
            const startVal = document.getElementById('event-start').value;
            const endVal = document.getElementById('event-end').value;
            if (startVal && endVal && new Date(endVal) <= new Date(startVal)) {
                showModalError('End time must be after start time.'); return;
            }
        }
        let id = document.getElementById("event-id").value;
        const isRecurring = document.getElementById("event-is-recurring").checked;
        const calId = document.getElementById("event-timeline").value;

        if(!calId || calId === "__new__") { alert("Please save the new timeline first."); return; }

        // Clear previous warnings
        const warningEl = document.getElementById('conflict-warning');
        warningEl.classList.add('hidden');
        warningEl.textContent = '';

        // L3: include checklist in every save (in-memory array stays authoritative)
        const checklistVal = currentChecklist.length > 0 ? JSON.stringify(currentChecklist) : null;
        // H4: preserve skipped_dates when saving so they aren't wiped on edit
        const existingSkippedDates = id ? (currentEvents.find(e => e.id == id)?.skipped_dates || null) : null;

        let payload = {
            title: document.getElementById("event-title").value,
            calendar_id: parseInt(calId),
            is_recurring: isRecurring,
            is_all_day: isAllDay,
            description: document.getElementById("event-description").value,
            unique_description: document.getElementById("event-unique-description").value,
            reminder_minutes: parseInt(document.getElementById("event-reminder").value) || null,
            timezone: currentEventTimezone,
            skipped_dates: existingSkippedDates,
            checklist: checklistVal,
            per_day_times: null
        };

        if (isAllDay) {
            // H2: build full ISO strings from the date-only pickers
            const startDate = document.getElementById('allday-start-date').value;
            const endDate = document.getElementById('allday-end-date').value;
            if (!startDate || !endDate) { showModalError('Start and end dates are required for all-day events.'); return; }
            payload.start_time = `${startDate}T00:00:00`;
            payload.end_time = `${endDate}T23:59:59`;
            payload.recurrence_days = null; payload.recurrence_end = null;
        } else if (isRecurring) {
            const tStart = document.getElementById("recur-start-time").value || "09:00";
            const tEnd = document.getElementById("recur-end-time").value || "10:00";
            const today = new Date().toISOString().split('T')[0];
            payload.start_time = `${today}T${tStart}:00`; payload.end_time = `${today}T${tEnd}:00`;
            payload.recurrence_end = document.getElementById("recur-end-date").value;
            payload.recurrence_days = Array.from(document.querySelectorAll('.recur-day:checked')).map(cb => cb.value).join(',');
            // H5: serialize per-day times if the toggle is checked
            if (document.getElementById('recur-per-day-toggle').checked) {
                payload.per_day_times = serializePerDayTimes();
            }
        } else {
            payload.start_time = new Date(document.getElementById("event-start").value).toISOString();
            payload.end_time = new Date(document.getElementById("event-end").value).toISOString();
            payload.recurrence_days = null; payload.recurrence_end = null;
        }

        // Conflict Check Pipeline
        if (btn.textContent !== "Confirm Save") {
            const conflicts = checkForConflicts(payload.start_time, payload.end_time, calId, id);
            if (conflicts.length > 0) {
                warningEl.textContent = `Overlaps with: ${conflicts.slice(0,3).join(', ')}${conflicts.length > 3 ? '...' : ''}`;
                warningEl.classList.remove('hidden');
                btn.textContent = "Confirm Save";
                return; // Halt save to let user confirm
            }
        }

        btn.textContent = "Saving..."; // Visual feedback

        const method = id ? "PUT" : "POST";
        const url = id ? `${API_URL}/events/${id}` : `${API_URL}/events/`;
        let preEditSnapshot = id ? currentEvents.find(e => e.id == id) : null;

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
        btn.textContent = "Save"; // Reset button text
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
    document.getElementById("duplicate-event-btn").addEventListener("click", async () => {
        const isRecurring = document.getElementById("event-is-recurring").checked;
        const calId = document.getElementById("event-timeline").value;
        
        if(!calId || calId === "__new__") { alert("Please save the new timeline first."); return; }

        // Construct full payload to support recurring events per the mitigation strategy
        let payload = {
            title: "Copy of " + document.getElementById("event-title").value,
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

        const res = await fetch(`${API_URL}/events/`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify(payload),
        });
        
        if (res.ok) {
            const newEvent = await res.json();
            
            // Push undo: delete the new event
            undoStack.push({
                label: 'Duplicate event',
                undo: async () => { await fetch(`${API_URL}/events/${newEvent.id}`, { method: 'DELETE' }); },
                redo: async () => { await fetch(`${API_URL}/events/`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) }); }
            });
            if (undoStack.length > 50) undoStack.shift();
            redoStack = []; 
            updateUndoRedoButtons();
            
            document.getElementById('event-modal').classList.add('hidden');
            await loadData();
        }
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
    // M4: Daily agenda setting — persist preference in localStorage
    const agendaToggle = document.getElementById('daily-agenda-toggle');
    if (agendaToggle) {
        agendaToggle.checked = localStorage.getItem('loom-daily-agenda') !== 'false';
        agendaToggle.addEventListener('change', () => {
            localStorage.setItem('loom-daily-agenda', agendaToggle.checked ? 'true' : 'false');
        });
    }
    // --- Backup & Restore Logic ---
    document.getElementById('backup-db-btn').addEventListener('click', async () => {
        const res = await fetch(`${API_URL}/admin/backup`);
        if (res.ok) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'loom-backup.sqlite3'; a.click();
            URL.revokeObjectURL(url);
        }
    });

    document.getElementById('restore-db-btn').addEventListener('click', () => {
        document.getElementById('restore-file-input').click();
    });

    document.getElementById('restore-file-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!confirm('This replaces ALL current data with the backup. Are you sure?')) {
            e.target.value = ''; // Reset input if canceled
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`${API_URL}/admin/restore`, { method: 'POST', body: formData });
        if (res.ok) {
            alert('Restore successful. Reloading...');
            await loadData();
        } else {
            const err = await res.json();
            alert('Restore failed: ' + (err?.detail?.error?.detail || 'Unknown error'));
        }
        e.target.value = ''; // Reset input
    });

    // --- Crash dialog ---
    document.getElementById('crash-send-btn')?.addEventListener('click', async () => {
        const res = await fetch(`${API_URL}/api/logs/export`);
        if (res.ok) {
            const blob = await res.blob();
            const a = Object.assign(document.createElement('a'),
                { href: URL.createObjectURL(blob), download: 'loomassist_logs.txt' });
            a.click();
            URL.revokeObjectURL(a.href);
        }
        const issueUrl = 'https://github.com/allandng/LoomAssist/issues/new?title=Crash+report+v1.4&body=Please+attach+your+loomassist_logs.txt+file+below.+Describe+what+you+were+doing+when+the+crash+occurred.';
        if (window.__TAURI__) {
            window.__TAURI__.opener.openUrl(issueUrl);
        } else {
            window.open(issueUrl, '_blank');
        }
        const modal = document.getElementById('crash-modal');
        if (modal) { modal.classList.add('hidden'); modal.__shown = false; }
    });
    document.getElementById('crash-dismiss-btn')?.addEventListener('click', () => {
        const modal = document.getElementById('crash-modal');
        if (modal) { modal.classList.add('hidden'); modal.__shown = false; }
    });

    // --- Settings: Diagnostics & Logs ---
    const crashToggle = document.getElementById('crash-reports-toggle');
    if (crashToggle) {
        crashToggle.checked = localStorage.getItem('loom_crash_reports_enabled') !== 'false';
        crashToggle.addEventListener('change', () =>
            localStorage.setItem('loom_crash_reports_enabled', crashToggle.checked ? 'true' : 'false'));
    }
    document.getElementById('view-logs-btn')?.addEventListener('click', async () => {
        const res = await fetch(`${API_URL}/api/logs/export`);
        if (!res.ok) return;
        const blob = await res.blob();
        const a = Object.assign(document.createElement('a'),
            { href: URL.createObjectURL(blob), download: 'loomassist_logs.txt' });
        a.click();
        URL.revokeObjectURL(a.href);
    });
    document.getElementById('clear-logs-btn')?.addEventListener('click', async () => {
        if (!confirm('Clear all log files?')) return;
        await fetch(`${API_URL}/api/logs`, { method: 'DELETE' });
    });

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

            const _pdfNotifId = addNotification({
                type: 'progress',
                title: 'Reading syllabus…',
                message: `${file.name} · AI extraction in progress`,
                progress: 20,
                dismissible: false,
            });
            let _pdfProg = 20;
            const _pdfInt = setInterval(() => {
                _pdfProg = _pdfProg >= 80 ? 20 : _pdfProg + 10;
                updateNotification(_pdfNotifId, { progress: _pdfProg });
            }, 600);

            const formData = new FormData(); formData.append('file', file);
            try {
                const response = await fetch(`${API_URL}/documents/extract-syllabus/`, { method: 'POST', body: formData });
                const result = await response.json();
                clearInterval(_pdfInt);
                if (response.ok && result.events && result.events.length > 0) {
                    importError.classList.add('hidden');
                    openSidebarApproval(result.events);
                    updateNotification(_pdfNotifId, {
                        type: 'success',
                        title: 'Syllabus extracted',
                        message: `${result.events.length} event${result.events.length !== 1 ? 's' : ''} found — review in sidebar.`,
                        progress: null,
                        dismissible: true,
                        actionable: true,
                        actionLabel: 'Review in sidebar →',
                        actionFn: () => {},
                    });
                } else {
                    importError.textContent = "No valid dates could be extracted from this PDF.";
                    importError.style.color = "var(--danger)";
                    updateNotification(_pdfNotifId, {
                        type: 'error',
                        title: 'No dates found',
                        message: 'No valid events could be extracted from this PDF.',
                        progress: null,
                        dismissible: true,
                    });
                    setTimeout(() => updateSidebarMode("normal"), 3000);
                }
            } catch (err) {
                clearInterval(_pdfInt);
                importError.textContent = "Network error during AI extraction.";
                importError.style.color = "var(--danger)";
                updateNotification(_pdfNotifId, {
                    type: 'error',
                    title: 'Extraction failed',
                    message: 'Network error during AI extraction.',
                    progress: null,
                    dismissible: true,
                });
            }
        }
    });

    document.getElementById('cancel-ics-btn').addEventListener('click', () => { icsModal.classList.add('hidden'); importFileInput.value = ""; });
    confirmIcsBtn.addEventListener('click', async () => {
        const calId = document.getElementById('ics-timeline-select').value;
        if(!calId || calId === "__new__") { alert("Please save the new timeline first."); return; }
        
        confirmIcsBtn.disabled = true; confirmIcsBtn.textContent = "Importing...";
        const file = importFileInput.files[0];
        const formData = new FormData(); formData.append('file', file); formData.append('calendar_id', calId);

        const _icsFileName = file?.name ?? 'calendar.ics';
        const _icsNotifId = addNotification({
            type: 'progress',
            title: 'Importing calendar…',
            message: _icsFileName,
            progress: 30,
            dismissible: false,
        });

        try {
            const response = await fetch(`${API_URL}/integrations/import-ics-file/`, { method: 'POST', body: formData });
            const data = await response.json();
            if (response.ok) {
                document.getElementById('ics-import-status').textContent = '✓ ' + data.events_added + ' events imported, ' + data.events_skipped + ' duplicates skipped.';                document.getElementById('ics-import-status').style.color = "#10b981";

                updateNotification(_icsNotifId, {
                    type: data.events_skipped > 0 ? 'warning' : 'success',
                    title: 'Import complete',
                    message: `${data.events_added} event${data.events_added !== 1 ? 's' : ''} imported` +
                        (data.events_skipped > 0 ? `, ${data.events_skipped} duplicate${data.events_skipped !== 1 ? 's' : ''} skipped.` : '.'),
                    progress: null,
                    dismissible: true,
                    autoRemoveMs: 8000,
                });

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
            } else {
                updateNotification(_icsNotifId, {
                    type: 'error',
                    title: 'Import failed',
                    message: 'Server returned an error.',
                    progress: null,
                    dismissible: true,
                });
                confirmIcsBtn.disabled = false;
            }
        } catch (err) {
            updateNotification(_icsNotifId, {
                type: 'error',
                title: 'Import failed',
                message: 'Network error. Please try again.',
                progress: null,
                dismissible: true,
            });
            confirmIcsBtn.disabled = false;
        }
    });
    // --- Onboarding Logic ---
    document.getElementById('onboarding-next-btn').addEventListener('click', () => {
        if (onboardingStep < ONBOARD_STEPS - 1) { 
            onboardingStep++; 
            showOnboardingStep(onboardingStep); 
        } else { 
            localStorage.setItem('loom-onboarded', 'true'); 
            document.getElementById('onboarding-modal').classList.add('hidden'); 
        }
    });

    document.getElementById('onboarding-prev-btn').addEventListener('click', () => {
        if (onboardingStep > 0) { 
            onboardingStep--; 
            showOnboardingStep(onboardingStep); 
        }
    });

    document.getElementById('replay-onboarding-btn').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('hidden');
        onboardingStep = 0;
        showOnboardingStep(onboardingStep);
        document.getElementById('onboarding-modal').classList.remove('hidden');
    });

    // --- Send Availability ---
    document.getElementById("send-availability-btn").addEventListener("click", openAvailabilityModal);

    document.getElementById("avail-cancel-btn").addEventListener("click", () => {
        document.getElementById("availability-modal").classList.add("hidden");
    });

    document.getElementById("avail-send-btn").addEventListener("click", sendAvailability);

    document.getElementById("avail-cal-prev").addEventListener("click", () => {
        availabilityCalMonth--;
        if (availabilityCalMonth < 0) { availabilityCalMonth = 11; availabilityCalYear--; }
        renderMiniCalendar(availabilityCalYear, availabilityCalMonth);
    });

    document.getElementById("avail-cal-next").addEventListener("click", () => {
        availabilityCalMonth++;
        if (availabilityCalMonth > 11) { availabilityCalMonth = 0; availabilityCalYear++; }
        renderMiniCalendar(availabilityCalYear, availabilityCalMonth);
    });

    document.getElementById("avail-copy-btn").addEventListener("click", () => {
        const link = document.getElementById("avail-share-link").value;
        navigator.clipboard.writeText(link).then(() => {
            const btn = document.getElementById("avail-copy-btn");
            btn.textContent = "Copied!";
            setTimeout(() => { btn.textContent = "Copy"; }, 2000);
        });
    });

    document.getElementById("avail-open-browser-btn").addEventListener("click", () => {
        const link = document.getElementById("avail-share-link").value;
        if (link) window.open(link, "_blank");
    });

    document.getElementById("avail-response-close-btn").addEventListener("click", () => {
        stopAvailabilityPolling();
        document.getElementById("availability-response-modal").classList.add("hidden");
    });

    document.getElementById("avail-accept-amendment-btn").addEventListener("click", () => {
        if (availabilityCurrentToken) handleAmendmentResponse(availabilityCurrentToken, "accept");
    });

    document.getElementById("avail-decline-amendment-btn").addEventListener("click", () => {
        if (availabilityCurrentToken) handleAmendmentResponse(availabilityCurrentToken, "decline");
    });

    document.getElementById("avail-counter-btn").addEventListener("click", () => {
        document.getElementById("avail-counter-section").classList.toggle("hidden");
    });

    document.getElementById("avail-send-counter-btn").addEventListener("click", () => {
        if (!availabilityCurrentToken) return;
        const date = document.getElementById("avail-counter-date").value;
        const start = document.getElementById("avail-counter-start").value;
        const end = document.getElementById("avail-counter-end").value;
        if (!date || !start || !end) return;
        handleAmendmentResponse(availabilityCurrentToken, "counter", { date, start, end });
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
            const _vNotifId = addNotification({
                type: 'progress',
                title: 'Transcribing audio…',
                message: 'Processing your recording with AI.',
                progress: 15,
                dismissible: false,
            });
            let _vProg = 15;
            const _vInt = setInterval(() => {
                _vProg = _vProg >= 85 ? 15 : _vProg + 10;
                updateNotification(_vNotifId, { progress: _vProg });
            }, 500);
            try {
                const _vResp = await fetch(`${API_URL}/transcribe`, { method: "POST", body: formData });
                clearInterval(_vInt);
                if (_vResp.ok) {
                    const _vData = await _vResp.json();
                    const _vErrors = (_vData.execution_results ?? []).filter(r => r.error);
                    const _vAdded  = (_vData.execution_results ?? []).filter(r => r.event_id);
                    if (_vErrors.length > 0) {
                        updateNotification(_vNotifId, {
                            type: 'error',
                            title: 'Transcription error',
                            message: _vErrors[0].error?.detail ?? 'Could not process audio.',
                            progress: null,
                            dismissible: true,
                        });
                    } else {
                        updateNotification(_vNotifId, {
                            type: 'success',
                            title: 'Voice processed',
                            message: `${_vAdded.length} event${_vAdded.length !== 1 ? 's' : ''} added.`,
                            progress: null,
                            dismissible: true,
                            autoRemoveMs: 6000,
                        });
                    }
                    await loadData();
                } else {
                    updateNotification(_vNotifId, {
                        type: 'error',
                        title: 'Transcription failed',
                        message: 'Server returned an error.',
                        progress: null,
                        dismissible: true,
                    });
                }
            } catch (err) {
                clearInterval(_vInt);
                updateNotification(_vNotifId, {
                    type: 'error',
                    title: 'Transcription failed',
                    message: 'Network error. Please try again.',
                    progress: null,
                    dismissible: true,
                });
                console.error(err);
            } finally { micBtn.innerHTML = "🎤 Listen"; isRecording = false; }
        };
    }
}

// ==========================================
// SEND AVAILABILITY FEATURE
// ==========================================

let availabilitySelectedDays = new Set();
let availabilityCalYear = new Date().getFullYear();
let availabilityCalMonth = new Date().getMonth();
let availabilityPollingId = null;
let availabilityCurrentToken = null;

function openAvailabilityModal() {
    availabilitySelectedDays = new Set();
    availabilityCalYear = new Date().getFullYear();
    availabilityCalMonth = new Date().getMonth();
    renderMiniCalendar(availabilityCalYear, availabilityCalMonth);
    renderTimeWindowList();
    document.getElementById("avail-conflicts").innerHTML = "";
    const errEl = document.getElementById("avail-modal-error");
    errEl.textContent = "";
    errEl.classList.add("hidden");
    const savedName = localStorage.getItem("loom-sender-name") || "";
    document.getElementById("avail-sender-name").value = savedName;
    document.getElementById("availability-modal").classList.remove("hidden");
}

function renderMiniCalendar(year, month) {
    const container = document.getElementById("avail-mini-cal");
    const label = document.getElementById("avail-cal-month-label");
    const dayNames = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    const monthNames = ["January","February","March","April","May","June",
                        "July","August","September","October","November","December"];
    label.textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let html = dayNames.map(d => `<div class="avail-cal-day-header">${d}</div>`).join("");
    for (let i = 0; i < firstDay; i++) {
        html += `<div class="avail-cal-day avail-cal-day-empty"></div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month, d);
        const isPast = dateObj < today;
        const isToday = dateObj.getTime() === today.getTime();
        const mm = String(month + 1).padStart(2, "0");
        const dd = String(d).padStart(2, "0");
        const dateStr = `${year}-${mm}-${dd}`;
        const isSelected = availabilitySelectedDays.has(dateStr);

        let cls = "avail-cal-day";
        if (isPast) cls += " avail-cal-day-past";
        if (isToday) cls += " avail-cal-day-today";
        if (isSelected) cls += " avail-cal-day-selected";

        html += `<div class="${cls}" data-date="${dateStr}">${d}</div>`;
    }
    container.innerHTML = html;
    container.onclick = (e) => {
        const cell = e.target.closest(".avail-cal-day");
        if (!cell || cell.classList.contains("avail-cal-day-past") || cell.classList.contains("avail-cal-day-empty")) return;
        toggleDaySelection(cell.dataset.date);
    };
}

function toggleDaySelection(dateStr) {
    if (availabilitySelectedDays.has(dateStr)) {
        availabilitySelectedDays.delete(dateStr);
    } else {
        availabilitySelectedDays.add(dateStr);
    }
    renderMiniCalendar(availabilityCalYear, availabilityCalMonth);
    renderTimeWindowList();
    checkConflictsForSlots();
}

function renderTimeWindowList() {
    const container = document.getElementById("avail-time-windows");
    const sortedDays = Array.from(availabilitySelectedDays).sort();
    if (sortedDays.length === 0) {
        container.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);text-align:center;padding:8px 0;">Click dates above to add availability windows.</p>`;
        return;
    }
    container.innerHTML = "";
    sortedDays.forEach(dateStr => {
        const d = new Date(dateStr + "T00:00:00");
        const chipLabel = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        const row = document.createElement("div");
        row.className = "avail-time-row";
        row.dataset.date = dateStr;
        row.innerHTML = `
            <span class="avail-date-chip">${chipLabel}</span>
            <input type="time" class="form-input avail-start-time" data-date="${dateStr}" value="09:00">
            <span style="color:var(--text-muted);font-size:0.8rem;flex-shrink:0;">to</span>
            <input type="time" class="form-input avail-end-time" data-date="${dateStr}" value="17:00">
            <button class="avail-remove-day-btn" data-date="${dateStr}" title="Remove">&#215;</button>
        `;
        row.querySelector(".avail-remove-day-btn").addEventListener("click", (e) => {
            availabilitySelectedDays.delete(e.target.dataset.date);
            renderMiniCalendar(availabilityCalYear, availabilityCalMonth);
            renderTimeWindowList();
            checkConflictsForSlots();
        });
        row.querySelector(".avail-start-time").addEventListener("change", checkConflictsForSlots);
        row.querySelector(".avail-end-time").addEventListener("change", checkConflictsForSlots);
        container.appendChild(row);
    });
}

function checkConflictsForSlots() {
    const conflictContainer = document.getElementById("avail-conflicts");
    conflictContainer.innerHTML = "";
    document.querySelectorAll(".avail-time-row").forEach(row => {
        const dateStr = row.dataset.date;
        const start = row.querySelector(".avail-start-time")?.value;
        const end = row.querySelector(".avail-end-time")?.value;
        if (!start || !end) return;
        const sStart = new Date(`${dateStr}T${start}:00`).getTime();
        const sEnd = new Date(`${dateStr}T${end}:00`).getTime();
        const overlapping = (currentEvents || []).filter(ev => {
            if (ev.is_recurring) return false;
            const eStart = new Date(ev.start_time).getTime();
            const eEnd = new Date(ev.end_time).getTime();
            return sStart < eEnd && sEnd > eStart;
        });
        if (overlapping.length > 0) {
            const names = overlapping.slice(0, 2).map(e => e.title).join(", ");
            const w = document.createElement("div");
            w.className = "avail-conflict-warning";
            w.textContent = `⚠ ${dateStr}: conflicts with ${names}${overlapping.length > 2 ? "…" : ""}`;
            conflictContainer.appendChild(w);
        }
    });
}

async function sendAvailability() {
    const senderName = document.getElementById("avail-sender-name").value.trim();
    const durationMinutes = parseInt(document.getElementById("avail-duration").value);
    const errEl = document.getElementById("avail-modal-error");

    if (!senderName) {
        errEl.textContent = "Please enter your name.";
        errEl.classList.remove("hidden");
        return;
    }
    const rows = document.querySelectorAll(".avail-time-row");
    if (rows.length === 0) {
        errEl.textContent = "Please select at least one date.";
        errEl.classList.remove("hidden");
        return;
    }
    const slots = [];
    let hasTimeError = false;
    rows.forEach(row => {
        const date = row.dataset.date;
        const start = row.querySelector(".avail-start-time")?.value;
        const end = row.querySelector(".avail-end-time")?.value;
        if (start && end && end > start) {
            slots.push({ date, start, end });
        } else {
            hasTimeError = true;
        }
    });
    if (hasTimeError) {
        errEl.textContent = "End time must be after start time for all slots.";
        errEl.classList.remove("hidden");
        return;
    }
    localStorage.setItem("loom-sender-name", senderName);
    const sendBtn = document.getElementById("avail-send-btn");
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
    errEl.classList.add("hidden");
    try {
        const res = await fetch(`${API_URL}/availability`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sender_name: senderName, duration_minutes: durationMinutes, slots })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            errEl.textContent = err?.error?.detail || "Failed to create link.";
            errEl.classList.remove("hidden");
            return;
        }
        const data = await res.json();
        availabilityCurrentToken = data.token;
        document.getElementById("availability-modal").classList.add("hidden");
        document.getElementById("avail-share-link").value = data.share_url;
        document.getElementById("avail-status-text").textContent = "Pending";
        document.getElementById("avail-confirmed-slot-display").classList.add("hidden");
        document.getElementById("avail-amendment-section").classList.add("hidden");
        document.getElementById("avail-counter-section").classList.add("hidden");
        document.getElementById("availability-response-modal").classList.remove("hidden");
        startAvailabilityPolling(data.token);
        addNotification({
            type: 'info',
            title: 'Availability link sent',
            message: `Share link created for ${senderName} — waiting for a response.`,
            dismissible: true,
            autoRemoveMs: 8000,
        });
    } catch (e) {
        errEl.textContent = "Network error. Is the backend running?";
        errEl.classList.remove("hidden");
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send link";
    }
}

function startAvailabilityPolling(token) {
    stopAvailabilityPolling();
    pollAvailabilityStatus(token);
    availabilityPollingId = setInterval(() => pollAvailabilityStatus(token), 10000);
}

function stopAvailabilityPolling() {
    if (availabilityPollingId) {
        clearInterval(availabilityPollingId);
        availabilityPollingId = null;
    }
}

async function pollAvailabilityStatus(token) {
    const indicator = document.getElementById("avail-poll-indicator");
    const statusEl = document.getElementById("avail-status-text");
    if (!statusEl) return;
    if (indicator) indicator.textContent = "Checking…";
    try {
        const res = await fetch(`${API_URL}/availability/${token}`);
        if (res.status === 410) {
            if (indicator) indicator.textContent = "Expired";
            if (statusEl) statusEl.textContent = "Expired";
            stopAvailabilityPolling();
            return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (indicator) indicator.textContent = "Live";

        if (data.status === "confirmed" && statusEl.textContent !== "Confirmed") {
            statusEl.textContent = "Confirmed";
            stopAvailabilityPolling();
            const slotDisplay = document.getElementById("avail-confirmed-slot-display");
            if (data.confirmed_slot && slotDisplay) {
                const slot = typeof data.confirmed_slot === "string"
                    ? JSON.parse(data.confirmed_slot) : data.confirmed_slot;
                slotDisplay.textContent = `✓ ${slot.start}–${slot.end} on ${slot.date} with ${data.receiver_name || "guest"}`;
                slotDisplay.classList.remove("hidden");
                addNotification({
                    type: 'success',
                    title: 'Meeting confirmed!',
                    message: `${slot.start}–${slot.end} on ${slot.date}${data.receiver_name ? ' with ' + data.receiver_name : ''}`,
                    dismissible: true,
                    actionable: true,
                    actionLabel: 'View on calendar →',
                    actionFn: () => { if (calendarInstance) calendarInstance.gotoDate(slot.date); },
                });
            }
            document.getElementById("avail-amendment-section").classList.add("hidden");
            await loadData();
            const meetingEvent = [...(currentEvents || [])].reverse()
                .find(e => e.title === "Meeting (availability booking)");
            if (meetingEvent) {
                const eventId = meetingEvent.id;
                const slot = typeof data.confirmed_slot === "string"
                    ? JSON.parse(data.confirmed_slot) : data.confirmed_slot;
                pushHistory(
                    async () => { await fetch(`${API_URL}/events/${eventId}`, { method: "DELETE" }); await loadData(); },
                    async () => {
                        const cal = currentTimelines[0];
                        if (cal) {
                            await fetch(`${API_URL}/events/`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    title: meetingTitle,
                                    start_time: `${slot.date}T${slot.start}:00`,
                                    end_time: `${slot.date}T${slot.end}:00`,
                                    calendar_id: cal.id,
                                    reminder_minutes: 15
                                })
                            });
                            await loadData();
                        }
                    },
                    "Meeting created"
                );
            }

        } else if (data.status === "amended" && statusEl.textContent !== "Amendment proposed") {
            statusEl.textContent = "Amendment proposed";
            const amendSection = document.getElementById("avail-amendment-section");
            const amendSlotText = document.getElementById("avail-amendment-slot-text");
            if (data.amendment_slot && amendSlotText) {
                const slot = typeof data.amendment_slot === "string"
                    ? JSON.parse(data.amendment_slot) : data.amendment_slot;
                amendSlotText.textContent = `${slot.start}–${slot.end} on ${slot.date}${data.receiver_name ? " from " + data.receiver_name : ""}`;
                addNotification({
                    type: 'warning',
                    title: 'Amendment proposed',
                    message: `${slot.start}–${slot.end} on ${slot.date}${data.receiver_name ? ' from ' + data.receiver_name : ''}`,
                    dismissible: false,
                    actionable: true,
                    actionLabel: 'Review →',
                    actionFn: () => {
                        document.getElementById('availability-response-modal')?.classList.remove('hidden');
                    },
                });
            }
            if (amendSection) amendSection.classList.remove("hidden");

        } else if (data.status === "declined") {
            statusEl.textContent = "Declined";
            stopAvailabilityPolling();
            addNotification({
                type: 'error',
                title: 'Availability declined',
                message: 'Your proposed times were declined.',
                dismissible: true,
            });

        } else if (data.status === "pending" && statusEl.textContent === "Amendment proposed") {
            statusEl.textContent = "Pending";
            const amendSection = document.getElementById("avail-amendment-section");
            if (amendSection) amendSection.classList.add("hidden");
        }
    } catch (e) {
        if (indicator) indicator.textContent = "Offline";
    }
}

async function handleAmendmentResponse(token, action, counterSlot = null) {
    const body = { action };
    if (counterSlot) body.counter_slot = counterSlot;
    try {
        const res = await fetch(`${API_URL}/availability/${token}/respond-amendment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        if (!res.ok) return;
        const data = await res.json();
        const statusEl = document.getElementById("avail-status-text");
        if (statusEl) statusEl.textContent = data.status.charAt(0).toUpperCase() + data.status.slice(1);
        const amendSection = document.getElementById("avail-amendment-section");
        if (amendSection) amendSection.classList.add("hidden");
        const counterSection = document.getElementById("avail-counter-section");
        if (counterSection) counterSection.classList.add("hidden");

        if (data.status === "confirmed") {
            stopAvailabilityPolling();
            await loadData();
            const confirmedSlot = data.confirmed_slot
                ? (typeof data.confirmed_slot === "string" ? JSON.parse(data.confirmed_slot) : data.confirmed_slot)
                : counterSlot;
            const slotDisplay = document.getElementById("avail-confirmed-slot-display");
            if (confirmedSlot && slotDisplay) {
                slotDisplay.textContent = `✓ ${confirmedSlot.start}–${confirmedSlot.end} on ${confirmedSlot.date}`;
                slotDisplay.classList.remove("hidden");
            }
            addNotification({
                type: 'success',
                title: 'Meeting confirmed!',
                message: confirmedSlot
                    ? `${confirmedSlot.start}–${confirmedSlot.end} on ${confirmedSlot.date}`
                    : 'Meeting scheduled.',
                dismissible: true,
                actionable: !!confirmedSlot?.date,
                actionLabel: 'View on calendar →',
                actionFn: () => { if (calendarInstance && confirmedSlot?.date) calendarInstance.gotoDate(confirmedSlot.date); },
            });
            // Find and register undo for auto-created event
            const meetingEvent = [...(currentEvents || [])].reverse()
                .find(e => e.title === "Meeting (availability booking)");
            if (meetingEvent) {
                const eventId = meetingEvent.id;
                pushHistory(
                    async () => { await fetch(`${API_URL}/events/${eventId}`, { method: "DELETE" }); await loadData(); },
                    async () => { /* re-creation handled by re-accepting */ },
                    "Meeting created"
                );
            }
        } else if (data.status === "pending") {
            startAvailabilityPolling(token);
        }
    } catch (e) {
        console.error("Failed to respond to amendment:", e);
    }
}