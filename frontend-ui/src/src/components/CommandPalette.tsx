import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import styles from './CommandPalette.module.css';
import { Icon, Icons } from './shared/Icon';
import { Kbd } from './shared/Kbd';
import { useModal } from '../contexts/ModalContext';
import { useCalendarNav, type CalendarView } from '../contexts/CalendarNavContext';
import { useNotifications } from '../store/notifications';
import { listEvents, listTasks, listCalendars, runAllSync, getCachedWeeklyReview, generateWeeklyReview } from '../api';
import { pushEscapeHandler } from '../lib/escapeStack';
import { loadKeybinds, formatKeyLabel } from '../lib/keybindConfig';
import { modKey } from '../lib/platform';
import { lastMonday } from '../lib/eventUtils';
import type { Event, Task, Calendar } from '../types';

type Group = 'Recent' | 'Navigate' | 'Create' | 'Calendar' | 'Tools' | 'Settings' | 'Events' | 'Tasks' | 'Timelines';

const GROUP_ORDER: Group[] = ['Recent', 'Navigate', 'Create', 'Calendar', 'Tools', 'Settings', 'Events', 'Tasks', 'Timelines'];

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  /** Keyboard hint shown at the right edge. */
  kbd?: string;
  icon?: ReactNode;
  /** Timeline color swatch for event/timeline rows. */
  color?: string;
  group: Group;
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenShortcuts?: () => void;
  onJumpToDate?: () => void;
  /** "Capture to inbox" — opens the quick-capture inbox panel. */
  onCaptureInbox?: () => void;
}

const RECENTS_KEY = 'loom_palette_recents';

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function score(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500;
  if (t.includes(q)) return 200;
  // Token-set: each query word contained in target gives +50
  const tokens = q.split(/\s+/).filter(Boolean);
  let s = 0;
  for (const tok of tokens) {
    if (t.includes(tok)) s += 50;
  }
  return s;
}

function toggleTheme() {
  const current = localStorage.getItem('loom-theme');
  const next = current === 'light' ? 'dark' : 'light';
  document.body.classList.toggle('light-mode', next === 'light');
  document.body.classList.remove('high-contrast');
  localStorage.setItem('loom-theme', next);
  window.dispatchEvent(new CustomEvent('loom-theme-changed', { detail: { theme: next } }));
}

const VIEWS: { view: CalendarView; action: 'view_month' | 'view_week' | 'view_day' | 'view_year' | 'view_agenda' }[] = [
  { view: 'Month',  action: 'view_month' },
  { view: 'Week',   action: 'view_week' },
  { view: 'Day',    action: 'view_day' },
  { view: 'Year',   action: 'view_year' },
  { view: 'Agenda', action: 'view_agenda' },
];

/**
 * Command palette (DESIGN.md §3/§4). Centered, 560px, above everything.
 * Groups: Navigate · Create · Calendar · Tools · Settings, then data rows
 * (events / tasks / timelines). Recents float to the top when the query is empty.
 */
export function CommandPalette({ open, onClose, onOpenShortcuts, onJumpToDate, onCaptureInbox }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { openEventEditor, openTimelineEditor, openSyllabus, openWeeklyReview, openTemplateManager } = useModal();
  const nav = useCalendarNav();
  const { addNotification } = useNotifications();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [events, setEvents]       = useState<Event[]>([]);
  const [tasks, setTasks]         = useState<Task[]>([]);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const [recents, setRecents]     = useState<string[]>(loadRecents);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset transient state on each open (render-phase adjustment, no effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery('');
      setActive(0);
      setRecents(loadRecents());
    }
  }

  // Refresh data + focus the input on open. Events are windowed to ±90 days
  // around the open moment here, in the async callback, so the item list
  // stays a pure function of state.
  useEffect(() => {
    if (!open) return;
    listEvents().then(evs => {
      const now = Date.now();
      const lo = now - 90 * 86_400_000;
      const hi = now + 90 * 86_400_000;
      setEvents(evs.filter(ev => {
        const t = new Date(ev.start_time).getTime();
        return !isNaN(t) && t >= lo && t <= hi;
      }));
    }).catch(() => {});
    listTasks().then(setTasks).catch(() => {});
    listCalendars().then(setTimelines).catch(() => {});
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Own the top of the shared escape stack while open.
  useEffect(() => {
    if (!open) return;
    return pushEscapeHandler(() => onClose());
  }, [open, onClose]);

  // Persist the last 8 executed command ids (recents-first ranking).
  const recordRecent = useCallback((id: string) => {
    // Only remember stable command ids — event/task rows churn.
    if (!/^[ncltsa]:/.test(id)) return;
    const next = [id, ...loadRecents().filter(x => x !== id)].slice(0, 8);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  }, []);

  const items: PaletteItem[] = useMemo(() => {
    const out: PaletteItem[] = [];
    const kb = loadKeybinds();
    const go = (path: string) => () => { navigate(path); onClose(); };
    const tlColor = new Map(timelines.map(t => [t.id, t.color]));

    // Navigate — all 8 destinations.
    out.push(
      { id: 'n:home',     label: 'Home',     icon: Icons.home,       group: 'Navigate', run: go('/home') },
      { id: 'n:calendar', label: 'Calendar', icon: Icons.calendar,   group: 'Navigate', kbd: formatKeyLabel(kb.view_month), run: go('/calendar') },
      { id: 'n:tasks',    label: 'Tasks',    icon: Icons.tasks,      group: 'Navigate', keywords: 'task board kanban', run: go('/tasks') },
      { id: 'n:inbox',    label: 'Inbox',    icon: Icons.inbox,      group: 'Navigate', run: go('/inbox') },
      { id: 'n:focus',    label: 'Focus',    icon: Icons.focus,      group: 'Navigate', kbd: formatKeyLabel(kb.focus_mode), keywords: 'focus mode timer', run: go('/focus') },
      { id: 'n:courses',  label: 'Courses',  icon: Icons.graduation, group: 'Navigate', keywords: 'classes syllabus', run: go('/courses') },
      { id: 'n:journal',  label: 'Journal',  icon: Icons.journal,    group: 'Navigate', keywords: 'notes takeaways', run: go('/journal') },
      { id: 'n:settings', label: 'Settings', icon: Icons.settings,   group: 'Navigate', keywords: 'preferences', run: go('/settings') },
    );

    // Create
    out.push(
      { id: 'c:new-event',    label: 'New event',        icon: Icons.plus,   group: 'Create', kbd: formatKeyLabel(kb.new_event), run: () => { onClose(); openEventEditor(); } },
      { id: 'c:capture',      label: 'Capture to inbox', icon: Icons.inbox,  group: 'Create', kbd: formatKeyLabel(kb.inbox), keywords: 'quick add note', run: () => { onClose(); if (onCaptureInbox) onCaptureInbox(); else navigate('/inbox'); } },
      { id: 'c:new-timeline', label: 'New timeline',     icon: Icons.layers, group: 'Create', keywords: 'calendar category', run: () => { onClose(); openTimelineEditor(); } },
    );

    // Calendar
    out.push(
      { id: 'l:today', label: 'Go to today', icon: Icons.calendar, group: 'Calendar', kbd: formatKeyLabel(kb.today), run: () => { onClose(); navigate('/calendar'); requestAnimationFrame(() => nav.goToday()); } },
      { id: 'l:jump',  label: 'Jump to date…', icon: Icons.arrowRight, group: 'Calendar', kbd: formatKeyLabel(kb.jump_date), keywords: 'go to date', run: () => { onClose(); onJumpToDate?.(); } },
      ...VIEWS.map<PaletteItem>(({ view, action }) => ({
        id: `l:view-${view.toLowerCase()}`,
        label: `${view} view`,
        icon: view === 'Agenda' ? Icons.list : view === 'Year' ? Icons.grid : Icons.columns,
        group: 'Calendar',
        kbd: formatKeyLabel(kb[action]),
        run: () => { onClose(); navigate('/calendar'); nav.setView(view); },
      })),
    );

    // Tools
    out.push(
      {
        id: 't:weekly-review', label: 'Weekly review', icon: Icons.chart, group: 'Tools', keywords: 'summary recap',
        run: () => {
          onClose();
          const weekStartISO = lastMonday(new Date()).toISOString();
          const id = addNotification({ type: 'progress', title: 'Preparing your weekly review…', severity: 'ambient', autoRemoveMs: 20_000 });
          void (async () => {
            try {
              const row = (await getCachedWeeklyReview(weekStartISO)) ?? (await generateWeeklyReview(weekStartISO));
              openWeeklyReview(row.markdown, weekStartISO);
            } catch {
              addNotification({ type: 'error', title: 'Could not build the weekly review', message: 'Is the backend running?' });
            }
          })();
          void id;
        },
      },
      { id: 't:print',      label: 'Print current view',     icon: Icons.file,     group: 'Tools', run: () => { onClose(); setTimeout(() => window.print(), 50); } },
      { id: 't:export-ics', label: 'Export calendar (ICS)',  icon: Icons.download, group: 'Tools', keywords: 'ical download', run: () => { onClose(); window.dispatchEvent(new CustomEvent('loom-export-ics')); } },
      { id: 't:syllabus',   label: 'Scan syllabus',          icon: Icons.doc,      group: 'Tools', keywords: 'pdf course import', run: () => { onClose(); openSyllabus(); } },
      { id: 't:templates',  label: 'Manage event templates', icon: Icons.copy,     group: 'Tools', keywords: 'template reuse apply delete', run: () => { onClose(); openTemplateManager(); } },
      { id: 't:shortcuts',  label: 'Keyboard shortcuts',     icon: Icons.keyboard, group: 'Tools', kbd: formatKeyLabel(kb.shortcut_sheet), run: () => { onClose(); onOpenShortcuts?.(); } },
      { id: 't:theme',      label: 'Toggle theme',           icon: Icons.moon,     group: 'Tools', keywords: 'dark light mode appearance', run: () => { toggleTheme(); onClose(); } },
      { id: 't:sync-now',   label: 'Sync all connections',   icon: Icons.sync,     group: 'Tools', run: () => { runAllSync().catch(() => {}); onClose(); } },
      { id: 't:sync-review', label: 'Sync review',           icon: Icons.layers,   group: 'Tools', keywords: 'conflicts merge', run: go('/calendar/sync-review') },
    );

    // Settings
    out.push(
      { id: 's:appearance',  label: 'Appearance',  hint: 'Settings', icon: Icons.palette,  group: 'Settings', keywords: 'theme font', run: go('/settings#appearance') },
      { id: 's:keybindings', label: 'Keybindings', hint: 'Settings', icon: Icons.keyboard, group: 'Settings', keywords: 'shortcuts', run: go('/settings#keybindings') },
      { id: 's:data',        label: 'Data',        hint: 'Settings', icon: Icons.database, group: 'Settings', keywords: 'export import backup', run: go('/settings#data') },
      { id: 's:connections', label: 'Connections', hint: 'Settings', icon: Icons.cloud,    group: 'Settings', keywords: 'google icloud sync', run: go('/settings/connections') },
      { id: 's:account',     label: 'Account',     hint: 'Settings', icon: Icons.user,     group: 'Settings', keywords: 'sign in profile', run: go('/settings/account') },
    );

    // Events (already windowed to ±90 days when fetched)
    for (const ev of events) {
      out.push({
        id: `e:${ev.id}`,
        label: ev.title,
        hint: new Date(ev.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
        color: tlColor.get(ev.calendar_id),
        group: 'Events',
        run: () => { openEventEditor(ev); onClose(); },
      });
    }

    for (const t of tasks) {
      out.push({
        id: `t:${t.id}`,
        label: t.note || `(task #${t.id})`,
        hint: t.status,
        icon: Icons.tasks,
        group: 'Tasks',
        run: () => { navigate('/tasks'); onClose(); },
      });
    }

    for (const tl of timelines) {
      out.push({
        id: `tl:${tl.id}`,
        label: tl.name,
        hint: tl.is_course ? 'Course' : 'Timeline',
        color: tl.color,
        group: 'Timelines',
        run: () => { navigate('/calendar'); onClose(); },
      });
    }

    return out;
  }, [events, tasks, timelines, navigate, openEventEditor, openTimelineEditor, openSyllabus, openWeeklyReview, openTemplateManager, nav, addNotification, onClose, onJumpToDate, onOpenShortcuts, onCaptureInbox]);

  const runItem = useCallback((it: PaletteItem) => {
    recordRecent(it.id);
    it.run();
  }, [recordRecent]);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      // Recents-first: surface the last-used commands in a synthetic group
      // above the long tail (WS4 #11).
      const byId = new Map(items.map(it => [it.id, it]));
      const recentItems: PaletteItem[] = recents
        .map(id => byId.get(id))
        .filter((it): it is PaletteItem => !!it)
        .slice(0, 4)
        .map(it => ({ ...it, group: 'Recent' as const }));
      const recentIds = new Set(recentItems.map(it => it.id));
      const rest = items.filter(it => !recentIds.has(it.id) && it.group !== 'Events' && it.group !== 'Tasks');
      return [...recentItems, ...rest];
    }
    return items
      .map(it => ({ it, s: score(query, it.label) + (it.keywords ? score(query, it.keywords) * 0.5 : 0) + (it.hint ? score(query, it.hint) * 0.2 : 0) }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => b.s - a.s || GROUP_ORDER.indexOf(a.it.group) - GROUP_ORDER.indexOf(b.it.group))
      .slice(0, 60)
      .map(({ it }) => it);
  }, [items, query, recents]);

  // Group items for display, preserving GROUP_ORDER within the filtered set.
  const grouped = useMemo(() => {
    const map = new Map<Group, PaletteItem[]>();
    for (const it of filtered) {
      const arr = map.get(it.group);
      if (arr) arr.push(it); else map.set(it.group, [it]);
    }
    const ordered: { group: Group; items: PaletteItem[] }[] = [];
    for (const g of GROUP_ORDER) {
      const arr = map.get(g);
      if (arr) ordered.push({ group: g, items: arr });
    }
    return ordered;
  }, [filtered]);
  const flat = useMemo(() => grouped.flatMap(g => g.items), [grouped]);

  // Reset the highlighted row when the query changes (render-phase adjustment).
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) { setPrevQuery(query); setActive(0); }

  // Keep the active row in view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  // Panel-scoped Tab trap.
  const handleDialogKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, [tabindex]:not([tabindex="-1"])',
    ) ?? [];
    const arr = Array.from(focusables).filter(el => !(el as HTMLButtonElement).disabled);
    if (arr.length === 0) return;
    const first = arr[0], last = arr[arr.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Home' && !query) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && !query) { e.preventDefault(); setActive(Math.max(0, flat.length - 1)); }
    else if (e.key === 'Enter')   { e.preventDefault(); if (flat[active]) runItem(flat[active]); }
  }

  if (!open) return null;

  const activeId = flat[active] ? `loom-cmd-${flat[active].id}` : undefined;

  return createPortal(
    <div className={styles.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleDialogKey}
      >
        <div className={styles.inputRow}>
          <Icon d={Icons.search} size={16} className={styles.inputIcon} />
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            placeholder="Type a command or search…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Command or search"
            role="combobox"
            aria-expanded="true"
            aria-controls="loom-cmd-list"
            aria-activedescendant={activeId}
            autoComplete="off"
            spellCheck={false}
          />
          {query ? (
            <button type="button" className={styles.clear} onClick={() => setQuery('')} aria-label="Clear">
              <Icon d={Icons.x} size={13} />
            </button>
          ) : (
            <Kbd small>{modKey}{modKey === 'Ctrl' ? '+' : ''}K</Kbd>
          )}
        </div>

        <div ref={listRef} id="loom-cmd-list" className={styles.list} role="listbox" aria-label="Commands">
          {flat.length === 0 && (
            <div className={styles.empty}>
              <Icon d={Icons.search} size={18} />
              <span>No matches for “{query}”</span>
            </div>
          )}
          {(() => {
            let idx = 0;
            return grouped.map(({ group, items: groupItems }) => (
              <div key={group} className={styles.group} role="group" aria-label={group}>
                <div className={styles.groupHeader}>{group}</div>
                {groupItems.map(it => {
                  const itemIdx = idx++;
                  const isActive = itemIdx === active;
                  return (
                    <button
                      key={it.id}
                      id={`loom-cmd-${it.id}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-idx={itemIdx}
                      className={[styles.item, isActive ? styles.itemActive : ''].join(' ')}
                      onMouseEnter={() => setActive(itemIdx)}
                      onClick={() => runItem(it)}
                      tabIndex={-1}
                    >
                      <span className={styles.itemIcon} aria-hidden="true">
                        {it.color ? (
                          <span className={styles.swatch} style={{ background: it.color }} />
                        ) : it.icon ? (
                          <Icon d={it.icon} size={14} />
                        ) : (
                          <Icon d={Icons.circle} size={14} />
                        )}
                      </span>
                      <span className={styles.itemLabel}>{it.label}</span>
                      {it.hint && <span className={styles.itemHint}>{it.hint}</span>}
                      {it.kbd && <Kbd small>{it.kbd}</Kbd>}
                    </button>
                  );
                })}
              </div>
            ));
          })()}
        </div>

        <div className={styles.footer}>
          <span className={styles.footerHint}><Kbd small>↑</Kbd><Kbd small>↓</Kbd> navigate</span>
          <span className={styles.footerHint}><Kbd small>↵</Kbd> open</span>
          <span className={styles.footerHint}><Kbd small>esc</Kbd> close</span>
          <span className={styles.footerCount}>{flat.length} {flat.length === 1 ? 'result' : 'results'}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
