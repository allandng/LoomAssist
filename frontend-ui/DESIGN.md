# LoomAssist UI — design brief (v3 redesign)

This is the contract every page and component follows. Read it fully before
touching a `.tsx` or `.module.css` file. Source root: `frontend-ui/src/src/`.

## 1. Direction

LoomAssist is a **calm, precise, local-first planner** for students and
developers. The reference set (Mobbin research, September 2026) was Amie,
Rise, Motion, Proton Calendar, Superlist, Linear, Asana, Todoist, Cal.com,
Toggl. What they share, and what we adopt:

- **Neutral surfaces, one accent.** Graphite darks / paper lights. The
  indigo accent marks the *one* primary action per surface and selection
  state. Timeline colors carry hue on events; nothing else competes.
- **Labeled navigation.** A left sidebar with icon + label (collapsible to an
  icon rail), grouped, with ⌘K search and a "New event" button at the top and
  account + sync at the bottom.
- **Big date, quiet chrome.** Calendar header = large date title, Today +
  chevrons, a segmented view switcher. No decorative gradients.
- **Edit beside, not over.** Event editing happens in a right-side sheet so the
  grid stays visible. Modals are reserved for short, focused flows.
- **Cards for dashboards; rows for settings; lists for everything else.**
- **Every empty state teaches.** Icon, one-line title, one-line description,
  a primary CTA, and the keyboard hint.
- **Every destructive action confirms** through the shared dialog, never
  `window.confirm` / `window.prompt`.
- **Feedback is visible where you are.** Success/error/undo render as toasts
  bottom-right; the bell keeps history.

## 2. Tokens (`styles/tokens.css`) — the only allowed values

Never write a literal color, font size, radius, shadow or duration in a
module. If a value you want isn't on a scale, pick the nearest token.

| Need | Token |
|---|---|
| Window / canvas / panel / popover / chip fill / well | `--bg-app` `--bg-main` `--bg-panel` `--bg-elevated` `--bg-subtle` `--bg-inset` |
| Hover / pressed fills | `--bg-hover` `--bg-active` |
| Hairlines | `--border` (default), `--border-strong` (inputs, emphasis) |
| Ink | `--text-main` `--text-muted` `--text-dim` `--text-on-accent` |
| Accent | `--accent` (fills), `--accent-text` (ink), `--accent-soft` / `--accent-softer` (tints), `--accent-hover` |
| Semantic | `--success` `--warning` `--error` `--info` + `-soft` tints |
| Type | `--text-2xs` 10 · `--text-xs` 11 · `--text-sm` 12 · `--text-base` 13 · `--text-md` 14 · `--text-lg` 16 · `--text-xl` 20 · `--text-2xl` 24 · `--text-3xl` 32 · `--text-display` 56 |
| Space | `--space-1` 2 · `2` 4 · `3` 8 · `4` 12 · `5` 16 · `6` 24 · `7` 32 · `8` 48 |
| Radius | `--radius-xs` 3 · `sm` 5 · `md` 8 · `lg` 12 · `xl` 16 · `full` |
| Motion | `--motion-fast` 100 · `base` 160 · `modal` 240 · `slow` 360; eases `--ease-standard` `--ease-decel` `--ease-accel` `--ease-spring` |
| Elevation | `--shadow-sm` `--shadow-card` `--shadow-popover` `--shadow-modal` `--shadow-toast`; scrim `--overlay-scrim` |
| Layout | `--sidebar-w` 228 · `--rail-w` 64 · `--topbar-h` 52 · `--panel-w` 272 · `--sheet-w` 440 · `--content-max` 1120 |
| Z | `--z-sticky` `--z-panel` `--z-popover` `--z-sheet` `--z-modal` `--z-toast` `--z-palette` |
| Fonts | `--font-sans` (Inter), `--font-mono` (JetBrains Mono, for times/kbd) |

Light mode and high-contrast override the same names; **never** branch on
`body.light-mode` in a component.

## 3. Primitives (`components/ui/`) — use these, don't re-implement

```ts
import { Button, IconButton, Field, Input, Textarea, Select, Switch, Checkbox,
         Card, CardHeader, CardBody, CardFooter,
         Page, PageHeader, Section, EmptyState, Toolbar, ToolbarSpacer, ToolbarDivider, StatTile, Row,
         Segmented, Tabs, Badge, Avatar, ProgressRing, ProgressBar, Spinner, Skeleton, Tooltip,
         Menu, Popover, confirm, prompt, Icon, Icons, Kbd, Chip, TLDot } from '../components/ui';
```

- **Button** `variant="primary|secondary|ghost|subtle|danger"` `size="sm|md|lg"` `icon` `iconRight` `kbd` `loading` `block`. One primary per surface.
- **IconButton** `icon` `label` (required — it's the a11y name + tooltip) `active` `size`.
- **Field** wraps a control with `label` / `hint` / `error`; `inline` for settings rows. **Input** (`icon`, `size="sm"`), **Textarea**, **Select** (native, styled), **Switch** (`label`, `description`), **Checkbox** (`round` for task-done circles, `color` for timeline hue).
- **Card** + **CardHeader** (`title`, `description`, `actions`, `icon`, `compact`) + **CardBody** / **CardFooter**. `flush` for edge-to-edge lists.
- **Page** (`narrow` for centered columns, `bare` for full-bleed layouts), **PageHeader** (`title`, `description`, `eyebrow`, `actions`, children = tabs/filters), **Section** (`small` → caps label), **EmptyState**, **Toolbar**, **StatTile**, **Row** (label / description / control — the settings row).
- **Segmented** (view switchers, group-by), **Tabs** (sub-views with counts), **Badge** (`tone` or `color`, `dot`, `outline`), **Avatar**, **ProgressRing**, **ProgressBar**, **Spinner**, **Skeleton**, **Tooltip**.
- **Menu** (dropdown with keyboard nav; `trigger={({toggle, ref, ...a}) => <IconButton ref={ref} onClick={toggle} {...a} />}`), **Popover** (anchored panel).
- **confirm()** / **prompt()** — `await confirm({ title, description, destructive, confirmLabel })`. `DialogHost` is mounted in App.
- Existing atoms stay: `Icon`/`Icons` (now ~110 glyphs — check before adding), `Kbd`, `Chip`, `TLDot`, `SectionLabel`.
- Global classes with identical looks for plain elements: `loom-btn-primary|secondary|ghost|subtle|danger`, `loom-btn-sm|lg`, `loom-btn-icon`, `loom-field`, `loom-label`, `loom-hint`, `loom-card`, `loom-page`, `loom-divider`, `loom-mono`.

Rules: do not edit files in `components/ui/` (they are shared); if you need a
primitive that's missing, build it inside your own folder and note it in your
report. Do not add new inline `style={{}}` for anything a class can express;
inline is only for dynamic values (a timeline color, a computed width).

## 4. Layout grammar

```
┌ Sidebar (228 / 64) ─┬─ TopBar (52) ─────────────────────────────┐
│ brand · ⌘K · New    │ [page title | date-nav + view switcher]   │
│ PLAN  Home          │                     search · AI · bell · ⟳ · avatar │
│       Calendar      ├───────────────────────────────────────────┤
│       Tasks         │ optional context panel (272) │ content    │
│       Inbox   (3)   │                              │            │
│ DO    Focus         │                              │            │
│ LEARN Courses       │                              │            │
│       Journal       │                              │            │
│ ───────────────     │                              │            │
│ Settings · account  │                              │            │
└─────────────────────┴──────────────────────────────┴────────────┘
```

- Page content: `<Page>` (padding 24/32), `<PageHeader>` at top. Dashboards use
  `narrow="lg"` (1120), settings/journal use `narrow` (760).
- A page that has its own left panel (Calendar, Focus, Tasks, Courses) renders
  `<Page bare>` with a `--panel-w` aside on the left, collapsible, state stored
  under `loom:panel:<page>`.
- Keyboard hints: show `Kbd` on primary buttons and in tooltips; never in body copy.
- Icon-only controls always have `label`.
- Uppercase tracking labels (`Section small`) are for panel group headers only,
  never for card titles or table headers.

## 5. Copy

- Sentence case everywhere. "New event", not "New Event".
- Titles are nouns; buttons are verbs.
- Empty states: title says what's missing, description says how to fix it.
- No emoji in UI chrome (icons instead). No "coming soon" / phase / version
  strings in product copy. No "macOS"-specific wording — the app is
  cross-platform (Windows, macOS, Linux). Show `Ctrl` on non-Mac and `⌘` on Mac
  via `navigator.platform` (helper: `lib/keybindConfig.ts` `modKey()` if present,
  otherwise write a local `isMac` check).

## 6. Quality bar for every file you touch

1. Zero literal colors/sizes/radii/durations in CSS modules (use tokens).
2. Zero `window.confirm` / `window.prompt` / `alert`.
3. Every clickable is a `<button>` or `<a>`; icon-only ones have a label.
4. Loading → `Skeleton`/`Spinner`; empty → `EmptyState`; error → inline
   `Badge tone="error"` row or a toast, never silent.
5. Works in light mode and high-contrast (only tokens → automatic).
6. `npm run lint` shows no new warnings for your files; `npx tsc -b` passes;
   existing Vitest tests still pass (`npx vitest run`).
