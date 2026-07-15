import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './SearchDropdown.module.css';
import { useModal } from '../../contexts/ModalContext';
import { listEvents, listCalendars, semanticSearch } from '../../api';
import { pushEscapeHandler } from '../../lib/escapeStack';
import { DEFAULT_TIMELINE_COLOR } from '../../lib/colors';
import type { Event, Calendar } from '../../types';

interface SearchDropdownProps {
  query: string;
  semantic: boolean;
  /** Close the dropdown and clear the query in the parent. */
  onClose: () => void;
}

interface Row {
  key: string;
  title: string;
  sub: string;
  color: string;
  open: () => void;
}

/** Tiered substring scorer, mirrors CommandPalette. */
function score(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500;
  if (t.includes(q)) return 200;
  let s = 0;
  for (const tok of q.split(/\s+/).filter(Boolean)) if (t.includes(tok)) s += 50;
  return s;
}

/**
 * WS4 shell audit #2/#20 — a real search results dropdown under the TopBar
 * input. Semantic OFF: client-side substring match over cached events +
 * timelines. Semantic ON: debounced /search/semantic. Rows are clickable and
 * open the EventEditor — replaces the old "results as an unclickable toast".
 */
export function SearchDropdown({ query, semantic, onClose }: SearchDropdownProps) {
  const navigate = useNavigate();
  const { openEventEditor } = useModal();
  const [events, setEvents] = useState<Event[]>([]);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const [semanticRows, setSemanticRows] = useState<Event[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const q = query.trim();
  const show = q.length >= 2;

  // Cache events + timelines once (refreshed each mount of the dropdown).
  useEffect(() => {
    listEvents().then(setEvents).catch(() => {});
    listCalendars().then(setTimelines).catch(() => {});
  }, []);

  const colorFor = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of timelines) map.set(t.id, t.color || DEFAULT_TIMELINE_COLOR);
    return (id: number) => map.get(id) ?? DEFAULT_TIMELINE_COLOR;
  }, [timelines]);

  // Semantic search — debounced 300ms, only when enabled + query is long enough.
  // All state writes happen inside async callbacks (never synchronously in the
  // effect body) so this stays a pure external-subscription effect. The text
  // path ignores semanticRows, so there's nothing to clear when semantic is off.
  useEffect(() => {
    if (!semantic || !show) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      setSemanticLoading(true);
      semanticSearch(q, 8)
        .then(res => { if (!cancelled) setSemanticRows(res.results.map(r => r.event)); })
        .catch(() => { if (!cancelled) setSemanticRows([]); })
        .finally(() => { if (!cancelled) setSemanticLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [semantic, q, show]);

  const rows: Row[] = useMemo(() => {
    if (!show) return [];
    const fmt = (iso: string) =>
      new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

    if (semantic) {
      return semanticRows.map(ev => ({
        key: `e:${ev.id}`,
        title: ev.title,
        sub: fmt(ev.start_time),
        color: colorFor(ev.calendar_id),
        open: () => { openEventEditor(ev); onClose(); },
      }));
    }

    const scored: { row: Row; s: number }[] = [];
    for (const ev of events) {
      const s = score(q, ev.title);
      if (s <= 0) continue;
      scored.push({
        s,
        row: {
          key: `e:${ev.id}`,
          title: ev.title,
          sub: fmt(ev.start_time),
          color: colorFor(ev.calendar_id),
          open: () => { openEventEditor(ev); onClose(); },
        },
      });
    }
    scored.sort((a, b) => b.s - a.s);
    const events8 = scored.slice(0, 8).map(x => x.row);

    const tlRows: Row[] = [];
    for (const tl of timelines) {
      if (score(q, tl.name) <= 0) continue;
      tlRows.push({
        key: `tl:${tl.id}`,
        title: tl.name,
        sub: 'Timeline',
        color: tl.color || DEFAULT_TIMELINE_COLOR,
        open: () => { navigate('/calendar'); onClose(); },
      });
    }
    return [...events8, ...tlRows.slice(0, 4)];
  }, [show, semantic, semanticRows, events, timelines, q, colorFor, openEventEditor, navigate, onClose]);

  // Reset the highlighted row when the query/mode changes — render-phase
  // adjustment (React's blessed pattern) rather than a setState-in-effect.
  const navKey = `${q}|${semantic}`;
  const [prevNavKey, setPrevNavKey] = useState(navKey);
  if (navKey !== prevNavKey) { setPrevNavKey(navKey); setActive(0); }

  // Close on outside pointer + own the Escape (top of the escape stack).
  useEffect(() => {
    if (!show) return;
    const pop = pushEscapeHandler(() => { onClose(); });
    function onDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (rootRef.current?.contains(t)) return;
      if (t.closest('.loom-search-wrap')) return; // typing in the input
      onClose();
    }
    window.addEventListener('pointerdown', onDown, true);
    return () => { pop(); window.removeEventListener('pointerdown', onDown, true); };
  }, [show, onClose]);

  // Keyboard nav while the input has focus — listen on the wrapping label.
  useEffect(() => {
    if (!show) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, rows.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter') { if (rows[active]) { e.preventDefault(); rows[active].open(); } }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, rows, active]);

  if (!show) return null;

  return (
    <div ref={rootRef} className={styles.dropdown} role="listbox" aria-label="Search results">
      {rows.length === 0 ? (
        <div className={styles.empty}>
          {semantic && semanticLoading ? 'Searching…' : `No matches for “${q}”`}
        </div>
      ) : (
        rows.map((r, i) => (
          <button
            key={r.key}
            className={`${styles.row} ${i === active ? styles.rowActive : ''}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={r.open}
          >
            <span className={styles.dot} style={{ background: r.color }} aria-hidden="true" />
            <span className={styles.rowTitle}>{r.title}</span>
            <span className={styles.rowSub}>{r.sub}</span>
          </button>
        ))
      )}
    </div>
  );
}
