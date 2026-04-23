# LoomAssist React Migration Plan

Branch: `v2.0-react`  
Safety net: `legacy-vanilla` (full v2.0 vanilla JS frontend preserved)  
Backend: unchanged — FastAPI on `localhost:8000`

---

## Section A — Feature Parity Checklist

Tick each item before the Phase 9 cutover is considered complete.

### Voice & Intent
- [ ] Voice-to-event via Faster-Whisper + Ollama (POST `/transcribe`, POST `/intent`)
- [ ] AI Quick-Add mic button in top bar
- [ ] Natural language event creation

### Calendar & Events
- [ ] FullCalendar grid — Month, Week, Day, Agenda views (`dayGridMonth`, `timeGridWeek`, `timeGridDay`, `listWeek`)
- [ ] Scroll-wheel zoom on calendar
- [ ] Advanced recurring events (per-day times, weekday selector, end date)
- [ ] All-day event support (date pickers, `is_all_day`)
- [ ] Occurrence-specific notes on recurring events (`unique_description`)
- [ ] Skip individual recurring instances (`POST /events/{id}/skip-date`, `skipped_dates`)
- [ ] Drag-and-drop rescheduling (`eventDrop`)
- [ ] Drag-to-resize (`eventResize`)
- [ ] Multi-select and bulk delete (`selectedEventIds` Set, Delete/Backspace key)
- [ ] Quick-Peek hover card (150ms debounce, clamped to viewport, markdown description)
- [ ] ICS duplicate prevention (`external_uid`)

### Notifications
- [ ] Bell-icon panel (top bar, top-right anchored, backdrop, tab-trap, Escape closes)
- [ ] Unread badge (shows 9+ when > 9)
- [ ] Types: info / success / warning / error / progress
- [ ] Progress bar with shimmer animation
- [ ] Actionable notifications with click callbacks
- [ ] Auto-dismiss with configurable delay
- [ ] Keyboard accessible (tab-trap, Escape)

### Appointment Scheduling
- [ ] Create availability link with selected date/time slots (mini-calendar picker, per-day time windows)
- [ ] Conflict warning when slots overlap existing events
- [ ] Share link display + copy button
- [ ] Status flow: `pending` → `confirmed` / `amended` / `declined`
- [ ] Polling for response status every 10s (stops on confirm/decline/expire)
- [ ] Amendment negotiation: counter-propose, accept/decline
- [ ] Confirmed slot auto-creates locked calendar event
- [ ] 410 Gone / link expiry handling

### Logging & Crash Recovery
- [ ] Frontend logger: 200-entry queue, 10s flush, immediate flush on error (POST `/api/logs`)
- [ ] `window.onerror` / `window.onunhandledrejection` captured by logger
- [ ] Crash recovery: check `GET /api/logs/crash-flag` on boot, show notification
- [ ] Tauri `rust-panic` event listener wired in `App.tsx`
- [ ] Settings: export logs (GET `/api/logs/export`), clear logs (DELETE `/api/logs`)
- [ ] Crash reports toggle persisted to localStorage (`loom_crash_reports_enabled`)

### Tasks & Productivity
- [ ] Per-event checklist (JSON column, inline add/check/delete in event modal)
- [ ] Task Board: group by timeline / due / priority / status; show filters
- [ ] Focus Mode: Kanban (3 columns) + List view toggle
- [ ] Kanban card drag-and-drop (native HTML5, no library)
- [ ] One active "Focusing" task at a time (indigo outline + chip)
- [ ] Pomodoro rail (300px): work/break timer, SVG ring, session history
- [ ] Pomodoro settings expand inline (no modal)
- [ ] Focus Mode fullscreen (F key + toggle button)
- [ ] Pinned tasks in Focus sidebar (persisted in localStorage)
- [ ] Wellness warnings (POST `/schedule/analyze`, amber toast)
- [ ] Statistics panel (hours per timeline, busiest day, monthly counts)
- [ ] Daily Agenda Overlay on startup (auto-dismiss 8s, toggle in Settings)

### Data Management
- [ ] ICS import: file picker, timeline selector, duplicate prevention, progress notification, undo
- [ ] Syllabus/PDF parsing: progress notification, approval panel (edit + select timeline)
- [ ] Timeline export (JSON / ICS, GET `/export/timelines/`)
- [ ] Global Undo/Redo (50-step, every mutating action)
- [ ] Database backup (POST `/admin/backup`) and restore (POST `/admin/restore`)
- [ ] Timezone handling (`timezone` field, default `'local'`)

### UI & Navigation
- [ ] Three-column shell: 56px AppDrawer + 260px↔48px sidebar + main column
- [ ] Four destinations: Calendar, Tasks, Focus, Settings (AppDrawer)
- [ ] Sidebar collapse/expand (`B` key, chevron button, persisted to localStorage as `loom:sidebar:collapsed`)
- [ ] Per-destination sidebar content (CalendarSidebar / FocusSidebar / TaskBoardSidebar / SettingsSidebar)
- [ ] Top Bar: view switcher pills, date nav, search, AI mic, sync indicator, bell, settings
- [ ] Sync status indicator (30s interval, "just now" / "X min ago", red on failure)
- [ ] Smart search (sidebar switches to search results panel)
- [ ] Event templates (save, reuse, sidebar panel)
- [ ] Timeline color picker
- [ ] Timeline inline rename (double-click)
- [ ] Print Week view
- [ ] Markdown + @mention rendering in descriptions
- [ ] Theme toggle (light/dark, localStorage `loom-theme`, `light-mode` class on `<body>`)
- [ ] Onboarding modal (3-step, shown once, localStorage `loom-onboarded`)

### Keyboard Shortcuts
- [ ] `N` — New event
- [ ] `T` — Jump to today
- [ ] `1–4` — Switch views
- [ ] `[` / `]` — Previous / next period
- [ ] `B` — Toggle sidebar collapse
- [ ] `F` — Navigate to Focus Mode
- [ ] `/` — Focus search
- [ ] `Esc` — Close modal / notification panel
- [ ] `Delete` / `Backspace` — Bulk delete selected events
- [ ] `Ctrl+Z` / `Shift+Z` — Undo / Redo
- [ ] `Space` — Toggle task completion (Focus List view)
- [ ] All shortcuts blocked when `document.activeElement` is input / textarea / contenteditable

---

## Section B — Wireframe Component → React Component Mapping

| Wireframe Component | Source File | React Target |
|---|---|---|
| `LA_TOKENS` | `shared.jsx` | `src/styles/tokens.css` (CSS custom properties on `:root`) |
| `Icon`, `Icons` | `shared.jsx` | `src/components/shared/Icon.tsx` |
| `Kbd` | `shared.jsx` | `src/components/shared/Kbd.tsx` |
| `Chip` | `shared.jsx` | `src/components/shared/Chip.tsx` |
| `TLDot` | `shared.jsx` | `src/components/shared/TLDot.tsx` |
| `AppDrawer` | `shared.jsx` | `src/components/shared/AppDrawer.tsx` — 56px nav rail |
| `TopBar` | `shared.jsx` | `src/components/shared/TopBar.tsx` — 56px fixed header |
| `SectionLabel` | `shared.jsx` | `src/components/shared/SectionLabel.tsx` |
| `CalendarSidebar` | `calendar.jsx` | `src/components/calendar/CalendarSidebar.tsx` |
| `MonthGrid` | `calendar.jsx` | **Replaced by `<FullCalendar>`** — static wireframe grid is wireframe-only |
| `EventPill` | `calendar.jsx` | FullCalendar `eventContent` render prop inside `CalendarPage.tsx` |
| `QuickPeek` | `calendar.jsx` | `src/components/calendar/QuickPeek.tsx` |
| `CalendarPage` | `calendar.jsx` | `src/pages/CalendarPage.tsx` |
| `FocusSidebar` | `focus.jsx` | `src/components/focus/FocusSidebar.tsx` |
| `KanbanBoard`, `KanbanCard` | `focus.jsx` | `src/components/focus/KanbanBoard.tsx` |
| `ListView` | `focus.jsx` | `src/components/focus/ListView.tsx` |
| `PomodoroPanel` | `focus.jsx` | `src/components/focus/PomodoroPanel.tsx` |
| `FocusPage` | `focus.jsx` | `src/pages/FocusPage.tsx` |
| `TaskBoardPage`, `TaskCard` | `pages-modals.jsx` | `src/pages/TaskBoardPage.tsx` |
| `EventEditorModal` | `pages-modals.jsx` | `src/components/modals/EventEditorModal.tsx` |
| `AvailabilityModal` | `pages-modals.jsx` | `src/components/modals/AvailabilityModal.tsx` |
| `NotifCard` | `pages-modals.jsx` | `src/components/NotifPanel.tsx` |
| `NotificationPanelArtboard` | `pages-modals.jsx` | `src/store/notifications.tsx` + `src/components/NotifPanel.tsx` |
| `ModalShell`, `ModalFooter`, `FieldLabel` | `pages-modals.jsx` | `src/components/modals/ModalShell.tsx` |
| `DesignTokensArtboard` | `pages-modals.jsx` | Design reference only — not a page |
| `SidebarRationaleArtboard` | `pages-modals.jsx` | Design spec only — not a page |
| `design-canvas.jsx` | — | Figma wrapper — ignore entirely |

---

## Section C — Backend Endpoints

All calls go through `src/api.ts` (`const BASE = 'http://localhost:8000'`). No fetch calls elsewhere.

### Events
```
GET    /events/
POST   /events/
PUT    /events/{id}
DELETE /events/{id}
POST   /events/{id}/skip-date
```

### Calendars (Timelines)
```
GET    /calendars/
POST   /calendars/
PUT    /calendars/{id}
DELETE /calendars/{id}
```

### Tasks
```
GET    /tasks/
POST   /tasks/
PUT    /tasks/{id}
DELETE /tasks/{id}
```

### Templates
```
GET    /templates/
POST   /templates/
DELETE /templates/{id}
```

### Availability
```
POST   /availability
GET    /availability/{token}
POST   /availability/{token}/confirm
POST   /availability/{token}/amend
POST   /availability/{token}/respond-amendment
```

### Import / Export
```
POST   /integrations/import-ics-file/
GET    /export/timelines/
POST   /documents/extract-syllabus/
POST   /documents/save-approved-events/
```

### AI / Voice
```
POST   /transcribe
POST   /intent
```

### Analytics
```
POST   /schedule/analyze
```

### Logging
```
POST   /api/logs
GET    /api/logs/crash-flag
GET    /api/logs/export
DELETE /api/logs
```

### Admin
```
POST   /admin/backup
POST   /admin/restore
```

---

## Section D — Undocumented Behaviors (main.js → must preserve)

Behaviors found in `main.js` that are not documented in `CLAUDE_CONTEXT.md`:

1. **Conflict detection + double-confirm** — First save attempt shows a conflict warning; the button text stays the same but a warning message appears. User must click save again to confirm. Preserve this in `EventEditorModal`.

2. **ICS undo clones the File object** — The undo entry stores `new File([file], name, type)` rather than the original File reference, to prevent "file no longer available" errors on redo. Preserve in the undo reducer.

3. **Availability polling rate is 10 seconds** — Not documented. The `useAvailabilityPolling(token)` hook must poll every 10s.

4. **Reminder catch-up window is 60 seconds** — On load, reminders older than 60 seconds are skipped (prevents notification spam after tab sleep/reopen). Preserve in reminder scheduling logic.

5. **Per-day times silent fallback** — Malformed `per_day_times` JSON leaves the toggle unchecked silently (no error thrown). Preserve this quiet fallback.

6. **Theme toggle** — localStorage key `loom-theme`; adds `light-mode` class to `<body>`. Not listed as a feature in `CLAUDE_CONTEXT.md` but present in Settings modal in vanilla code.

7. **Daily Agenda auto-dismiss at 8 seconds** — Modal auto-closes after 8s. Shown only on first load (guard: `!firstLoadDone`).

8. **Sidebar modes (7 states)** — Vanilla sidebar switches between `normal`, `search`, `approval`, `templates`, `taskboard`, `stats`, `export` panels. In React, these become route-based sidebar content plus a `sidebarPanel` state for overlay panels (`search`, `approval`, `stats`, `export`).

9. **Sync indicator interval is 30 seconds** — `updateSyncTimeDisplay()` runs every 30s. React: `useEffect` with `setInterval(30_000)`.

10. **Pinned tasks localStorage key** — Key `PINNED_TASKS_KEY` (value: `'loom:focus:pinned'`) stores a JSON array of task IDs. Used by FocusSidebar "Pinned tasks" section.

11. **CustomEvents replaced by React Router** — `loom:navigate` → `navigate()`, `loom:view-change` / `loom:date-nav` → callback props / context.

---

## Pre-Phase-1 Notes

- **Task schema already complete**: `status`, `priority`, `due_date` columns exist in the DB (added in v2.0 migration via `run_migrations()` in `database.py`). The Phase 7 schema decision loop from the migration doc is resolved — wire Kanban directly to the backend from day one.
- **Fonts already bundled**: Inter + JetBrains Mono woff2 files in `frontend-ui/src/assets/fonts/`. Copy to `react-src/src/styles/fonts/` in Phase 1.
- **Tauri config change (Phase 9 only)**: `frontendDist: "../src"` → `"../react-src/dist"`, add `devUrl: "http://localhost:5173"`.
- **FullCalendar**: Currently CDN in vanilla. Install `@fullcalendar/react` + adapter packages via npm in Phase 1.
- **React app lives in** `frontend-ui/react-src/` until Phase 9 cutover moves it to `frontend-ui/src/`.
