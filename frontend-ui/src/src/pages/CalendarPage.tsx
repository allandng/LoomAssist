import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventDropArg, EventClickArg, EventHoveringArg, DateSelectArg, EventContentArg, DateSpanApi } from '@fullcalendar/core';
import type { EventResizeDoneArg, EventDragStartArg, EventResizeStartArg } from '@fullcalendar/interaction';
import styles from './CalendarPage.module.css';
import { CalendarSidebar, type ScanEventEdit } from '../components/calendar/CalendarSidebar';
import { QuickPeek } from '../components/calendar/QuickPeek';
import { WellnessToast } from '../components/calendar/WellnessToast';
import { YearView } from '../components/calendar/YearView';
import { DragShader, type DragState, type SelectRange } from '../components/calendar/DragShader';
import { TodayLineFreshness } from '../components/calendar/TodayLineFreshness';
import { useCalendarNav } from '../contexts/CalendarNavContext';
import { useUndo } from '../contexts/UndoContext';
import { useModal } from '../contexts/ModalContext';
import { useShortcuts } from '../hooks/useShortcuts';
import { useReminders } from '../hooks/useReminders';
import { buildFCEvents, parseChecklist, timelineColor, relativeTime } from '../lib/eventUtils';
import {
  listEvents, createEvent, updateEvent, deleteEvent,
  listCalendars, createCalendar, updateCalendar, deleteCalendar,
  listTemplates,
  analyzeSchedule,
  extractSyllabus,
  findFreeSlots,
  listTimeBlockTemplates,
  deleteTimeBlockTemplate,
  applyTimeBlockTemplate,
} from '../api';
import type { FreeSlot } from '../types';
import type { Event, Calendar, EventTemplate, SyllabusEvent, EventCreate, TimeBlockTemplate, TimeBlockDef } from '../types';
import { useNotifications } from '../store/notifications';

// ---- FullCalendar view name map ----
const FC_VIEW: Record<string, string> = {
  Month: 'dayGridMonth', Week: 'timeGridWeek', Day: 'timeGridDay', Agenda: 'listWeek',
};

// ---- EventPill rendered inside FullCalendar ----
function EventPill({ info, timelines }: { info: EventContentArg; timelines: Calendar[] }) {
  const ev: Event = info.event.extendedProps.event;
  const color = timelineColor(timelines, ev.calendar_id);
  const isSpan = ev.is_all_day;
  const checklist = parseChecklist(ev.checklist);
  const doneCount = checklist.filter(c => c.done).length;
  const isClockedIn = !!ev.actual_start && !ev.actual_end;
  const startStr = info.event.start
    ? info.event.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

  const now = new Date();
  const start = info.event.start;
  const thresholdDays = Number(localStorage.getItem('loom_deadline_chip_days') ?? 3);
  let chipLabel = '';
  let isUrgent = false;
  if (start && start > now) {
    const diffMs = start.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays <= thresholdDays) {
      isUrgent = diffDays <= 1;
      chipLabel = diffDays < 1
        ? `⚠ ${Math.ceil(diffMs / 3_600_000)}h`
        : `⚠ ${Math.ceil(diffDays)}d`;
    }
  }

  return (
    <div
      className={styles.pill}
      style={{
        background: isSpan ? color : `${color}22`,
        color: isSpan ? 'white' : color,
        borderLeft: isSpan ? 'none' : `2px solid ${color}`,
      }}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData(
          'application/loom-event',
          JSON.stringify({ id: ev.id, title: ev.title }),
        );
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <span className={styles.pillTime}>{startStr}</span>
      <span className={styles.pillTitle} style={{ color: isSpan ? 'white' : 'var(--text-main)' }}>
        {info.event.title}
      </span>
      {checklist.length > 0 && (
        <span className={styles.pillChk}>{doneCount}/{checklist.length}</span>
      )}
      {isClockedIn && <span className={styles.clockDot} aria-label="Tracking active" />}
      {chipLabel && (
        <span className={`${styles.deadlineChip}${isUrgent ? ` ${styles.deadlineChipUrgent}` : ''}`}>
          {chipLabel}
        </span>
      )}
    </div>
  );
}

export function CalendarPage() {
  const calRef = useRef<FullCalendar>(null);
  const pendingDateRef = useRef<Date | null>(null);
  const nav = useCalendarNav();
  const { push: pushUndo } = useUndo();
  const { openEventEditor, openAvailability, openICSImport, openTimeBlockTemplate } = useModal();
  const { addNotification } = useNotifications();

  // Data
  const [events, setEvents] = useState<Event[]>([]);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [timeBlockTemplates, setTimeBlockTemplates] = useState<TimeBlockTemplate[]>([]);
  const [hiddenTimelineIds, setHiddenTimelineIds] = useState<Set<number>>(new Set());
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [selectedEventIds, setSelectedEventIds] = useState<Set<number>>(new Set());
  const [wellness, setWellness] = useState<{ date: string; message: string } | null>(null);

  // Sync state
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncStatus, setSyncStatus] = useState<'ok' | 'error'>('ok');
  const [syncLabel, setSyncLabel] = useState('Synced');

  // Drag shader (Phase 2)
  const [dragging, setDragging] = useState<DragState | null>(null);
  // Drag-to-select tint (Phase v3.0 §8 ride-along #2)
  const [selectRange, setSelectRange] = useState<SelectRange | null>(null);
  const dragShaderEnabled = localStorage.getItem('loom_drag_shader_enabled') !== 'false';

  // QuickPeek state
  const [peek, setPeek] = useState<{ event: Event; x: number; y: number } | null>(null);
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Double-click detection
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastClickedIdRef = useRef<string | null>(null);

  // Sidebar collapse
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(
    () => localStorage.getItem('loom_sidebar_open') !== 'false',
  );
  const toggleCalendarSidebar = useCallback(() => {
    setSidebarOpen(prev => {
      const next = !prev;
      localStorage.setItem('loom_sidebar_open', next ? 'true' : 'false');
      return next;
    });
  }, []);

  // Scan state
  const [scanResults, setScanResults] = useState<SyllabusEvent[] | null>(null);
  const [scanLoading, setScanLoading] = useState(false);

  // Scroll-wheel zoom
  const mainRef = useRef<HTMLDivElement>(null);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Load data ----
  const loadAll = useCallback(async (isFirst = false) => {
    try {
      const [evs, cals, tpls, tbtpls] = await Promise.all([listEvents(), listCalendars(), listTemplates(), listTimeBlockTemplates()]);
      setEvents(evs);
      setTimelines(cals);
      setTemplates(tpls);
      setTimeBlockTemplates(tbtpls);
      setLastSync(new Date());
      setSyncStatus('ok');

      // Wellness analysis (debounced — run after first load)
      if (isFirst) {
        analyzeSchedule(evs.map(e => ({ title: e.title, start_time: e.start_time, end_time: e.end_time }))).then(result => {
          if (result.warnings?.length) {
            setWellness({ date: new Date().toISOString().slice(0, 10), message: result.warnings[0] });
          }
        }).catch(() => {});
      }
    } catch {
      setSyncStatus('error');
    }
  }, []);

  useEffect(() => { loadAll(true); }, [loadAll]);

  // ---- Scan handlers ----
  const handleScanFile = useCallback(async (file: File) => {
    setScanLoading(true);
    setScanResults(null);
    if (!sidebarOpen) {
      setSidebarOpen(true);
      localStorage.setItem('loom_sidebar_open', 'true');
    }
    try {
      const evs = await extractSyllabus(file);
      if (evs.length === 0) {
        addNotification({ type: 'warning', title: 'No events found', message: 'No dates detected in the file.' });
      } else {
        setScanResults(evs);
      }
    } catch {
      addNotification({ type: 'error', title: 'Scan failed', message: 'Could not read file.' });
    } finally {
      setScanLoading(false);
    }
  }, [sidebarOpen, addNotification]);

  const handleApproveScan = useCallback(async (edit: ScanEventEdit, idx: number) => {
    const isAllDay = !edit.startTime;
    const start = isAllDay ? `${edit.date}T00:00:00` : `${edit.date}T${edit.startTime}:00`;
    const end   = isAllDay
      ? `${edit.date}T23:59:00`
      : edit.endTime
        ? `${edit.date}T${edit.endTime}:00`
        : `${edit.date}T${edit.startTime.replace(/^(\d{2}):(\d{2})$/, (_, h, m) =>
            `${String((Number(h) + 1) % 24).padStart(2, '0')}:${m}`
          )}:00`;
    const payload: EventCreate = {
      title: edit.title, start_time: start, end_time: end, calendar_id: edit.calendarId,
      is_recurring: false, recurrence_days: '', recurrence_end: '',
      description: '', unique_description: '', reminder_minutes: 0,
      external_uid: '', timezone: 'local', is_all_day: isAllDay,
      skipped_dates: '', per_day_times: '', checklist: '',
    };
    try {
      await createEvent(payload);
      setScanResults(prev => {
        if (!prev) return null;
        const next = prev.filter((_, i) => i !== idx);
        return next.length === 0 ? null : next;
      });
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Could not add event', message: edit.title });
    }
  }, [loadAll, addNotification]);

  const handleDismissScan = useCallback((idx: number) => {
    setScanResults(prev => {
      if (!prev) return null;
      const next = prev.filter((_, i) => i !== idx);
      return next.length === 0 ? null : next;
    });
  }, []);

  const handleClearScan = useCallback(() => {
    setScanResults(null);
    setScanLoading(false);
  }, []);

  // Sync label refresh every 30 seconds
  useEffect(() => {
    const id = setInterval(() => {
      if (lastSync) setSyncLabel(syncStatus === 'error' ? 'Sync failed' : `Synced ${relativeTime(lastSync)}`);
    }, 30_000);
    return () => clearInterval(id);
  }, [lastSync, syncStatus]);

  useEffect(() => {
    setSyncLabel(syncStatus === 'error' ? 'Sync failed' : (lastSync ? `Synced ${relativeTime(lastSync)}` : 'Syncing…'));
  }, [lastSync, syncStatus]);

  // Wire nav actions to FullCalendar
  useEffect(() => {
    const api = calRef.current?.getApi();
    if (!api) return;
    nav.registerActions({
      prev:       () => { api.prev();  nav.setDateLabel(api.view.title); },
      next:       () => { api.next();  nav.setDateLabel(api.view.title); },
      today:      () => { api.today(); nav.setDateLabel(api.view.title); },
      changeView: (v) => { api.changeView(v); nav.setDateLabel(api.view.title); },
    });
    nav.setDateLabel(api.view.title);
  }, [nav]);

  // Sync view prop → FullCalendar
  useEffect(() => {
    const api = calRef.current?.getApi();
    if (!api) return;
    const fc = FC_VIEW[nav.view];
    if (fc && api.view.type !== fc) {
      api.changeView(fc);
      nav.setDateLabel(api.view.title);
    }
  }, [nav.view]);

  // When leaving Year view, apply any pending date navigation
  useEffect(() => {
    if (nav.view === 'Year' || !pendingDateRef.current) return;
    const api = calRef.current?.getApi();
    if (!api) return;
    api.gotoDate(pendingDateRef.current);
    nav.setDateLabel(api.view.title);
    pendingDateRef.current = null;
  }, [nav.view]);

  const handleYearDayClick = useCallback((date: Date) => {
    pendingDateRef.current = date;
    nav.setView('Day');
  }, [nav]);

  const handleYearMonthClick = useCallback((date: Date) => {
    pendingDateRef.current = date;
    nav.setView('Month');
  }, [nav]);

  const handleFindFreeSlots = useCallback(async (durationMins: number): Promise<FreeSlot[]> => {
    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const result = await findFreeSlots({
      window_start: now.toISOString(),
      window_end: weekEnd.toISOString(),
      duration_minutes: durationMins,
    });
    return result.slots;
  }, []);

  const handleScheduleSlot = useCallback((startISO: string, endISO: string) => {
    openEventEditor(null, undefined, undefined, startISO, endISO);
  }, [openEventEditor]);

  // Wire TopBar sync status
  useEffect(() => {
    // Propagate to Shell's TopBar via context — handled by CalendarNavContext's syncStatus (Phase 3 wiring is enough)
  }, [syncLabel, syncStatus]);

  // Ctrl/Cmd + scroll-wheel zoom (cycles dayGridMonth ↔ timeGridWeek ↔ timeGridDay)
  // Plain scroll on non-time-grid views navigates prev/next period.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ZOOM_VIEWS = ['dayGridMonth', 'timeGridWeek', 'timeGridDay'] as const;
    type ZV = typeof ZOOM_VIEWS[number];
    // Views where vertical scroll is used for hours — skip plain-scroll nav there.
    const TIME_GRID = new Set(['timeGridWeek', 'timeGridDay']);

    const handler = (e: WheelEvent) => {
      if (wheelTimerRef.current) return; // debounce

      const api = calRef.current?.getApi();
      if (!api) return;
      const viewType = api.view.type;

      if (e.ctrlKey || e.metaKey) {
        // Zoom: change view granularity
        e.preventDefault();
        const idx = ZOOM_VIEWS.indexOf(viewType as ZV);
        const safeIdx = idx === -1 ? 0 : idx;
        const nextIdx = e.deltaY < 0
          ? Math.min(safeIdx + 1, ZOOM_VIEWS.length - 1)
          : Math.max(safeIdx - 1, 0);
        if (nextIdx !== safeIdx) {
          api.changeView(ZOOM_VIEWS[nextIdx]);
          nav.setDateLabel(api.view.title);
        }
      } else if (!TIME_GRID.has(viewType)) {
        // Plain scroll on month/agenda/list: navigate prev/next period
        e.preventDefault();
        if (e.deltaY > 0) {
          api.next();
        } else {
          api.prev();
        }
        nav.setDateLabel(api.view.title);
      } else {
        // Time-grid views: let the browser handle native hour scrolling
        return;
      }

      wheelTimerRef.current = setTimeout(() => { wheelTimerRef.current = null; }, 150);
    };

    el.addEventListener('wheel', handler, { passive: false });
    return () => {
      el.removeEventListener('wheel', handler);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    };
  }, [nav]);

  // ---- Computed FC events ----
  const fcEvents = useMemo(
    () => buildFCEvents(events, timelines, hiddenTimelineIds, activeFilters),
    [events, timelines, hiddenTimelineIds, activeFilters],
  );

  // ---- Filter counts ----
  const filterCounts = useMemo(() => {
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
    return {
      checklist: events.filter(e => e.checklist && e.checklist !== '[]').length,
      recurring: events.filter(e => e.is_recurring).length,
      thisweek:  events.filter(e => { const s = new Date(e.start_time); return s >= weekStart && s < weekEnd; }).length,
    };
  }, [events]);

  const eventCountByTimeline = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const e of events) counts[e.calendar_id] = (counts[e.calendar_id] ?? 0) + 1;
    return counts;
  }, [events]);

  // Reminders
  useReminders(events, addNotification);

  // ---- Handlers ----
  const toggleTimeline = useCallback((id: number) => {
    setHiddenTimelineIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleFilter = useCallback((f: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  }, []);

  // ---- FullCalendar event handlers (memoized to avoid FC re-renders) ----
  const handleEventDrop = useCallback(async (arg: EventDropArg) => {
    const ev: Event = arg.event.extendedProps.event;
    const prevStart = arg.oldEvent.start!;
    const prevEnd   = arg.oldEvent.end ?? new Date(prevStart.getTime() + 3_600_000);
    const newStart  = arg.event.start!;
    const newEnd    = arg.event.end ?? new Date(newStart.getTime() + (prevEnd.getTime() - prevStart.getTime()));

    const payload = { ...ev, start_time: newStart.toISOString(), end_time: newEnd.toISOString() };
    const revert  = { ...ev, start_time: prevStart.toISOString(), end_time: prevEnd.toISOString() };

    pushUndo({
      label: `Move "${ev.title}"`,
      undo: async () => { await updateEvent(ev.id, revert); await loadAll(); },
      redo: async () => { await updateEvent(ev.id, payload); await loadAll(); },
    });

    try {
      await updateEvent(ev.id, payload);
      await loadAll();
    } catch {
      arg.revert();
      addNotification({ type: 'error', title: 'Move failed', message: 'Could not update event.' });
    }
  }, [pushUndo, loadAll, addNotification]);

  // ---- Drag shader callbacks (Phase 2) ----
  const handleEventDragStart = useCallback((arg: EventDragStartArg) => {
    if (!dragShaderEnabled) return;
    const ev = arg.event.extendedProps.event as Event;
    const start = arg.event.start ?? new Date();
    const end   = arg.event.end   ?? new Date(start.getTime() + 3_600_000);
    setDragging({ id: ev.id, start, end });
  }, [dragShaderEnabled]);

  const handleEventDragStop = useCallback((_arg: EventDragStartArg) => {
    setDragging(null);
  }, []);

  const handleEventAllow = useCallback((dropInfo: DateSpanApi): boolean => {
    if (dragShaderEnabled) {
      setDragging(prev => prev ? { ...prev, start: dropInfo.start, end: dropInfo.end } : null);
    }
    return true;
  }, [dragShaderEnabled]);

  const handleResizeStart = useCallback((arg: EventResizeStartArg) => {
    if (!dragShaderEnabled) return;
    const ev = arg.event.extendedProps.event as Event;
    const start = arg.event.start ?? new Date();
    const end   = arg.event.end   ?? new Date(start.getTime() + 3_600_000);
    setDragging({ id: ev.id, start, end });
  }, [dragShaderEnabled]);

  const handleResizeStop = useCallback((_arg: EventResizeStartArg) => {
    setDragging(null);
  }, []);

  const handleEventResize = useCallback(async (arg: EventResizeDoneArg) => {
    const ev: Event = arg.event.extendedProps.event;
    const prevEnd  = arg.oldEvent.end!;
    const newEnd   = arg.event.end!;

    pushUndo({
      label: `Resize "${ev.title}"`,
      undo: async () => { await updateEvent(ev.id, { ...ev, end_time: prevEnd.toISOString() }); await loadAll(); },
      redo: async () => { await updateEvent(ev.id, { ...ev, end_time: newEnd.toISOString() });  await loadAll(); },
    });

    try {
      await updateEvent(ev.id, { ...ev, end_time: newEnd.toISOString() });
      await loadAll();
    } catch {
      arg.revert();
      addNotification({ type: 'error', title: 'Resize failed', message: 'Could not update event.' });
    }
  }, [pushUndo, loadAll, addNotification]);

  const handleEventClick = useCallback((arg: EventClickArg) => {
    const fcId = arg.event.id;
    if (lastClickedIdRef.current === fcId && clickTimerRef.current !== null) {
      // Double-click
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      lastClickedIdRef.current = null;
      const ev: Event = arg.event.extendedProps.event;
      const instanceDate: string | undefined = arg.event.extendedProps.instanceDate;
      openEventEditor(ev, undefined, instanceDate);
      return;
    }
    // Single click — 200 ms timer before treating as selection
    lastClickedIdRef.current = fcId;
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      lastClickedIdRef.current = null;
      const ev: Event = arg.event.extendedProps.event;
      setSelectedEventIds(prev => {
        const next = new Set(prev);
        if (arg.jsEvent.shiftKey || arg.jsEvent.metaKey || arg.jsEvent.ctrlKey) {
          if (next.has(ev.id)) next.delete(ev.id); else next.add(ev.id);
        } else {
          if (next.has(ev.id) && next.size === 1) next.clear(); else { next.clear(); next.add(ev.id); }
        }
        return next;
      });
    }, 200);
  }, [openEventEditor]);

  const handleMouseEnter = useCallback((arg: EventHoveringArg) => {
    if (window.matchMedia('(hover: none)').matches) return;
    if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    peekTimerRef.current = setTimeout(() => {
      const ev: Event = arg.event.extendedProps.event;
      const rect = (arg.el as HTMLElement).getBoundingClientRect();
      setPeek({ event: ev, x: rect.right, y: rect.top });
    }, 150);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (peekTimerRef.current) { clearTimeout(peekTimerRef.current); peekTimerRef.current = null; }
    setPeek(null);
  }, []);

  const handleSelect = useCallback((_arg: DateSelectArg) => {
    // drag-to-select on calendar — handled by Click handler for multi-select;
    // for new-event creation from dragging, open the editor
    // openEventEditor(null, arg.startStr);
    // calRef.current?.getApi().unselect();
    // Clear the select-range tint once the drag ends.
    setSelectRange(null);
  }, []);

  // FullCalendar fires selectAllow on every drag-tick; we use it to track the
  // current selection range so DragShader can tint conflicts in --warning.
  // Always returning true keeps the drag enabled.
  const handleSelectAllow = useCallback((arg: { start: Date; end: Date }) => {
    setSelectRange({ start: arg.start, end: arg.end });
    return true;
  }, []);

  const eventContent = useCallback((info: EventContentArg) => (
    <EventPill info={info} timelines={timelines} />
  ), [timelines]);

  // ---- Bulk delete ----
  const bulkDelete = useCallback(async () => {
    if (selectedEventIds.size === 0) return;
    const ids = [...selectedEventIds];
    const deleted = events.filter(e => ids.includes(e.id));
    pushUndo({
      label: `Delete ${ids.length} event(s)`,
      undo: async () => {
        // Re-create deleted events (POST each)
        const { createEvent } = await import('../api');
        for (const ev of deleted) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id, ...payload } = ev;
          await createEvent(payload);
        }
        await loadAll();
      },
      redo: async () => { await Promise.all(ids.map(id => deleteEvent(id))); await loadAll(); },
    });
    try {
      await Promise.all(ids.map(id => deleteEvent(id)));
      setSelectedEventIds(new Set());
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Delete failed', message: 'Some events could not be deleted.' });
    }
  }, [selectedEventIds, events, pushUndo, loadAll, addNotification]);

  // ---- Timeline actions ----
  const handleNewTimeline = useCallback(async () => {
    const name = window.prompt('New timeline name:');
    if (!name?.trim()) return;
    const cal = await createCalendar({ name: name.trim(), description: '', color: '#6366F1' });
    pushUndo({
      label: `Create timeline "${cal.name}"`,
      undo: async () => { await deleteCalendar(cal.id); await loadAll(); },
      redo: async () => { /* re-create not possible without re-issuing POST, skip */ },
    });
    await loadAll();
  }, [pushUndo, loadAll]);

  const handleRenameTimeline = useCallback(async (id: number, name: string) => {
    const prev = timelines.find(t => t.id === id)?.name ?? '';
    await updateCalendar(id, { name });
    pushUndo({
      label: `Rename timeline to "${name}"`,
      undo: async () => { await updateCalendar(id, { name: prev }); await loadAll(); },
      redo: async () => { await updateCalendar(id, { name }); await loadAll(); },
    });
    await loadAll();
  }, [timelines, pushUndo, loadAll]);

  const handleDeleteTimeline = useCallback(async (id: number) => {
    const tl = timelines.find(t => t.id === id);
    if (!tl) return;
    if (!window.confirm(`Delete timeline "${tl.name}"? Events will remain but lose their timeline.`)) return;
    await deleteCalendar(id);
    pushUndo({
      label: `Delete timeline "${tl.name}"`,
      undo: async () => { /* re-create timeline is complex — skip redo */ await loadAll(); },
      redo: async () => { await deleteCalendar(id); await loadAll(); },
    });
    await loadAll();
  }, [timelines, pushUndo, loadAll]);

  const handleApplyTemplate = useCallback((_t: EventTemplate) => {
    openEventEditor(null, undefined, undefined);
  }, [openEventEditor]);

  // ---- Time Block Template handlers ----

  const handleNewTimeBlockTemplate = useCallback(() => {
    openTimeBlockTemplate();
  }, [openTimeBlockTemplate]);

  const handleSaveWeekAsTemplate = useCallback(() => {
    const api = calRef.current?.getApi();
    if (!api) return;
    const viewStart = api.view.currentStart;
    const monday = new Date(viewStart);
    monday.setDate(viewStart.getDate() - ((viewStart.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 7);

    const prefillBlocks: TimeBlockDef[] = events
      .filter(e => {
        const d = new Date(e.start_time);
        return d >= monday && d < sunday && !e.is_all_day;
      })
      .map(e => {
        const start = new Date(e.start_time);
        const end   = new Date(e.end_time);
        const dow   = ((start.getDay() + 6) % 7) + 1; // 1=Mon…7=Sun
        return {
          title:      e.title,
          day_of_week: dow,
          start_time: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
          end_time:   `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
          calendar_id: e.calendar_id,
        };
      });

    openTimeBlockTemplate(prefillBlocks);
  }, [events, calRef, openTimeBlockTemplate]);

  const handleApplyTimeBlockTemplate = useCallback(async (tplId: number, weekMondayDate: string) => {
    try {
      const { applied_count, events: newEvents } = await applyTimeBlockTemplate(tplId, weekMondayDate);
      const ids = newEvents.map(e => e.id);
      pushUndo({
        label: `Apply time block template (${applied_count} block${applied_count !== 1 ? 's' : ''})`,
        undo: async () => { await Promise.all(ids.map(id => deleteEvent(id))); await loadAll(); },
        redo: async () => { await applyTimeBlockTemplate(tplId, weekMondayDate); await loadAll(); },
      });
      await loadAll();
      addNotification({ type: 'success', title: `${applied_count} block${applied_count !== 1 ? 's' : ''} added`, autoRemoveMs: 3000 });
    } catch {
      addNotification({ type: 'error', title: 'Apply failed', message: 'Could not stamp template onto week.', autoRemoveMs: 4000 });
    }
  }, [pushUndo, loadAll, addNotification]);

  const handleDeleteTimeBlockTemplate = useCallback(async (id: number) => {
    await deleteTimeBlockTemplate(id);
    await loadAll();
  }, [loadAll]);

  // ---- Keyboard shortcuts ----
  useShortcuts(useMemo(() => [
    { key: 'n', handler: () => openEventEditor(null) },
    { key: 't', handler: () => calRef.current?.getApi().today() },
    { key: '[', handler: () => { calRef.current?.getApi().prev(); nav.setDateLabel(calRef.current?.getApi().view.title ?? ''); } },
    { key: ']', handler: () => { calRef.current?.getApi().next(); nav.setDateLabel(calRef.current?.getApi().view.title ?? ''); } },
    { key: 'Delete',    handler: () => bulkDelete() },
    { key: 'Backspace', handler: () => bulkDelete() },
    { key: 'Escape', handler: () => setSelectedEventIds(new Set()) },
    { key: '/', handler: () => { document.querySelector<HTMLInputElement>('.loom-search')?.focus(); } },
  ], [openEventEditor, bulkDelete, nav]));

  return (
    <div className={styles.page}>
      <CalendarSidebar
        open={sidebarOpen}
        onToggle={toggleCalendarSidebar}
        onFindFreeSlots={handleFindFreeSlots}
        onScheduleSlot={handleScheduleSlot}
        timelines={timelines}
        templates={templates}
        hiddenTimelineIds={hiddenTimelineIds}
        activeFilters={activeFilters}
        eventCountByTimeline={eventCountByTimeline}
        filterCounts={filterCounts}
        onToggleTimeline={toggleTimeline}
        onToggleFilter={toggleFilter}
        onNewEvent={() => openEventEditor(null)}
        onAvailability={openAvailability}
        onImportICS={openICSImport}
        onScanFile={handleScanFile}
        scanLoading={scanLoading}
        scanResults={scanResults}
        onApproveScan={handleApproveScan}
        onDismissScan={handleDismissScan}
        onClearScan={handleClearScan}
        onNewTimeline={handleNewTimeline}
        onRenameTimeline={handleRenameTimeline}
        onDeleteTimeline={handleDeleteTimeline}
        onApplyTemplate={handleApplyTemplate}
        timeBlockTemplates={timeBlockTemplates}
        onNewTimeBlockTemplate={handleNewTimeBlockTemplate}
        onApplyTimeBlockTemplate={handleApplyTimeBlockTemplate}
        onDeleteTimeBlockTemplate={handleDeleteTimeBlockTemplate}
      />

      <div ref={mainRef} className={styles.main}>
        {nav.view === 'Year' && (
          <YearView events={events} onDayClick={handleYearDayClick} onMonthClick={handleYearMonthClick} />
        )}
        <div style={{ display: nav.view === 'Year' ? 'none' : undefined, height: '100%' }}>
        {nav.view === 'Week' && (
          <div className={styles.weekToolbar}>
            <button className="loom-btn-ghost" onClick={handleSaveWeekAsTemplate}>
              Save Week as Template
            </button>
          </div>
        )}
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={false}
          events={fcEvents}
          eventContent={eventContent}
          editable
          droppable={true}
          eventDurationEditable={true}
          eventStartEditable={true}
          selectable
          selectMirror
          height="100%"
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventClick={handleEventClick}
          eventMouseEnter={handleMouseEnter}
          eventMouseLeave={handleMouseLeave}
          select={handleSelect}
          selectAllow={handleSelectAllow}
          eventDragStart={handleEventDragStart}
          eventDragStop={handleEventDragStop}
          eventAllow={handleEventAllow}
          eventResizeStart={handleResizeStart}
          eventResizeStop={handleResizeStop}
          datesSet={info => nav.setDateLabel(info.view.title)}
          eventClassNames={arg => {
            const ev: Event = arg.event.extendedProps.event;
            return selectedEventIds.has(ev.id) ? ['loom-event-selected'] : [];
          }}
        />

        {dragShaderEnabled && (
          <DragShader dragging={dragging} selectRange={selectRange} events={events} />
        )}
        <TodayLineFreshness view={nav.view} />

        {peek && (
          <QuickPeek event={peek.event} timelines={timelines} anchorX={peek.x} anchorY={peek.y} />
        )}
        </div>
        {wellness && (
          <WellnessToast date={wellness.date} message={wellness.message} />
        )}
      </div>
    </div>
  );
}

export function CalendarSidebarContent() {
  // CalendarSidebar is rendered inside CalendarPage alongside FullCalendar.
  // The ContextSidebar in the shell is not used for Calendar — the sidebar
  // is embedded directly in CalendarPage for tight data coupling.
  return null;
}
