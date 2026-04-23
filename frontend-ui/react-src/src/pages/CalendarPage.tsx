import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventDropArg, EventResizeDoneArg, EventClickArg, EventHoveringArg, DateSelectArg, EventContentArg } from '@fullcalendar/core';
import styles from './CalendarPage.module.css';
import { CalendarSidebar } from '../components/calendar/CalendarSidebar';
import { QuickPeek } from '../components/calendar/QuickPeek';
import { WellnessToast } from '../components/calendar/WellnessToast';
import { useCalendarNav } from '../contexts/CalendarNavContext';
import { useUndo } from '../contexts/UndoContext';
import { useModal } from '../contexts/ModalContext';
import { useShortcuts } from '../hooks/useShortcuts';
import { useReminders } from '../hooks/useReminders';
import { buildFCEvents, parseChecklist, timelineColor, relativeTime } from '../lib/eventUtils';
import {
  listEvents, updateEvent, deleteEvent,
  listCalendars, createCalendar, updateCalendar, deleteCalendar,
  listTemplates,
  analyzeSchedule,
} from '../api';
import type { Event, Calendar, EventTemplate } from '../types';
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
  const startStr = info.event.start
    ? info.event.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <div
      className={styles.pill}
      style={{
        background: isSpan ? color : `${color}22`,
        color: isSpan ? 'white' : color,
        borderLeft: isSpan ? 'none' : `2px solid ${color}`,
      }}
    >
      <span className={styles.pillTime}>{startStr}</span>
      <span className={styles.pillTitle} style={{ color: isSpan ? 'white' : 'var(--text-main)' }}>
        {info.event.title}
      </span>
      {checklist.length > 0 && (
        <span className={styles.pillChk}>{doneCount}/{checklist.length}</span>
      )}
    </div>
  );
}

export function CalendarPage() {
  const calRef = useRef<FullCalendar>(null);
  const nav = useCalendarNav();
  const { push: pushUndo } = useUndo();
  const { openEventEditor, openAvailability, openICSImport, openSyllabus, openTimelineEditor } = useModal();
  const { addNotification } = useNotifications();

  // Data
  const [events, setEvents] = useState<Event[]>([]);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [hiddenTimelineIds, setHiddenTimelineIds] = useState<Set<number>>(new Set());
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [selectedEventIds, setSelectedEventIds] = useState<Set<number>>(new Set());
  const [wellness, setWellness] = useState<{ date: string; message: string } | null>(null);

  // Sync state
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncStatus, setSyncStatus] = useState<'ok' | 'error'>('ok');
  const [syncLabel, setSyncLabel] = useState('Synced');

  // QuickPeek state
  const [peek, setPeek] = useState<{ event: Event; x: number; y: number } | null>(null);
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Double-click detection
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastClickedIdRef = useRef<string | null>(null);

  // ---- Load data ----
  const loadAll = useCallback(async (isFirst = false) => {
    try {
      const [evs, cals, tpls] = await Promise.all([listEvents(), listCalendars(), listTemplates()]);
      setEvents(evs);
      setTimelines(cals);
      setTemplates(tpls);
      setLastSync(new Date());
      setSyncStatus('ok');

      // Wellness analysis (debounced — run after first load)
      if (isFirst) {
        analyzeSchedule().then(result => {
          if (result.warnings?.length) {
            const w = result.warnings[0];
            setWellness({ date: w.date, message: w.message });
          }
        }).catch(() => {});
      }
    } catch {
      setSyncStatus('error');
    }
  }, []);

  useEffect(() => { loadAll(true); }, [loadAll]);

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

  // Wire TopBar sync status
  useEffect(() => {
    // Propagate to Shell's TopBar via context — handled by CalendarNavContext's syncStatus (Phase 3 wiring is enough)
  }, [syncLabel, syncStatus]);

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
    const instanceDate: string | undefined = arg.event.extendedProps.instanceDate;
    const prevStart = arg.oldEvent.start!;
    const prevEnd   = arg.oldEvent.end ?? new Date(prevStart.getTime() + 3_600_000);
    const newStart  = arg.event.start!;
    const newEnd    = arg.event.end ?? new Date(newStart.getTime() + (prevEnd.getTime() - prevStart.getTime()));

    const payload = { start_time: newStart.toISOString(), end_time: newEnd.toISOString() };
    const revert  = { start_time: prevStart.toISOString(), end_time: prevEnd.toISOString() };

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

  const handleEventResize = useCallback(async (arg: EventResizeDoneArg) => {
    const ev: Event = arg.event.extendedProps.event;
    const prevEnd  = arg.oldEvent.end!;
    const newEnd   = arg.event.end!;

    pushUndo({
      label: `Resize "${ev.title}"`,
      undo: async () => { await updateEvent(ev.id, { end_time: prevEnd.toISOString() }); await loadAll(); },
      redo: async () => { await updateEvent(ev.id, { end_time: newEnd.toISOString() });  await loadAll(); },
    });

    try {
      await updateEvent(ev.id, { end_time: newEnd.toISOString() });
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

  const handleApplyTemplate = useCallback((t: EventTemplate) => {
    openEventEditor(null, undefined, undefined);
    // Template data passed via modal context in Phase 5
  }, [openEventEditor]);

  // ---- Keyboard shortcuts ----
  useShortcuts(useMemo(() => [
    { key: 'n', handler: () => openEventEditor(null) },
    { key: 't', handler: () => calRef.current?.getApi().today() },
    { key: '[', handler: () => { calRef.current?.getApi().prev(); nav.setDateLabel(calRef.current?.getApi().view.title ?? ''); } },
    { key: ']', handler: () => { calRef.current?.getApi().next(); nav.setDateLabel(calRef.current?.getApi().view.title ?? ''); } },
    { key: 'Delete',    handler: () => bulkDelete() },
    { key: 'Backspace', handler: () => bulkDelete() },
    { key: 'Escape', handler: () => setSelectedEventIds(new Set()) },
    { key: '/', handler: (e) => { e.preventDefault(); document.querySelector<HTMLInputElement>('.loom-search')?.focus(); } },
  ], [openEventEditor, bulkDelete, nav]));

  return (
    <div className={styles.page}>
      <CalendarSidebar
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
        onParseSyllabus={openSyllabus}
        onNewTimeline={handleNewTimeline}
        onRenameTimeline={handleRenameTimeline}
        onDeleteTimeline={handleDeleteTimeline}
        onApplyTemplate={handleApplyTemplate}
      />

      <div className={styles.main}>
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={false}
          events={fcEvents}
          eventContent={eventContent}
          editable
          selectable
          selectMirror
          height="100%"
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventClick={handleEventClick}
          eventMouseEnter={handleMouseEnter}
          eventMouseLeave={handleMouseLeave}
          select={handleSelect}
          datesSet={info => nav.setDateLabel(info.view.title)}
          eventClassNames={arg => {
            const ev: Event = arg.event.extendedProps.event;
            return selectedEventIds.has(ev.id) ? ['loom-event-selected'] : [];
          }}
        />

        {peek && (
          <QuickPeek event={peek.event} timelines={timelines} anchorX={peek.x} anchorY={peek.y} />
        )}
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
