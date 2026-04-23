# Changelog

## v2.0 — UI Overhaul (2026-04-23)

### Layout
- **Three-column shell** replaces the old hamburger-strip drawer: 56px persistent App Drawer rail, 260px↔48px collapsible Context Sidebar, and a flex Main Column.
- App Drawer has four destinations: Calendar, Tasks, Focus, Settings.
- Context Sidebar collapses to a 48px icon rail via the chevron button or `B` key; state persists across sessions.
- Top Bar (56px) now holds the view switcher pills (Month/Week/Day/Agenda), date nav (‹ Today ›), undo/redo, search, AI Quick-Add, sync indicator, notification bell, and settings gear.

### Calendar
- Event pills: 2px colored left border, 15% opaque background, JetBrains Mono time label.
- Today's date number wrapped in an indigo circle.
- Sidebar Timelines section gains a three-dot menu per row (rename, color, delete).
- Filters section added directly in sidebar: Has checklist, Recurring only, This week.
- Sidebar pinned footer: New Event, Send Availability, Import ICS, Parse PDF.
- Wellness warning toast repositioned to bottom-right, amber left-border card.
- Quick-Peek hover card uses the elevated background palette with a stronger shadow.

### Focus Mode (major expansion)
- Focus Mode is now a full-page **destination** (no longer a fullscreen overlay).
- **Kanban board**: Backlog / In Progress / Done columns with native HTML5 drag-and-drop.
- **List view**: tasks grouped by status; `Space` key toggles the focused row.
- **Pomodoro rail** (300px): SVG circular progress ring, phase label, pause/resume/reset, round dots, inline settings sliders (no modal), session history, active task card.
- "Focus on this" button pins a Kanban card as the Pomodoro's active task.
- Focus sidebar shows today's Up Next events + Pinned tasks.

### Task Board
- Task Board is now a full-page destination instead of a sidebar panel.
- Group by: Timeline / Due date / Priority / Status.
- Show filter: All / Incomplete / Completed / Overdue.
- Task cards show checklist progress bar tinted in the timeline color, overdue badge, linked event chip.

### Design Tokens
- Full v2.0 palette: deeper backgrounds (`#0B1120`, `#121B2E`, `#1A2540`), single indigo accent `#6366F1`.
- Inter (UI) and JetBrains Mono (times/keys) bundled locally — no CDN calls at runtime.
- CSS custom properties for all token categories: backgrounds, borders, text, radii, shadows, type scale.

### Modals
- Backdrop gains `backdrop-filter: blur(4px)`.
- Modal cards use `--bg-panel`, `--radius-2xl`, `--shadow-xl`.
- Shared utility classes: `.modal-field`, `.field-label`, `.btn-primary`, `.btn-ghost`.

### Notifications
- Panel anchors to `top: 64px; right: 16px` (below the 56px top bar).
- Notification cards: 3px left color bar (was 4px), elevated background.

### Backend
- `Task` table gains three new columns: `status` (`backlog|doing|done`), `priority` (`high|med|low`), `due_date` (ISO date). Added via idempotent `ALTER TABLE` migration on startup.

### New keyboard shortcuts
- `B` — toggle sidebar collapse (was undocumented)
- `Space` — toggle task completion in Focus List view (new)

---

## v1.5 — Notifications, Logs, Quick-Peek, Availability
*(previous release)*
