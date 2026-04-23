# LoomAssist v2.0 — Frontend Redesign Prompt for Claude Design

## Project Context

**LoomAssist** is a privacy-first, local-first desktop calendar and voice assistant for macOS (built with Tauri v2 + Vanilla JS + FullCalendar v6). All AI (Faster-Whisper STT, Ollama/Llama 3.2) runs on-device — no cloud, no telemetry. The current UI uses a dark "Slate & Indigo" theme (`--accent: #6366f1`).

I need you to design a **complete frontend wireframe redesign** (v2.0) that keeps 100% feature parity with v1.5 but dramatically improves intuitiveness, sidebar usability, and adds a powerful redesigned Focus page.

---

## Design System Requirements

- **Theme**: Dark mode primary — "Slate & Indigo"
  - `--bg-main` (deepest bg), `--bg-panel` (mid), `--bg-elevated` (raised surfaces)
  - `--accent: #6366f1` (indigo)
  - Secondary semantic colors: success green, warning amber, error red, info indigo, progress blue
- **Typography**: Clean, readable — specify a font stack (e.g., Inter / SF Pro / system-ui)
- **Density**: Balanced — not cramped, not wasteful. Should feel like Linear / Notion / Fantastical in quality.
- **Motion**: Subtle, purposeful transitions (150–250ms). No gratuitous animation.
- **Accessibility**: Keyboard-navigable, visible focus rings, ARIA roles on modals/panels, tab-trap in open overlays.
- **Responsiveness**: Desktop-first (min ~1100px), but graceful down to ~900px width.

---

## Global Layout Structure

Design a **three-zone shell**:

1. **Left: App Drawer** (slim vertical strip, ~56px wide)
   - Permanent icons for primary destinations: Calendar, Task Board, Focus Mode, Settings
   - Profile/workspace indicator at the bottom
   - Subtle hover tooltips

2. **Center-Left: Context Sidebar** (~260px, collapsible)
   - Content changes based on active destination (Calendar → timelines/filters; Focus → task queue; etc.)
   - **FIX THE CURRENT SIDEBARS**: the v1.5 sidebar is cluttered, inconsistent between views, and the hamburger-toggle behavior is janky. In v2.0:
     - One consistent collapse mechanism (smooth slide, single button at the top)
     - Clear section dividers with labels
     - Every sidebar item should have obvious hover/active states
     - Scrollable when content overflows, not clipped
     - Pinned "quick actions" area at the bottom (e.g., "+ New Event", "📅 Send Availability")

3. **Center-Right: Main Content** (remaining width)
   - Top bar (persistent): search, view switcher (where applicable), notification bell with badge, sync status indicator, settings gear
   - Main surface: calendar grid, task board, focus view, etc.

---

## Page 1: Calendar (Main Page)

This is the primary destination. It must be **more intuitive** than v1.5 while preserving **every** feature.

### Top Bar (Calendar-specific)
- View switcher: **Month | Week | Day | Agenda** (segmented control, keyboard shortcuts 1–4)
- Date navigator: ◀ [Today] ▶ + current month/year label (clickable → date-jump popover)
- Global search (with `/` shortcut) — searches events, descriptions, timelines
- AI Quick-Add bar (voice mic icon + text field) — natural language → event
- Notification bell (badge with unread count, "9+" cap)
- Sync status dot (live timestamp on hover)

### Context Sidebar (Calendar mode)
Sections, top to bottom:
1. **Timelines** (with color swatches, checkboxes to show/hide, inline rename on double-click, color picker)
2. **Filters** (date range, timeline, recurring-only, has-tasks, etc.)
3. **Event Templates** (saved templates, click to start a new event pre-filled)
4. **Quick Actions** (pinned at bottom): `+ New Event`, `📅 Send Availability`, `📥 Import ICS`, `📄 Parse Syllabus`

### Main Surface
- FullCalendar grid (Month/Week/Day/Agenda)
- Scroll-wheel zoom support (indicator/affordance)
- Drag-and-drop rescheduling, edge-resize for duration
- Multi-select via drag-across or shift-click
- **Quick-Peek hover card** (150ms debounce): title, time range, timeline chip, rendered description (markdown), checklist preview with ✓/○
- Keyboard shortcuts shown in a discoverable `?` popover

### Modals to wireframe
- **Event Editor** (create/edit) — title, start/end, all-day toggle, timeline, recurrence builder (weekly, per-day times, end date, skip dates), description (markdown), reminder, checklist, occurrence-specific notes for recurring
- **Availability Sender** — mini calendar date-picker (multi-select dates), per-date time-window builder, duration, sender name, generated share URL with copy button, live polling indicator
- **Availability Response** — recipient's choice shown, accept/decline/counter-propose UI
- **Settings** — theme, crash reporting toggle, log viewer (export last 500, clear), DB backup/restore, timezone
- **Daily Agenda Overlay** (optional on startup) — today's events in a scrollable card list

---

## Page 2: Focus Mode (Heavily Redesigned)

This is the **biggest change** in v2.0. The Focus page becomes a productivity hub, not just a Pomodoro timer.

### Layout
Split into **three zones**:

**Left sidebar (Focus-context)**:
- Today's schedule (next 3–5 upcoming events as cards)
- Pinned-as-task events from Task Board
- Toggle: "Show only incomplete tasks"

**Center (primary zone)** — this is where the task list lives, with a **display-mode toggle** at the top:

#### Display Mode 1: **Kanban Board**
- Columns: **Backlog | In Progress | Done** (user can rename columns; allow 3–5 columns total)
- Task cards show: title, linked-event chip (if any), due date, priority dot
- **Two ways to move a task between columns**:
  1. **Drag-and-drop** (smooth, with drop-zone highlight)
  2. **Click the card** → dropdown menu appears: "Move to → [Backlog / In Progress / Done]"
     - Also includes: "Edit", "Delete", "Pin to sidebar"
- "+ Add task" button at the top of each column (inline input)
- Empty-column placeholder illustration

#### Display Mode 2: **Checklist / List View**
- Flat vertical list of tasks grouped by status (collapsible groups)
- Each row: **clickable checkbox** (hover shows a filled preview), task title, linked event, due date, priority
- Inline edit on click, delete via row hover action
- Keyboard: `Space` toggles checkbox, arrows navigate, `Enter` edits
- "+ Add task" row at the top

The **display-mode toggle** is a segmented control: `[Kanban] [List]` — state persists per-user.

**Right zone (Pomodoro & Clock)**:
- Large running clock at top (current time, subtle)
- **Editable Pomodoro Timer**:
  - Big circular progress ring
  - Centered: remaining time (MM:SS)
  - Start / Pause / Reset buttons
  - **Settings gear** opens an inline editor for:
    - Work interval (default 25 min, editable 5–90)
    - Short break (default 5 min, editable 1–30)
    - Long break (default 15 min, editable 5–60)
    - Rounds before long break (default 4)
    - Sound on/off, desktop notification on/off
  - Session counter below ring (e.g., "Round 2 of 4")
- Active task indicator: "Currently focusing on: [task title]" (clickable → jumps to task)
- Session history (collapsible): list of completed pomodoros today

### Main Focus view toggle (top of page)
- `[Normal] [Fullscreen]` — fullscreen hides all chrome except the center zone and timer

---

## Page 3: Task Board (Standalone)

Separate from Focus — this is the **curation** view where users pin events as tasks.

- Grid or list view of pinned tasks
- Group-by: Timeline | Due Date | Priority | Status
- Filter: completed / incomplete / overdue
- Each card: title, linked event (clickable to jump to calendar), progress bar (if checklist), note field

---

## Notifications Panel

Keep the v1.5 spec:
- Bell icon in top bar, unread badge
- Slide-in panel from the right
- Notification card types: info / success / warning / error / progress (with shimmer)
- Dismissible, actionable (with button), auto-dismiss option
- Escape closes panel, tab-trap when open

---

## Modals & Overlays — General Pattern

- Backdrop blur (subtle), centered card
- Close: X button, Escape key, backdrop click
- Primary action button right-aligned in footer, secondary/cancel to its left
- Form fields with clear labels above, helper text below
- Error states in red below the offending field

---

## Features That Must Be Visible Somewhere

Checklist — the wireframe must account for access to all of these:

- Voice-to-event (mic button in top bar + dedicated modal)
- AI quick-add search
- Month/Week/Day/Agenda views
- Scroll-wheel zoom
- Recurring events (complex builder)
- Per-day times, skip dates, occurrence-specific notes
- Drag-to-reschedule, edge-resize
- Multi-select + bulk delete
- Quick-Peek hover card
- Availability link sender + recipient response + amendment negotiation
- In-app notifications (bell + panel)
- Per-event task checklists
- Task Board
- Focus Mode (Pomodoro + clock + task list)
- Wellness warnings (over-scheduled day alert)
- Usage statistics (per-timeline hours, busiest day, monthly counts)
- Daily Agenda Overlay (startup)
- Bulk ICS import
- Syllabus/PDF parsing
- Timeline export (JSON/ICS)
- Global Undo/Redo (toast + keyboard)
- DB backup/restore
- Timezone picker
- Sidebar collapse/expand
- App Drawer navigation
- Markdown + @mentions in descriptions
- Event templates
- Timeline color picker + inline rename
- Print Week view
- Sync status indicator
- Settings (theme, crash reporting, log viewer)
- Keyboard shortcut discoverability (? popover)

---

## Keyboard Shortcuts (must be surfaced)

| Key | Action |
|-----|--------|
| `N` | New event |
| `T` | Today |
| `1–4` | Switch views |
| `F` | Focus Mode |
| `/` | Search |
| `Esc` | Close modal/panel |
| `Delete`/`Backspace` | Bulk delete |
| `Ctrl+Z` / `Shift+Z` | Undo/Redo |
| `Space` | (Focus List mode) toggle checkbox |
| `?` | Show shortcut reference |

---

## Deliverables I Want From You

1. **Annotated wireframe** (low-to-mid fidelity) for each page/state:
   - Calendar (Month view is enough to show the pattern)
   - Focus Mode — both Kanban and List display modes, plus Pomodoro editor open
   - Task Board
   - At least 2 key modals (Event Editor, Availability Sender)
   - Notification panel open state
   - Sidebar collapsed vs. expanded

2. **Component callouts** explaining interaction behavior (hover, click, drag, keyboard)

3. **Design tokens summary** — colors, spacing scale, type scale, radius scale, shadow scale

4. **Sidebar redesign rationale** — explain what was wrong with v1.5 and how your design fixes it

5. **Interaction notes** for the Focus page Kanban (drag vs. click-to-move dropdown) and Pomodoro editor (how the inline settings panel appears and validates)

---

## Tone & Inspiration

Think: **Linear's polish + Fantastical's calendar clarity + Things 3's focus on tasks + Notion's flexibility**. Calm, confident, keyboard-first, privacy-respecting. No AI-generic gradients or sparkle emojis. Indigo accent used sparingly for emphasis — most UI is greyscale and lets the accent punch through where it matters.
