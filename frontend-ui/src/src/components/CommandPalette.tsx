import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './CommandPalette.module.css';
import { useModal } from '../contexts/ModalContext';
import { listEvents, listTasks, listCalendars, runAllSync } from '../api';
import { pushEscapeHandler } from '../lib/escapeStack';
import type { Event, Task, Calendar } from '../types';

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  group: 'Recent' | 'Actions' | 'Events' | 'Tasks' | 'Timelines' | 'Settings';
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenShortcuts?: () => void;
  onJumpToDate?: () => void;
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

export function CommandPalette({ open, onClose, onOpenShortcuts, onJumpToDate }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { openEventEditor } = useModal();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [events, setEvents]       = useState<Event[]>([]);
  const [tasks, setTasks]         = useState<Task[]>([]);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const [recents, setRecents]     = useState<string[]>(loadRecents);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Load data on first open
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setRecents(loadRecents());
    listEvents().then(setEvents).catch(() => {});
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
    // Only remember stable action/settings ids — event/task rows churn.
    if (!/^[as]:/.test(id)) return;
    const next = [id, ...loadRecents().filter(x => x !== id)].slice(0, 8);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  }, []);

  const items: PaletteItem[] = useMemo(() => {
    const out: PaletteItem[] = [];

    out.push(
      { id: 'a:new-event',       label: 'New event',                  group: 'Actions', run: () => { openEventEditor(); onClose(); } },
      { id: 'a:home',            label: 'Go to Home',                 group: 'Actions', run: () => { navigate('/home'); onClose(); } },
      { id: 'a:calendar',        label: 'Go to Calendar',             group: 'Actions', run: () => { navigate('/calendar'); onClose(); } },
      { id: 'a:tasks',           label: 'Go to Task Board',           group: 'Actions', run: () => { navigate('/tasks'); onClose(); } },
      { id: 'a:focus',           label: 'Go to Focus Mode',           group: 'Actions', run: () => { navigate('/focus'); onClose(); } },
      { id: 'a:inbox',           label: 'Go to Inbox',                group: 'Actions', run: () => { navigate('/inbox'); onClose(); } },
      { id: 'a:journal',         label: 'Go to Journal',              group: 'Actions', run: () => { navigate('/journal'); onClose(); } },
      { id: 'a:settings',        label: 'Go to Settings',             group: 'Actions', run: () => { navigate('/settings'); onClose(); } },
      { id: 'a:sync-review',     label: 'Open Sync Review',           group: 'Actions', run: () => { navigate('/calendar/sync-review'); onClose(); } },
      { id: 'a:sync-now',        label: 'Sync all connections now',   group: 'Actions', run: () => { runAllSync().catch(() => {}); onClose(); } },
      { id: 'a:print',           label: 'Print current view',         group: 'Actions', run: () => { onClose(); setTimeout(() => window.print(), 50); } },
      { id: 'a:jump-date',       label: 'Go to date…',                group: 'Actions', run: () => { onClose(); onJumpToDate?.(); } },
      { id: 'a:shortcuts',       label: 'Show keyboard shortcuts',    group: 'Actions', run: () => { onClose(); onOpenShortcuts?.(); } },
      { id: 's:appearance',      label: 'Settings → Appearance',      group: 'Settings', run: () => { navigate('/settings#appearance'); onClose(); } },
      { id: 's:keybindings',     label: 'Settings → Keybindings',     group: 'Settings', run: () => { navigate('/settings#keybindings'); onClose(); } },
      { id: 's:lan-sync',        label: 'Settings → LAN Sync',        group: 'Settings', run: () => { navigate('/settings#lan-sync'); onClose(); } },
      { id: 's:account',         label: 'Settings → Account',         group: 'Settings', run: () => { navigate('/settings/account'); onClose(); } },
      { id: 's:connections',     label: 'Settings → Connections',     group: 'Settings', run: () => { navigate('/settings/connections'); onClose(); } },
    );

    // Events: limit window to ±90 days
    const now = Date.now();
    const lo  = now - 90 * 86_400_000;
    const hi  = now + 90 * 86_400_000;
    for (const ev of events) {
      const t = new Date(ev.start_time).getTime();
      if (isNaN(t) || t < lo || t > hi) continue;
      out.push({
        id: `e:${ev.id}`,
        label: ev.title,
        hint: new Date(ev.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
        group: 'Events',
        run: () => { openEventEditor(ev); onClose(); },
      });
    }

    for (const t of tasks) {
      out.push({
        id: `t:${t.id}`,
        label: t.note || `(task #${t.id})`,
        hint: t.status,
        group: 'Tasks',
        run: () => { navigate('/tasks'); onClose(); },
      });
    }

    for (const tl of timelines) {
      out.push({
        id: `tl:${tl.id}`,
        label: tl.name,
        hint: tl.is_course ? 'course' : undefined,
        group: 'Timelines',
        run: () => { navigate('/calendar'); onClose(); },
      });
    }

    return out;
  }, [events, tasks, timelines, navigate, openEventEditor, onClose, onJumpToDate, onOpenShortcuts]);

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
        .map(it => ({ ...it, group: 'Recent' as const }));
      const recentIds = new Set(recents);
      const rest = items.filter(it => !recentIds.has(it.id));
      return [...recentItems, ...rest].slice(0, 60);
    }
    return items
      .map(it => ({ it, s: score(query, it.label) + (it.hint ? score(query, it.hint) * 0.2 : 0) }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map(({ it }) => it);
  }, [items, query, recents]);

  // Reset active index when filtered list changes
  useEffect(() => { setActive(0); }, [query]);

  // Panel-scoped Tab trap (WS4 #11 — the previous "trap" comment was a no-op).
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
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter')   { e.preventDefault(); if (filtered[active]) runItem(filtered[active]); }
  }

  if (!open) return null;

  // Group items for display
  const grouped: { group: string; items: PaletteItem[] }[] = [];
  let lastGroup = '';
  let runningIdx = 0;
  for (const it of filtered) {
    if (it.group !== lastGroup) {
      grouped.push({ group: it.group, items: [] });
      lastGroup = it.group;
    }
    grouped[grouped.length - 1].items.push(it);
    runningIdx++;
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleDialogKey}
      >
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          placeholder="Type a command, event, task, timeline…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Search"
        />
        <div className={styles.list}>
          {filtered.length === 0 && (
            <div className={styles.empty}>No matches.</div>
          )}
          {(() => {
            let idx = 0;
            return grouped.map(({ group, items: groupItems }) => (
              <div key={group}>
                <div className={styles.groupHeader}>{group}</div>
                {groupItems.map(it => {
                  const isActive = idx === active;
                  const itemIdx = idx;
                  idx++;
                  return (
                    <button
                      key={it.id}
                      className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
                      onMouseEnter={() => setActive(itemIdx)}
                      onClick={() => runItem(it)}
                    >
                      <span className={styles.itemLabel}>{it.label}</span>
                      {it.hint && <span className={styles.itemHint}>{it.hint}</span>}
                    </button>
                  );
                })}
              </div>
            ));
          })()}
        </div>
        <div className={styles.footer}>
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
          <span style={{ marginLeft: 'auto' }}>{runningIdx} results</span>
        </div>
      </div>
    </div>
  );
}
