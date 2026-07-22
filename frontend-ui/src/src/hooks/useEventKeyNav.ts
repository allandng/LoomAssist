/**
 * WS6 §3/§4 — keyboard navigation + move-mode for calendar event chips.
 *
 * FullCalendar v6 renders event pills that are unreachable by keyboard. This
 * hook layers a roving-tabindex list navigation and a WCAG 2.5.7-compliant
 * grab-move-drop over the grid without driving FC's pointer drag system:
 *
 *   • next / prev (j / k, registered in keybindConfig, dispatched by the Shell
 *     as `loom-event-nav`) walk the mounted occurrences chronologically. The
 *     focused chip gets tabindex="0" + a visible ring and is scrolled into view;
 *     all others get tabindex="-1". Selecting also syncs CalendarPage's
 *     selection highlight via `onSelect`.
 *   • Enter opens the pinned QuickPeek (WS5) on the focused chip; `e` (dispatched
 *     as `loom-event-edit`) opens the editor; Delete flows through the existing
 *     `loom-delete-selected` path since the chip is already selected.
 *   • ⌘/Ctrl + arrows enter move-mode: up/down = ±15 min, left/right = ∓/±1 day.
 *     A translucent FC background event previews the target; each step is
 *     announced politely. Enter commits (optimistic PUT + undo), Esc reverts —
 *     both via the shared escape stack so move-cancel outranks clear-selection.
 *
 * The hook owns no React state (all bookkeeping lives in refs) so its window
 * listeners mount once and never churn; the DOM element map is fed by
 * CalendarPage's `eventDidMount` / `eventWillUnmount`.
 */

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type FullCalendar from '@fullcalendar/react';
import type { Event } from '../types';
import { updateEvent } from '../api';
import { useUndo } from '../contexts/UndoContext';
import { useCalendarNav } from '../contexts/CalendarNavContext';
import { useModal } from '../contexts/ModalContext';
import { pushEscapeHandler } from '../lib/escapeStack';
import { announce } from '../lib/announce';

export interface EventNavEntry {
  el: HTMLElement;
  ev: Event;
  instanceDate?: string;
  start: Date;
  end: Date;
}

interface UseEventKeyNavOptions {
  /** Only active in FullCalendar views (not the custom Year grid). */
  active: boolean;
  calRef: RefObject<FullCalendar | null>;
  /** Sync CalendarPage's selection highlight to the roving chip (or clear it). */
  onSelect: (eventId: number | null) => void;
  /** Open the pinned, keyboard-focused QuickPeek (WS5 mechanism). */
  onOpenPeek: (ev: Event, el: HTMLElement) => void;
}

const PHANTOM_ID = 'loom-kbmove-phantom';

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!el.isContentEditable;
}

const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtWeekday = (d: Date) => d.toLocaleDateString([], { weekday: 'long' });

export function useEventKeyNav(opts: UseEventKeyNavOptions) {
  const { push: pushUndo } = useUndo();
  const { reload } = useCalendarNav();
  const { openEventEditor } = useModal();

  // Latest opts kept in a ref so the once-mounted listeners never restale.
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  const mapRef = useRef<Map<string, EventNavEntry>>(new Map());
  const focusedIdRef = useRef<string | null>(null);
  const moveRef = useRef<
    | null
    | { fcId: string; ev: Event; instanceDate?: string; start: Date; end: Date; origStart: Date; origEnd: Date }
  >(null);
  const escPopRef = useRef<null | (() => void)>(null);
  const cancelMoveRef = useRef<() => void>(() => {});

  const registerEl = useCallback((fcId: string, entry: EventNavEntry) => {
    mapRef.current.set(fcId, entry);
  }, []);
  const unregisterEl = useCallback((fcId: string) => {
    mapRef.current.delete(fcId);
    if (focusedIdRef.current === fcId) focusedIdRef.current = null;
  }, []);

  useEffect(() => {
    // ---- roving focus ----
    function focusEntry(id: string, entry: EventNavEntry) {
      const prevId = focusedIdRef.current;
      if (prevId && prevId !== id) {
        const prev = mapRef.current.get(prevId);
        if (prev && document.contains(prev.el)) {
          prev.el.setAttribute('tabindex', '-1');
          prev.el.classList.remove('loom-event-kbfocus');
        }
      }
      focusedIdRef.current = id;
      entry.el.setAttribute('tabindex', '0');
      entry.el.classList.add('loom-event-kbfocus');
      entry.el.focus({ preventScroll: true });
      entry.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      optsRef.current.onSelect(entry.ev.id);
      announce(`${entry.ev.title}, ${fmtTime(entry.start)} to ${fmtTime(entry.end)}, ${fmtWeekday(entry.start)}`);
    }

    function navigate(delta: number) {
      const ordered = [...mapRef.current.entries()].sort(
        (a, b) => a[1].start.getTime() - b[1].start.getTime(),
      );
      if (ordered.length === 0) return;
      const curIdx = ordered.findIndex(([id]) => id === focusedIdRef.current);
      let targetIdx: number;
      if (curIdx === -1) {
        // No current focus → jump to the next upcoming event from now.
        const now = Date.now();
        const up = ordered.findIndex(([, x]) => x.start.getTime() >= now);
        targetIdx = up === -1 ? (delta > 0 ? 0 : ordered.length - 1) : up;
      } else {
        targetIdx = Math.min(Math.max(curIdx + delta, 0), ordered.length - 1);
      }
      const [id, entry] = ordered[targetIdx];
      focusEntry(id, entry);
    }

    // ---- move mode ----
    function setPhantom(start: Date, end: Date, horiz: boolean) {
      const api = optsRef.current.calRef.current?.getApi();
      if (!api) return;
      const existing = api.getEventById(PHANTOM_ID);
      if (existing) existing.setDates(start, end);
      else api.addEvent({ id: PHANTOM_ID, start, end, display: 'background', classNames: ['loom-move-phantom'] });
      // Keep the preview on-screen when a day/week step crosses the visible range.
      if (horiz) api.gotoDate(start);
    }
    function clearPhantom() {
      optsRef.current.calRef.current?.getApi()?.getEventById(PHANTOM_ID)?.remove();
    }

    function endMoveCleanup() {
      clearPhantom();
      moveRef.current = null;
      escPopRef.current?.();
      escPopRef.current = null;
    }

    function cancelMove() {
      const m = moveRef.current;
      if (!m) return;
      const title = m.ev.title;
      endMoveCleanup();
      announce(`Move cancelled. ${title} reverted.`);
    }
    cancelMoveRef.current = cancelMove;

    async function commitMove() {
      const m = moveRef.current;
      if (!m) return;
      const startISO = m.start.toISOString();
      const endISO = m.end.toISOString();
      const revertStart = m.origStart.toISOString();
      const revertEnd = m.origEnd.toISOString();
      const target = m.start;
      const title = m.ev.title;
      endMoveCleanup();
      try {
        await updateEvent(m.ev.id, { ...m.ev, start_time: startISO, end_time: endISO });
        pushUndo({
          label: `Move "${title}"`,
          undo: async () => { await updateEvent(m.ev.id, { ...m.ev, start_time: revertStart, end_time: revertEnd }); reload(); },
          redo: async () => { await updateEvent(m.ev.id, { ...m.ev, start_time: startISO, end_time: endISO }); reload(); },
        });
        announce(`Moved ${title} to ${fmtTime(target)}, ${fmtWeekday(target)}.`);
        reload();
      } catch {
        announce(`Move failed. ${title} unchanged.`);
      }
    }

    function stepMove(key: string) {
      let m = moveRef.current;
      if (!m) {
        const id = focusedIdRef.current;
        const f = id ? mapRef.current.get(id) : null;
        if (!id || !f) return;
        m = {
          fcId: id, ev: f.ev, instanceDate: f.instanceDate,
          start: new Date(f.start), end: new Date(f.end),
          origStart: new Date(f.start), origEnd: new Date(f.end),
        };
        moveRef.current = m;
        escPopRef.current = pushEscapeHandler(() => { cancelMove(); return true; });
      }
      const MIN = 60_000, DAY = 86_400_000;
      let horiz = false;
      if (key === 'ArrowUp')         { m.start = new Date(m.start.getTime() - 15 * MIN); m.end = new Date(m.end.getTime() - 15 * MIN); }
      else if (key === 'ArrowDown')  { m.start = new Date(m.start.getTime() + 15 * MIN); m.end = new Date(m.end.getTime() + 15 * MIN); }
      else if (key === 'ArrowLeft')  { m.start = new Date(m.start.getTime() - DAY); m.end = new Date(m.end.getTime() - DAY); horiz = true; }
      else if (key === 'ArrowRight') { m.start = new Date(m.start.getTime() + DAY); m.end = new Date(m.end.getTime() + DAY); horiz = true; }
      else return;
      setPhantom(m.start, m.end, horiz);
      announce(`${m.ev.title}, ${fmtTime(m.start)} to ${fmtTime(m.end)}, ${fmtWeekday(m.start)}`);
    }

    // ---- key + event listeners ----
    function onKey(e: KeyboardEvent) {
      if (!optsRef.current.active || isTyping()) return;
      const cmd = e.metaKey || e.ctrlKey;
      const isArrow = e.key.startsWith('Arrow');

      if (cmd && isArrow) {
        const focused = focusedIdRef.current ? mapRef.current.get(focusedIdRef.current) : null;
        if (!focused && !moveRef.current) return;
        e.preventDefault();
        stepMove(e.key);
        return;
      }
      if (e.key === 'Enter') {
        if (moveRef.current) { e.preventDefault(); void commitMove(); return; }
        const focused = focusedIdRef.current ? mapRef.current.get(focusedIdRef.current) : null;
        if (focused && document.activeElement === focused.el) {
          e.preventDefault();
          optsRef.current.onOpenPeek(focused.ev, focused.el);
        }
      }
    }

    function onNav(e: globalThis.Event) {
      if (!optsRef.current.active || moveRef.current) return;
      const dir = (e as CustomEvent<{ dir?: string }>).detail?.dir;
      navigate(dir === 'prev' ? -1 : 1);
    }
    function onEdit() {
      if (!optsRef.current.active || moveRef.current) return;
      const id = focusedIdRef.current;
      const f = id ? mapRef.current.get(id) : null;
      if (f) openEventEditor(f.ev, undefined, f.instanceDate);
    }

    window.addEventListener('keydown', onKey);
    window.addEventListener('loom-event-nav', onNav as EventListener);
    window.addEventListener('loom-event-edit', onEdit as EventListener);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('loom-event-nav', onNav as EventListener);
      window.removeEventListener('loom-event-edit', onEdit as EventListener);
      endMoveCleanup();
    };
  }, [pushUndo, reload, openEventEditor]);

  // If the user leaves the FC views mid-move, abandon the pending move.
  useEffect(() => {
    if (!opts.active && moveRef.current) cancelMoveRef.current();
  }, [opts.active]);

  return { registerEl, unregisterEl };
}
