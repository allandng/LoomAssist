# LoomAssist v2.0 Migration Notes
## Regression Checklist

This document was produced at the start of the v2.0 UI overhaul (Phase 0).
Use it as a tick-sheet at every phase commit and again during the Phase 8 final sweep.

---

## 1. Top-Level DOM Regions (index.html)

| Region | Selector / ID | v2.0 fate |
|--------|--------------|-----------|
| App Drawer | `#app-drawer` (12px strip + 188px slide panel) | → replaced by persistent 56px `appDrawer.js` rail |
| App Layout wrapper | `.app-layout` | → replaced by `.app-shell` |
| Sidebar | `.sidebar` (260px) | → replaced by `.context-sidebar` (260px ↔ 48px, per-destination content) |
| Main Content | `.main-content` | → becomes inner div of `.main-column` |
| Top Bar | `header.top-bar` | → rebuilt by `topBar.js` |
| Schedule Warnings | `#schedule-warnings` | → restyled (amber card, bottom-right), logic unchanged |
| Calendar Container | `#calendar-container` | → moved into `#main-content` |
| Calendar Empty Overlay | `#calendar-empty-overlay` | → preserved |
| Focus Overlay | `#focus-overlay` | → replaced by Kanban+List+Pomodoro page (dest=focus) |
| FAB Container | `.fab-container` / `#settings-btn` | → gear moves into top bar right cluster |
| Mention Dropdown | `#mention-dropdown` | → preserved |
| Event Tooltip | `#event-tooltip` | → restyled only (Quick-Peek) |
| Hidden File Inputs | `#import-file-input`, `#restore-file-input` | → preserved |

---

## 2. All Modals (must open/close correctly after every phase)

| Modal ID | Trigger | Notes |
|----------|---------|-------|
| `#consent-modal` | Mic button | Recording consent |
| `#timeline-modal` | "Add Timeline" | Create / rename timeline |
| `#event-modal` | N key, click, drag-select | Full event editor |
| `#ics-import-modal` | Import ICS button | Timeline select + confirm |
| `#settings-modal` | Gear button / `#settings-btn` | Settings + diagnostics |
| `#onboarding-modal` | First launch / Settings → Replay | 3-step wizard |
| `#availability-modal` | Availability button / 📅 icon | Send availability (mini cal + time windows) |
| `#availability-response-modal` | After link is sent | Status + amendment flow |
| `#crash-modal` | Crash flag on startup | Export logs prompt |

---

## 3. Sidebar Panels (v1.5 — all content moves to per-destination sidebar in v2.0)

| Panel ID | Shown when | v2.0 home |
|----------|-----------|-----------|
| `#timeline-list` (inside `.sidebar`) | Always | Calendar sidebar — Timelines section |
| `#sidebar-search-results` | Search term entered | Top bar search pill results |
| `#sidebar-approval-panel` | After PDF/ICS parse | Calendar sidebar or main content area |
| `#sidebar-stats-panel` | Menu → Statistics | Calendar sidebar stats section |
| `#sidebar-export-panel` | Menu → Export Timeline | Calendar sidebar + quick action |
| `#sidebar-templates-panel` | Menu → Templates | Calendar sidebar — Templates section |
| `#sidebar-taskboard-panel` | Menu → Task Board | → full-page Task Board destination |

---

## 4. Keyboard Shortcuts (all must work after Phase 8)

| Key | Action | Handler location |
|-----|--------|-----------------|
| `N` | New Event | `setupEventListeners` keydown |
| `T` | Today | `setupEventListeners` keydown |
| `1` | Month view | `setupEventListeners` keydown |
| `2` | Week view | `setupEventListeners` keydown |
| `3` | Day view | `setupEventListeners` keydown |
| `4` | List/Agenda view | `setupEventListeners` keydown |
| `[` | Previous period | `setupEventListeners` keydown |
| `]` | Next period | `setupEventListeners` keydown |
| `B` | Toggle sidebar | `setupEventListeners` keydown → `contextSidebar.toggle()` in v2 |
| `/` | Focus search | `setupEventListeners` keydown |
| `F` | Focus Mode | `setupEventListeners` keydown |
| `Esc` | Close modal / panel / mention-dropdown | Multiple handlers |
| `Delete` / `Backspace` | Bulk delete selected events | `setupEventListeners` keydown |
| `Ctrl+Z` / `Cmd+Z` | Undo | `setupEventListeners` keydown |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo | `setupEventListeners` keydown |
| `Space` *(NEW v2.0)* | Toggle focused task row in List view | Focus Mode list view handler |

---

## 5. Global State Variables (never delete, must remain accessible after all phases)

| Variable | Type | Purpose |
|----------|------|---------|
| `calendarInstance` | FullCalendar | Calendar API handle |
| `currentEvents` | Array | Raw event objects from backend |
| `currentTimelines` | Array | Calendar/timeline objects |
| `currentTasks` | Array | Task Board items |
| `currentChecklist` | Array | In-modal checklist for open event |
| `currentTaskFilter` | string | Task Board active filter |
| `undoStack` | Array | Undo history (max 50) |
| `redoStack` | Array | Redo history |
| `selectedEventIds` | Set | Multi-selected event IDs |
| `tooltipTimer` | number | Debounce timer for Quick-Peek |
| `focusIntervals` | Array | All setInterval IDs from focus mode |
| `focusMode` | string | `'session'` \| `'pomodoro'` |
| `focusStartTime` | number | Epoch ms session start |
| `pomodoroSecondsLeft` | number | Countdown state |
| `availabilitySelectedDays` | Set | Date strings selected in availability modal |
| `availabilityPollingId` | number | setInterval ID for availability polling |
| `availabilityCurrentToken` | string | In-flight availability token |
| `lastSyncTime` | Date | Last successful sync timestamp |
| `syncIntervalId` | number | 30s relative-time refresh interval |
| `syncState` | string | `'ok'` \| `'failed'` |
| `activeReminders` | Object | Scheduled reminder timeouts |
| `drawerOpen` | bool | App drawer open state |
| `sidebarMode` | string | `'normal'` \| `'search'` \| `'approval'` \| `'export'` |
| `analyzeDebounceTimer` | number | Wellness analysis debounce |
| `firstLoadDone` | bool | Guard for daily agenda first-show |
| `agendaTimeout` | number | Daily agenda auto-dismiss timer |
| `pendingTimelineSelect` | any | Pending timeline during import approval |

---

## 6. Key Functions to Preserve (must not be deleted or silently broken)

| Function | Phase risk |
|----------|-----------|
| `loadData()` | Always — fetches /api/timelines + /api/events |
| `renderSidebar(timelines)` | Phase 2/3 — will be refactored into per-destination sidebar |
| `renderCalendarEvents(searchTerm)` | Phase 3 |
| `openEventModal(existingEvent, clickedDate, instanceDate)` | Phase 4 |
| `skipOccurrence(eventId, instanceDate)` | Phase 4 (modal) |
| `updatePerDayGrid()` + `serializePerDayTimes()` | Phase 4 (modal) |
| `renderChecklist()` | Phase 4 (modal) |
| `checkForConflicts()` | Phase 4 (modal) |
| `openAvailabilityModal()` | Phase 4 |
| `renderMiniCalendar()` | Phase 4 |
| `toggleDaySelection()` | Phase 4 |
| `sendAvailability()` | Phase 4 |
| `startAvailabilityPolling(token)` | Phase 4 |
| `pollAvailabilityStatus(token)` | Phase 4 |
| `handleAmendmentResponse()` | Phase 4 |
| `submitQuickAdd(text)` | Phase 2/3 (top bar AI pill) |
| `openFocusMode()` | Phase 6 — replaces current overlay |
| `closeFocusMode()` | Phase 6 |
| `openSidebarTaskboard()` + `renderTaskBoard()` | Phase 7 |
| `bulkDeleteSelected()` | Phase 3 |
| `pushHistory()` / `performUndo()` / `performRedo()` | Always |
| `updateSyncStatus(state)` | Phase 2/5 (top bar) |
| `runScheduleAnalysis()` | Phase 3 |
| `showScheduleWarnings(warnings)` | Phase 3 |
| `initAppDrawer()` | Phase 2 — will be replaced by `appDrawer.js` |
| `scheduleReminders()` | Always |
| `showDailyAgenda()` | Phase 2/3 |
| `openStatsPanel()` | Phase 3 (calendar sidebar) |
| `openSidebarTemplates()` + `applyTemplate()` | Phase 3 (calendar sidebar) |
| `openSidebarExport()` | Phase 3 (calendar sidebar) |
| `openSidebarApproval()` | Phase 3 (calendar sidebar) |
| `renderDescription(text)` | Phase 3/4 (event pills, tooltip, modal) |
| `positionTooltip(cx, cy)` | Phase 3 (Quick-Peek) |
| `toggleDescMode(isEdit)` | Phase 4 (modal) |
| `handleMentions(e)` | Phase 4 (modal description) |

---

## 7. Backend API Calls (must all still work)

| Method | Endpoint | Used by |
|--------|----------|---------|
| GET | `/api/logs/crash-flag` | Startup crash check |
| POST | `/api/logs` | Logger flush |
| GET | `/api/logs/export` | Settings → View Logs |
| DELETE | `/api/logs` | Settings → Clear |
| GET | `/calendars/` | loadData |
| POST | `/calendars/` | New timeline |
| PUT | `/calendars/{id}` | Rename / color change |
| DELETE | `/calendars/{id}` | Delete timeline |
| GET | `/events/` | loadData |
| POST | `/events/` | Create event |
| PUT | `/events/{id}` | Update event, drag/resize |
| DELETE | `/events/{id}` | Delete event |
| POST | `/events/{id}/skip-date` | Skip occurrence |
| DELETE | `/events/{id}/skip-date` | Unskip occurrence |
| POST | `/integrations/import-ics-file/` | ICS import |
| GET | `/export/timelines/` | Export |
| POST | `/documents/extract-syllabus/` | PDF parse |
| POST | `/documents/save-approved-events/` | Save parsed events |
| GET | `/admin/backup` | DB backup |
| POST | `/admin/restore` | DB restore |
| POST | `/intent` | Quick-add text |
| POST | `/transcribe` | Voice command |
| GET | `/templates/` | Load templates |
| POST | `/templates/` | Save template |
| DELETE | `/templates/{id}` | Delete template |
| POST | `/schedule/analyze` | Wellness analysis |
| GET | `/tasks/` | Load tasks |
| POST | `/tasks/` | Create task |
| PUT | `/tasks/{id}` | Update task |
| DELETE | `/tasks/{id}` | Delete task |
| POST | `/availability` | Send availability |
| GET | `/availability/{token}` | Poll status |
| POST | `/availability/{token}/confirm` | Confirm slot |
| POST | `/availability/{token}/amend` | Propose amendment |
| POST | `/availability/{token}/respond-amendment` | Accept/decline/counter |

---

## 8. Phase-by-Phase Regression Checklist

### After Phase 1 (design tokens)
- [ ] App launches without console errors
- [ ] Color palette is visibly darker/more saturated than v1.5
- [ ] All modals still open/close
- [ ] Calendar still loads events

### After Phase 2 (shell layout)
- [ ] Three-column layout renders (56px drawer, collapsible sidebar, main column)
- [ ] App Drawer shows Calendar/Tasks/Focus/Settings icons
- [ ] Clicking Calendar/Tasks/Focus switches destination
- [ ] `B` key toggles sidebar
- [ ] Sidebar collapse state survives page reload (localStorage)

### After Phase 3 (calendar)
- [ ] Month/Week/Day/Agenda views switch correctly
- [ ] Date nav (‹ Today ›) works
- [ ] Events load and display with timeline colors
- [ ] Today date shows indigo circle
- [ ] Drag-and-drop rescheduling works
- [ ] Drag-resize works
- [ ] Single-click selects event, double-click opens modal
- [ ] Multi-select + bulk delete works
- [ ] Quick-Peek hover card shows on mouse-over (150ms delay)
- [ ] Quick-Peek shows title, time, description, checklist
- [ ] Wellness warning appears for over-scheduled days
- [ ] Timeline filter checkboxes show/hide events
- [ ] "Has checklist" / "Recurring only" / "This week" filters work
- [ ] Templates section shows saved templates + apply works
- [ ] Pinned footer: New Event / Availability / Import ICS / Parse PDF all trigger

### After Phase 4 (modals)
- [ ] Event modal: create new event
- [ ] Event modal: edit existing event
- [ ] Event modal: all-day toggle shows/hides datetime pickers
- [ ] Event modal: recurring event — day checkboxes + end date
- [ ] Event modal: per-day times toggle
- [ ] Event modal: checklist add/remove/toggle
- [ ] Event modal: description with @mention autocomplete
- [ ] Event modal: Skip Date on recurring instance
- [ ] Event modal: Save as Template
- [ ] Event modal: Duplicate event
- [ ] Event modal: locked description for availability-created events
- [ ] Availability modal: date selection, time windows, send link
- [ ] Availability response modal: polling, amendment flow, counter-proposal
- [ ] Settings modal: all toggles functional, DB backup/restore, logs
- [ ] ICS import modal: timeline select + import
- [ ] Onboarding modal: 3 steps, previous/next

### After Phase 5 (notifications)
- [ ] Bell icon visible in top bar
- [ ] Clicking bell opens panel
- [ ] Panel shows existing notifications
- [ ] Notification types (info/success/warning/error/progress) all render with correct color bar
- [ ] Progress shimmer animates
- [ ] Actionable notifications clickable
- [ ] `Esc` closes panel
- [ ] Tab-trap works in open panel
- [ ] Unread badge updates correctly

### After Phase 6 (focus mode)
- [ ] `F` key opens Focus Mode destination
- [ ] Kanban shows Backlog / In Progress / Done columns
- [ ] Cards show priority dot, timeline chip, due date
- [ ] Dragging card to a column updates status via PUT /tasks/{id}
- [ ] Click card → context menu (Move to / Edit / Pin / Delete)
- [ ] List view toggle shows same data grouped by status
- [ ] `Space` key on focused row toggles is_complete
- [ ] Pomodoro ring counts down
- [ ] Pause / Resume / Reset work
- [ ] Pomodoro settings expand inline in rail (no modal)
- [ ] "Focus on this" sets active task in Pomodoro rail
- [ ] Session history records completed sessions
- [ ] Focus sidebar shows today's events + pinned tasks
- [ ] "Only incomplete" filter in focus sidebar works

### After Phase 7 (task board)
- [ ] Task Board destination shows tasks grouped by timeline
- [ ] Group-by (Timeline / Due / Priority / Status) changes layout
- [ ] Show filter (All / Incomplete / Completed / Overdue) filters correctly
- [ ] Task card checkbox toggles completion via PUT /tasks/{id}
- [ ] Linked event chip opens event modal
- [ ] Checklist progress bar shows correct ratio

### After Phase 8 (final sweep)
- [ ] All above checks pass
- [ ] Window size 1024×700 — no overflow, calendar usable
- [ ] Fullscreen — layout fills correctly
- [ ] Logger POSTs to /api/logs every 10s
- [ ] Crash flag check fires on startup
- [ ] CLAUDE_CONTEXT.md updated to v2.0
- [ ] CHANGELOG.md has ## v2.0 entry

---

*Generated: Phase 0, v2.0-ui-overhaul branch*
