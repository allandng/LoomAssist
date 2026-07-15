import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
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
import {
  ExamClusterBanner,
  getClusterEventIds,
  isClusterDismissed,
  markClusterDismissed,
} from '../components/calendar/ExamClusterBanner';
import { ProcrastinationToast } from '../components/calendar/ProcrastinationToast';
import { WarningStack } from '../components/calendar/WarningStack';
import { YearView } from '../components/calendar/YearView';
import { DragShader, type DragState, type SelectRange } from '../components/calendar/DragShader';
import { QuickCreatePopover, type QuickCreateAnchor } from '../components/calendar/QuickCreatePopover';
import { SelectionBar } from '../components/calendar/SelectionBar';
import { TodayLineFreshness } from '../components/calendar/TodayLineFreshness';
import { useCalendarNav } from '../contexts/CalendarNavContext';
import { useUndo } from '../contexts/UndoContext';
import { useModal } from '../contexts/ModalContext';
import { pushEscapeHandler } from '../lib/escapeStack';
import { useReminders } from '../hooks/useReminders';
import { useEventEndPrompts, type EndedOccurrence } from '../hooks/useEventEndPrompts';
import { useIsVisibleRef } from '../hooks/usePageVisibility';
import { TakeawayToast } from '../components/calendar/TakeawayToast';
import { buildFCEvents, parseChecklist, timelineColor, relativeTime } from '../lib/eventUtils';
import { tint } from '../lib/colors';
import {
  listEvents, createEvent, updateEvent, deleteEvent,
  listCalendars, updateCalendar, deleteCalendar,
  listTemplates,
  analyzeSchedule,
  detectExamClusters,
  getProcrastinationRadar,
  extractSyllabus,
  findFreeSlots,
  listTimeBlockTemplates,
  deleteTimeBlockTemplate,
  applyTimeBlockTemplate,
  getMissedEvents,
} from '../api';
import type { FreeSlot } from '../types';
import type { Event, Calendar, EventTemplate, SyllabusEvent, EventCreate, TimeBlockTemplate, TimeBlockDef, ProcrastinationWarning, WellnessWarning } from '../types';
import { getDismissed, dismiss as dismissRadar } from '../lib/radarDismissals';
import { checkSleepWindow } from '../lib/sleepWindow';
import { useNotifications } from '../store/notifications';

// ---- FullCalendar view name map ----
const FC_VIEW: Record<string, string> = {
  Month: 'dayGridMonth', Week: 'timeGridWeek', Day: 'timeGridDay', Agenda: 'listWeek',
};

// Module-level cache of the deadline-chip threshold (days). Read once at module
// load instead of on every EventPill render; refreshed when another window
// changes the setting via the `storage` event (WS2 audit #18).
let deadlineChipDays = Number(localStorage.getItem('loom_deadline_chip_days') ?? 3);
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'loom_deadline_chip_days' || e.key === null) {
      deadlineChipDays = Number(localStorage.getItem('loom_deadline_chip_days') ?? 3);
    }
  });
}

// ---- EventPill rendered inside FullCalendar ----
function EventPill({ info, timelines }: { info: EventContentArg; timelines: Calendar[] }) {
  const ev: Event = info.event.extendedProps.event;
  const isPrepBlock = !!info.event.extendedProps.isPrepBlock;
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
  const thresholdDays = deadlineChipDays;
  let chipLabel = '';
  let isUrgent = false;
  if (!isPrepBlock && start && start > now) {
    const diffMs = start.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays <= thresholdDays) {
      isUrgent = diffDays <= 1;
      chipLabel = diffDays < 1
        ? `⚠ ${Math.ceil(diffMs / 3_600_000)}h`
        : `⚠ ${Math.ceil(diffDays)}d`;
    }
  }

  // Contrast recipe (anatomy unchanged): tint the timeline hue over the themed
  // panel surface so the wash follows light/dark mode, and derive the inherited
  // text tone by mixing the hue toward the theme's text color (guarantees
  // legibility while preserving the hue as the cue). All-day spans keep the
  // solid fill + white text. See WS2 §7 / contrast test.
  return (
    <div
      className={`${styles.pill}${isPrepBlock ? ` ${styles.prepPill}` : ''}`}
      style={{
        background: isSpan ? color : tint(color, isPrepBlock ? 8 : 14, 'var(--bg-panel)'),
        color: isSpan ? 'white' : `color-mix(in srgb, ${color} 55%, var(--text-main))`,
        borderLeft: isSpan ? 'none' : `2px solid ${color}`,
      }}
      draggable={!isPrepBlock}
      onDragStart={isPrepBlock ? undefined : (e => {
        e.dataTransfer.setData(
          'application/loom-event',
          JSON.stringify({ id: ev.id, title: ev.title }),
        );
        e.dataTransfer.effectAllowed = 'copy';
      })}
    >
      <span className={styles.pillTime}>{startStr}</span>
      <span className={styles.pillTitle} style={{ color: isSpan ? 'white' : 'var(--text-main)' }}>
        {isPrepBlock ? `Prep · ${ev.title}` : info.event.title}
      </span>
      {!isPrepBlock && ev.travel_time_minutes && ev.travel_time_minutes > 0 ? (
        <span className={styles.travelChip} title={`${ev.travel_time_minutes} min travel buffer`}>→ {ev.travel_time_minutes}m</span>
      ) : null}
      {!isPrepBlock && checklist.length > 0 && (
        <span className={styles.pillChk}>{doneCount}/{checklist.length}</span>
      )}
      {!isPrepBlock && isClockedIn && <span className={styles.clockDot} aria-label="Tracking active" />}
      {chipLabel && (
        <span className={`${styles.deadlineChip}${isUrgent ? ` ${styles.deadlineChipUrgent}` : ''}`}>
          {chipLabel}
        </span>
      )}
    </div>
  );
}

// Module-scoped flag for the "Missed → Reschedule" recovery flow. Set when the
// user clicks Reschedule in MissedEventsModal; consumed when the editor closes
// (either path — save or cancel) by the modal-name transition watcher, which
// refetches the missed list and re-opens the modal. Module-scoped so it is
// independent of component-instance lifetime.
let pendingMissedRecovery = false;

export function CalendarPage() {
  const calRef = useRef<FullCalendar>(null);
  const pendingDateRef = useRef<Date | null>(null);
  const location = useLocation();
  const nav = useCalendarNav();
  const { push: pushUndo } = useUndo();
  const { openEventEditor, openAvailability, openICSImport, openTimeBlockTemplate, openMissedEvents, openTimelineEditor, modal } = useModal();
  const { addNotification } = useNotifications();

  // Data
  const [events, setEvents] = useState<Event[]>([]);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [timeBlockTemplates, setTimeBlockTemplates] = useState<TimeBlockTemplate[]>([]);
  const [hiddenTimelineIds, setHiddenTimelineIds] = useState<Set<number>>(new Set());
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [selectedEventIds, setSelectedEventIds] = useState<Set<number>>(new Set());
  // WS4 #10 — mini-calendar anchor + the main view's visible range (band).
  const [miniAnchor, setMiniAnchor] = useState<Date>(() => new Date());
  const [miniRange, setMiniRange] = useState<{ start: Date; end: Date } | null>(null);
  const [wellness, setWellness] = useState<{ date: string; message: string } | null>(null);
  // The detector emits at most one disjoint cluster today; the array shape on
  // /schedule/* allows more, so we render the first non-dismissed one.
  const [examClusterWarning, setExamClusterWarning] = useState<WellnessWarning | null>(null);
  const [radar, setRadar] = useState<ProcrastinationWarning[]>([]);
  const [radarDismissed, setRadarDismissed] = useState<Record<number, string>>(() => getDismissed());

  // Missed events (loaded on mount; refreshed via the nav.reload() handoff)
  const [missedItems, setMissedItems] = useState<Event[]>([]);
  const [missedTruncated, setMissedTruncated] = useState(false);
  const prevModalNameRef = useRef<typeof modal.name>(modal.name);

  // Sync state
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncStatus, setSyncStatus] = useState<'ok' | 'error'>('ok');
  const [syncLabel, setSyncLabel] = useState('Synced');

  // Drag shader (Phase 2)
  const [dragging, setDragging] = useState<DragState | null>(null);
  // Drag-to-select tint (Phase v3.0 §8 ride-along #2)
  const [selectRange, setSelectRange] = useState<SelectRange | null>(null);
  const dragShaderEnabled = localStorage.getItem('loom_drag_shader_enabled') !== 'false';
  // WS3 #10 — plain-scroll period paging is opt-out. Read once (route remounts).
  const wheelNavEnabled = localStorage.getItem('loom_wheel_nav') !== 'false';
  // WS3 #5 — element dimmed as the drag "ghost at origin"; cleared on drag stop.
  const dragSourceElRef = useRef<HTMLElement | null>(null);

  // WS3 #1 — quick-create popover anchored to the drag/click selection.
  const [quickCreate, setQuickCreate] = useState<
    { start: Date; end: Date; allDay: boolean; anchor: QuickCreateAnchor } | null
  >(null);

  // WS2: past-event dimming (opt-out). Read once on mount so a Settings toggle
  // takes effect the next time the calendar is navigated to (this route
  // remounts), without a localStorage read per pill.
  const dimPast = useMemo(() => localStorage.getItem('loom_dim_past') !== 'false', []);

  // Empty-grid overlay (one-time, dismissible, month view only).
  const [emptyDismissed, setEmptyDismissed] = useState(false);

  // WS2: weekend-wash toggle → body class the grid CSS keys off. Applied on
  // mount so it survives a boot where Settings was never opened.
  useEffect(() => {
    const washOn = localStorage.getItem('loom_weekend_wash') !== 'false';
    document.body.classList.toggle('loom-no-weekend-wash', !washOn);
  }, []);

  // QuickPeek state. A hover peek is passive; a single click pins an interactive
  // one (WS5 #1). `anchorEl` is the originating pill — focus returns to it on Esc.
  const [peek, setPeek] = useState<
    { event: Event; x: number; y: number; pinned: boolean; keyboard: boolean; anchorEl: HTMLElement | null } | null
  >(null);
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peekHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Double-click detection (timestamp-based — no 200ms selection delay: a single
  // click selects immediately, a second within the window opens the editor).
  const lastClickTimeRef = useRef<number>(0);
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

      // Wellness analysis (debounced — run after first load).
      // Splits the response: cluster warnings → ExamClusterBanner; everything
      // else → WellnessToast. Subsequent mutations re-detect via the cheap
      // /schedule/detect-clusters endpoint (see effect below).
      if (isFirst) {
        analyzeSchedule(evs.map(e => ({ id: e.id, title: e.title, start_time: e.start_time, end_time: e.end_time }))).then(result => {
          const llm = result.warnings.find(w => w.kind !== 'exam_cluster');
          if (llm) {
            setWellness({ date: new Date().toISOString().slice(0, 10), message: llm.message });
          }
          const cluster = result.warnings.find(w => w.kind === 'exam_cluster') ?? null;
          setExamClusterWarning(cluster);
        }).catch(() => {});
      }

      // Procrastination Radar — cheap SQL, refresh every loadAll so warnings
      // disappear the moment a study block is scheduled.
      getProcrastinationRadar()
        .then(result => setRadar(result.warnings ?? []))
        .catch(() => {});
    } catch {
      setSyncStatus('error');
    }
  }, []);

  useEffect(() => { loadAll(true); }, [loadAll]);

  // WS3 #8 — refresh the "missed" list state (sidebar count) without reopening
  // any modal. Used by the reload handoff and the initial mount fetch.
  const refreshMissedState = useCallback(async () => {
    try {
      const { items, truncated } = await getMissedEvents();
      setMissedItems(items);
      setMissedTruncated(truncated);
    } catch { /* silently ignore — sidebar shows empty state */ }
  }, []);

  // WS3 #8 — register the imperative refetch. Save/voice paths call nav.reload()
  // instead of remounting the whole page (which discarded scroll/view/selection).
  // Previously-rendered events stay on screen until the fetch resolves.
  useEffect(() => {
    nav.registerReload(async () => {
      await loadAll();
      await refreshMissedState();
    });
    // Clear on unmount so a modal saving from another page can't fire this
    // instance's (now stale) loader.
    return () => { nav.registerReload(() => {}); };
  }, [nav, loadAll, refreshMissedState]);

  // Mutation-triggered exam-cluster detection. Skips the very first non-empty
  // events render (analyzeSchedule already seeds the banner on initial load).
  // Debounced 250ms so drag-resize churn doesn't fire a request per pixel.
  const seenInitialEventsRef = useRef(false);
  const detectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (events.length === 0) return;
    if (!seenInitialEventsRef.current) {
      seenInitialEventsRef.current = true;
      return;
    }
    if (detectTimeoutRef.current) clearTimeout(detectTimeoutRef.current);
    detectTimeoutRef.current = setTimeout(() => {
      detectExamClusters(events.map(e => ({
        id: e.id, title: e.title, start_time: e.start_time, end_time: e.end_time,
      }))).then(result => {
        const cluster = result.warnings.find(w => w.kind === 'exam_cluster') ?? null;
        setExamClusterWarning(cluster);
      }).catch(() => {});
    }, 250);
    return () => { if (detectTimeoutRef.current) clearTimeout(detectTimeoutRef.current); };
  }, [events]);

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
  const syncLabelVisibleRef = useIsVisibleRef();
  useEffect(() => {
    const id = setInterval(() => {
      if (!syncLabelVisibleRef.current) return;
      if (lastSync) setSyncLabel(syncStatus === 'error' ? 'Sync failed' : `Synced ${relativeTime(lastSync)}`);
    }, 30_000);
    return () => clearInterval(id);
  }, [lastSync, syncStatus, syncLabelVisibleRef]);

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

  // Cross-page navigation bridge (WS4 #12): Home hands off via route state
  // `{ date, view }` instead of an invisible sessionStorage side channel.
  // Consumed once on mount.
  useEffect(() => {
    const st = location.state as { date?: string; view?: string } | null;
    if (!st?.date) return;
    pendingDateRef.current = new Date(st.date);
    const viewReq = st.view;
    if (viewReq === 'Day' || viewReq === 'Week' || viewReq === 'Month' || viewReq === 'Agenda') {
      nav.setView(viewReq);
    } else {
      // Same view; trigger the apply effect manually
      const api = calRef.current?.getApi();
      if (api) {
        api.gotoDate(pendingDateRef.current);
        nav.setDateLabel(api.view.title);
        pendingDateRef.current = null;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleYearDayClick = useCallback((date: Date) => {
    pendingDateRef.current = date;
    nav.setView('Day');
  }, [nav]);

  const handleYearMonthClick = useCallback((date: Date) => {
    pendingDateRef.current = date;
    nav.setView('Month');
  }, [nav]);

  // WS4 #10 — mini-calendar: single click moves the anchor date without
  // changing the view type; double-click drops into Day view.
  const handleMiniPick = useCallback((date: Date) => {
    if (nav.view === 'Year') {
      pendingDateRef.current = date;
      nav.setView('Month');
      return;
    }
    const api = calRef.current?.getApi();
    if (api) {
      api.gotoDate(date);
      nav.setDateLabel(api.view.title);
      setMiniAnchor(api.view.currentStart);
    }
  }, [nav]);

  const handleMiniPickDay = useCallback((date: Date) => {
    pendingDateRef.current = date;
    nav.setView('Day');
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

  // ── Missed events ────────────────────────────────────────────────
  const handleRecoverReschedule = useCallback((ev: Event, suggestedStart: string | null, suggestedEnd: string | null) => {
    pendingMissedRecovery = true;
    openEventEditor(ev, undefined, undefined, suggestedStart ?? undefined, suggestedEnd ?? undefined);
  }, [openEventEditor]);

  const handleOpenMissed = useCallback(() => {
    openMissedEvents(missedItems, missedTruncated, handleRecoverReschedule);
  }, [openMissedEvents, missedItems, missedTruncated, handleRecoverReschedule]);

  // Initial mount fetch of the missed list (drives the sidebar count).
  useEffect(() => {
    let cancelled = false;
    getMissedEvents()
      .then(({ items, truncated }) => {
        if (cancelled) return;
        setMissedItems(items);
        setMissedTruncated(truncated);
      })
      .catch(() => { /* silently ignore — sidebar shows empty state */ });
    return () => { cancelled = true; };
  }, []);

  // Missed-recovery re-open. The page no longer remounts on save (WS3 #8), so
  // both the save and cancel paths converge here: when the editor closes with a
  // recovery in flight, fetch the *fresh* missed list (the saved event's
  // missed_at was auto-cleared, so it drops out) and re-open the modal. The
  // pendingMissedRecovery flag's set/consume semantics are unchanged.
  useEffect(() => {
    const prev = prevModalNameRef.current;
    prevModalNameRef.current = modal.name;
    if (prev === 'event-editor' && modal.name === null && pendingMissedRecovery) {
      pendingMissedRecovery = false;
      getMissedEvents()
        .then(({ items, truncated }) => {
          setMissedItems(items);
          setMissedTruncated(truncated);
          if (items.length > 0) {
            openMissedEvents(items, truncated, handleRecoverReschedule);
          }
        })
        .catch(() => { /* silently ignore */ });
    }
  }, [modal.name, openMissedEvents, handleRecoverReschedule]);

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
      } else if (!TIME_GRID.has(viewType) && wheelNavEnabled) {
        // Plain scroll on month/agenda/list: navigate prev/next period
        e.preventDefault();
        if (e.deltaY > 0) {
          api.next();
        } else {
          api.prev();
        }
        nav.setDateLabel(api.view.title);
      } else {
        // Time-grid views (native hour scrolling) or wheel-nav disabled.
        return;
      }

      // WS3 #10 — one period per gesture; 250ms lockout beats 150ms's overshoot.
      wheelTimerRef.current = setTimeout(() => { wheelTimerRef.current = null; }, 250);
    };

    el.addEventListener('wheel', handler, { passive: false });
    return () => {
      el.removeEventListener('wheel', handler);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    };
  }, [nav, wheelNavEnabled]);

  // Clear any pending peek show/hide timers on unmount.
  useEffect(() => () => {
    if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    if (peekHideTimerRef.current) clearTimeout(peekHideTimerRef.current);
  }, []);

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

  // Class-day journal prompts (lectures, labs, office hours)
  const [activeTakeaway, setActiveTakeaway] = useState<EndedOccurrence | null>(null);
  const handleEnded = useCallback((occ: EndedOccurrence) => {
    setActiveTakeaway((current) => current ?? occ);
  }, []);
  useEventEndPrompts(events, handleEnded);

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
    if (arg.event.extendedProps.isPrepBlock) { arg.revert(); return; }
    const ev: Event = arg.event.extendedProps.event;
    const prevStart = arg.oldEvent.start!;
    const prevEnd   = arg.oldEvent.end ?? new Date(prevStart.getTime() + 3_600_000);
    const newStart  = arg.event.start!;
    const newEnd    = arg.event.end ?? new Date(newStart.getTime() + (prevEnd.getTime() - prevStart.getTime()));

    // WS3 #6 — ⌥/Alt-drag duplicates: leave the original in place and create a
    // copy at the drop time (macOS muscle memory).
    if ((arg.jsEvent as MouseEvent | undefined)?.altKey) {
      arg.revert();
      const { id: _oldId, ...base } = ev;
      const copyPayload = { ...base, start_time: newStart.toISOString(), end_time: newEnd.toISOString() };
      try {
        const { event: created } = await createEvent(copyPayload);
        pushUndo({
          label: `Duplicate "${ev.title}"`,
          undo: async () => { await deleteEvent(created.id); await loadAll(); },
          redo: async () => { /* re-create not directly reversible */ },
        });
        await loadAll();
      } catch {
        addNotification({ type: 'error', title: 'Duplicate failed', message: 'Could not copy event.' });
      }
      return;
    }

    const payload = { ...ev, start_time: newStart.toISOString(), end_time: newEnd.toISOString() };
    const revert  = { ...ev, start_time: prevStart.toISOString(), end_time: prevEnd.toISOString() };

    try {
      // Optimistic: FC already moved the pill. Persist, then record undo — a
      // failed PUT reverts and pushes no undo entry (WS3 #9).
      await updateEvent(ev.id, payload);
      pushUndo({
        label: `Move "${ev.title}"`,
        undo: async () => { await updateEvent(ev.id, revert); await loadAll(); },
        redo: async () => { await updateEvent(ev.id, payload); await loadAll(); },
      });
      await loadAll();
      const sw = checkSleepWindow(payload.start_time, payload.end_time, !!ev.is_all_day);
      if (sw) {
        addNotification({
          type: 'warning',
          title: 'Past sleep window',
          message: sw.message,
          collapseKey: 'sleep-window',
          autoRemoveMs: 6000,
        });
      }
    } catch {
      arg.revert();
      addNotification({ type: 'error', title: 'Move failed', message: 'Could not update event.' });
    }
  }, [pushUndo, loadAll, addNotification]);

  // ---- Drag shader callbacks (Phase 2) ----
  const handleEventDragStart = useCallback((arg: EventDragStartArg) => {
    // WS3 #5 — dim the source occurrence so it reads as a "ghost at origin".
    const el = arg.el as HTMLElement | undefined;
    if (el) { el.classList.add('loom-drag-source'); dragSourceElRef.current = el; }
    if (!dragShaderEnabled) return;
    const ev = arg.event.extendedProps.event as Event;
    const start = arg.event.start ?? new Date();
    const end   = arg.event.end   ?? new Date(start.getTime() + 3_600_000);
    setDragging({ id: ev.id, fcId: arg.event.id, start, end });
  }, [dragShaderEnabled]);

  const handleEventDragStop = useCallback((_arg: EventDragStartArg) => {
    dragSourceElRef.current?.classList.remove('loom-drag-source');
    dragSourceElRef.current = null;
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
    setDragging({ id: ev.id, fcId: arg.event.id, start, end });
  }, [dragShaderEnabled]);

  const handleResizeStop = useCallback((_arg: EventResizeStartArg) => {
    setDragging(null);
  }, []);

  const handleEventResize = useCallback(async (arg: EventResizeDoneArg) => {
    if (arg.event.extendedProps.isPrepBlock) { arg.revert(); return; }
    const ev: Event = arg.event.extendedProps.event;
    const prevEnd  = arg.oldEvent.end!;
    const newEnd   = arg.event.end!;

    try {
      await updateEvent(ev.id, { ...ev, end_time: newEnd.toISOString() });
      pushUndo({
        label: `Resize "${ev.title}"`,
        undo: async () => { await updateEvent(ev.id, { ...ev, end_time: prevEnd.toISOString() }); await loadAll(); },
        redo: async () => { await updateEvent(ev.id, { ...ev, end_time: newEnd.toISOString() });  await loadAll(); },
      });
      await loadAll();
      const sw = checkSleepWindow(ev.start_time, newEnd.toISOString(), !!ev.is_all_day);
      if (sw) {
        addNotification({
          type: 'warning',
          title: 'Past sleep window',
          message: sw.message,
          collapseKey: 'sleep-window',
          autoRemoveMs: 6000,
        });
      }
    } catch {
      arg.revert();
      addNotification({ type: 'error', title: 'Resize failed', message: 'Could not update event.' });
    }
  }, [pushUndo, loadAll, addNotification]);

  // Hover-grace helpers (WS5 #1): don't drop a passive peek the instant the
  // cursor leaves the pill — give ~500ms so the user can move onto the card.
  const cancelPeekHide = useCallback(() => {
    if (peekHideTimerRef.current) { clearTimeout(peekHideTimerRef.current); peekHideTimerRef.current = null; }
  }, []);
  const schedulePeekHide = useCallback(() => {
    cancelPeekHide();
    peekHideTimerRef.current = setTimeout(() => {
      setPeek(prev => (prev && prev.pinned ? prev : null));
    }, 500);
  }, [cancelPeekHide]);

  const closePeek = useCallback(() => {
    cancelPeekHide();
    if (peekTimerRef.current) { clearTimeout(peekTimerRef.current); peekTimerRef.current = null; }
    setPeek(prev => {
      // Return focus to the originating pill on an explicit close (Esc / Close).
      const el = prev?.anchorEl;
      if (el && document.contains(el)) { el.setAttribute('tabindex', '-1'); el.focus(); }
      return null;
    });
  }, [cancelPeekHide]);

  const handleEventClick = useCallback((arg: EventClickArg) => {
    const fcId = arg.event.id;
    const ev: Event = arg.event.extendedProps.event;
    const now = Date.now();
    const el = arg.el as HTMLElement;
    const rect = el.getBoundingClientRect();

    // Double-click (same occurrence within 350ms) opens the editor. Single click
    // selects immediately — no artificial delay (WS3 #2).
    if (lastClickedIdRef.current === fcId && now - lastClickTimeRef.current < 350) {
      lastClickedIdRef.current = null;
      lastClickTimeRef.current = 0;
      cancelPeekHide();
      setPeek(null);
      const instanceDate: string | undefined = arg.event.extendedProps.instanceDate;
      openEventEditor(ev, undefined, instanceDate);
      return;
    }

    lastClickedIdRef.current = fcId;
    lastClickTimeRef.current = now;
    setQuickCreate(null);
    const isModifier = arg.jsEvent.shiftKey || arg.jsEvent.metaKey || arg.jsEvent.ctrlKey;
    setSelectedEventIds(prev => {
      const next = new Set(prev);
      if (isModifier) {
        if (next.has(ev.id)) next.delete(ev.id); else next.add(ev.id);
      } else {
        if (next.has(ev.id) && next.size === 1) next.clear(); else { next.clear(); next.add(ev.id); }
      }
      return next;
    });

    // WS5 #1 — a plain single click pins an interactive peek to the clicked
    // event; clicking the same pinned event again (a de-select) closes it.
    // Modifier clicks are multi-select and carry no single-event peek.
    cancelPeekHide();
    if (isModifier) {
      setPeek(null);
    } else {
      setPeek(prev =>
        prev && prev.pinned && prev.event.id === ev.id
          ? null
          : { event: ev, x: rect.right, y: rect.top, pinned: true, keyboard: false, anchorEl: el });
    }
  }, [openEventEditor, cancelPeekHide]);

  const handleMouseEnter = useCallback((arg: EventHoveringArg) => {
    if (window.matchMedia('(hover: none)').matches) return;
    cancelPeekHide();
    // A pinned peek is a deliberate focus — don't let a stray hover replace it.
    let pinnedOpen = false;
    setPeek(prev => { pinnedOpen = !!(prev && prev.pinned); return prev; });
    if (pinnedOpen) return;
    if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    peekTimerRef.current = setTimeout(() => {
      const ev: Event = arg.event.extendedProps.event;
      const rect = (arg.el as HTMLElement).getBoundingClientRect();
      setPeek(prev => (prev && prev.pinned)
        ? prev
        : { event: ev, x: rect.right, y: rect.top, pinned: false, keyboard: false, anchorEl: arg.el as HTMLElement });
    }, 300);
  }, [cancelPeekHide]);

  const handleMouseLeave = useCallback(() => {
    if (peekTimerRef.current) { clearTimeout(peekTimerRef.current); peekTimerRef.current = null; }
    schedulePeekHide();
  }, [schedulePeekHide]);

  // ---- Pinned-peek actions (WS5 #1) ----
  const handlePeekEdit = useCallback((ev: Event) => {
    closePeek();
    openEventEditor(ev);
  }, [closePeek, openEventEditor]);

  const handlePeekDuplicate = useCallback(async (ev: Event) => {
    closePeek();
    const { id: _oldId, ...base } = ev;
    try {
      const { event: created } = await createEvent(base);
      pushUndo({
        label: `Duplicate "${ev.title}"`,
        undo: async () => { await deleteEvent(created.id); await loadAll(); },
        redo: async () => { /* re-create not directly reversible */ },
      });
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Duplicate failed', message: 'Could not copy event.' });
    }
  }, [closePeek, pushUndo, loadAll, addNotification]);

  const handlePeekDelete = useCallback(async (ev: Event) => {
    closePeek();
    const snapshot = { ...ev };
    try {
      await deleteEvent(ev.id);
      pushUndo({
        label: `Delete "${ev.title}"`,
        undo: async () => { const { id: _id, ...p } = snapshot; await createEvent(p); await loadAll(); },
        redo: async () => { await deleteEvent(ev.id); await loadAll(); },
      });
      addNotification({ type: 'success', title: `Deleted "${ev.title}"`, message: 'Undo from the toolbar or ⌘Z.', autoRemoveMs: 6000 });
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Delete failed', message: 'Could not delete event.' });
    }
  }, [closePeek, pushUndo, loadAll, addNotification]);

  const handlePeekChecklistToggle = useCallback(async (ev: Event, index: number) => {
    const items = parseChecklist(ev.checklist);
    if (index < 0 || index >= items.length) return;
    const next = items.map((it, i) => i === index ? { ...it, done: !it.done } : it);
    const nextJson = JSON.stringify(next.map(({ text, done, isReading }) => isReading ? { text, done, isReading } : { text, done }));
    const updated: Event = { ...ev, checklist: nextJson };
    // Optimistically reflect the toggle in the open peek.
    setPeek(prev => (prev && prev.event.id === ev.id ? { ...prev, event: updated } : prev));
    try {
      await updateEvent(ev.id, { checklist: nextJson });
      await loadAll();
    } catch {
      setPeek(prev => (prev && prev.event.id === ev.id ? { ...prev, event: ev } : prev));
      addNotification({ type: 'error', title: 'Update failed', message: 'Could not save the checklist.' });
    }
  }, [loadAll, addNotification]);

  // WS3 #1 — a drag (or click) on the empty grid opens the quick-create popover
  // anchored to the selection rect, rather than jumping straight to the full
  // 560px editor. The DragShader selection tint clears here; the popover renders
  // over the (persisted) selection mirror.
  const handleSelect = useCallback((arg: DateSelectArg) => {
    setSelectRange(null);

    // Anchor to the union of the selection-highlight cells; fall back to the
    // pointer position when the highlight isn't in the DOM.
    let anchor: QuickCreateAnchor | null = null;
    const els = document.querySelectorAll('.fc-highlight');
    if (els.length) {
      let top = Infinity, left = Infinity, bottom = -Infinity, right = -Infinity;
      els.forEach(el => {
        const r = el.getBoundingClientRect();
        top = Math.min(top, r.top); left = Math.min(left, r.left);
        bottom = Math.max(bottom, r.bottom); right = Math.max(right, r.right);
      });
      anchor = { top, left, bottom, right };
    } else if (arg.jsEvent) {
      const x = (arg.jsEvent as MouseEvent).clientX;
      const y = (arg.jsEvent as MouseEvent).clientY;
      anchor = { top: y, left: x, bottom: y, right: x };
    }
    if (!anchor) { calRef.current?.getApi().unselect(); return; }

    setSelectedEventIds(new Set());
    setPeek(null);
    setQuickCreate({ start: arg.start, end: arg.end, allDay: arg.allDay, anchor });
  }, []);

  const discardQuickCreate = useCallback(() => {
    setQuickCreate(null);
    calRef.current?.getApi().unselect();
  }, []);

  const buildQuickPayload = useCallback((title: string, calendarId: number, start: Date, end: Date, allDay: boolean): EventCreate => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    return {
      title,
      start_time: allDay ? `${dateStr}T00:00:00` : start.toISOString(),
      end_time:   allDay ? `${dateStr}T23:59:00` : end.toISOString(),
      calendar_id: calendarId,
      is_recurring: false, recurrence_days: '', recurrence_end: '',
      description: '', unique_description: '', reminder_minutes: 0,
      external_uid: '', timezone: 'local', is_all_day: allDay,
      skipped_dates: '', per_day_times: '', checklist: '',
    };
  }, []);

  const handleQuickCreateSubmit = useCallback(async (title: string, calendarId: number, end: Date) => {
    if (!quickCreate) return;
    localStorage.setItem('loom_last_timeline', String(calendarId));
    const payload = buildQuickPayload(title, calendarId, quickCreate.start, end, quickCreate.allDay);
    try {
      const { event: created } = await createEvent(payload);
      pushUndo({
        label: `Create "${title}"`,
        undo: async () => { await deleteEvent(created.id); await loadAll(); },
        redo: async () => { /* re-create not directly reversible */ },
      });
      setQuickCreate(null);
      calRef.current?.getApi().unselect();
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Could not create event', message: title });
    }
  }, [quickCreate, buildQuickPayload, pushUndo, loadAll, addNotification]);

  const handleQuickCreateMore = useCallback((title: string, calendarId: number, end: Date) => {
    if (!quickCreate) return;
    localStorage.setItem('loom_last_timeline', String(calendarId));
    const start = quickCreate.start;
    setQuickCreate(null);
    calRef.current?.getApi().unselect();
    openEventEditor(null, undefined, undefined, start.toISOString(), end.toISOString(), {
      title: title || undefined,
      calendarId,
    });
  }, [quickCreate, openEventEditor]);

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

  // ---- Snooze: shifts selected events forward by N days. Triggered via the
  // `loom-snooze-selected` window event from App.tsx's keyboard shortcuts.
  const snoozeSelected = useCallback(async (days: number) => {
    if (selectedEventIds.size === 0) {
      addNotification({ type: 'info', title: 'Nothing selected', message: 'Click an event first to snooze it.', autoRemoveMs: 2500 });
      return;
    }
    const ids = [...selectedEventIds];
    const targets = events.filter(e => ids.includes(e.id));
    if (targets.length === 0) return;

    const shiftMs = days * 24 * 60 * 60 * 1000;
    const updates = targets.map(ev => {
      const newStart = new Date(new Date(ev.start_time).getTime() + shiftMs).toISOString();
      const newEnd   = new Date(new Date(ev.end_time).getTime()   + shiftMs).toISOString();
      return { ev, payload: { ...ev, start_time: newStart, end_time: newEnd } };
    });

    pushUndo({
      label: `Snooze ${ids.length} event(s) ${days > 0 ? `+${days}d` : `${days}d`}`,
      undo: async () => {
        for (const { ev } of updates) await updateEvent(ev.id, ev);
        await loadAll();
      },
      redo: async () => {
        for (const { ev, payload } of updates) await updateEvent(ev.id, payload);
        await loadAll();
      },
    });

    try {
      for (const { ev, payload } of updates) await updateEvent(ev.id, payload);
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Snooze failed', message: 'Could not update events.' });
    }
  }, [selectedEventIds, events, pushUndo, loadAll, addNotification]);

  useEffect(() => {
    const handler = (e: globalThis.Event) => {
      const detail = (e as CustomEvent<{ days: number }>).detail;
      if (detail) void snoozeSelected(detail.days);
    };
    window.addEventListener('loom-snooze-selected', handler as EventListener);
    return () => window.removeEventListener('loom-snooze-selected', handler as EventListener);
  }, [snoozeSelected]);

  // Pattern-based suggestion: bucket the trailing 8 weeks by (weekday, 2h slot).
  // If a recurring slot has ≥5 occurrences and the matching slot in the next 7
  // days is empty, suggest blocking it. One per session, gated by sessionStorage.
  useEffect(() => {
    if (events.length === 0) return;
    if (sessionStorage.getItem('loom_pattern_suggested') === '1') return;

    const now = new Date();
    const eightWeeksAgo = new Date(now.getTime() - 8 * 7 * 86_400_000);
    const buckets = new Map<string, { count: number; weekday: number; bin: number; sample: string }>();

    for (const ev of events) {
      const d = new Date(ev.start_time);
      if (isNaN(d.getTime()) || d < eightWeeksAgo || d > now) continue;
      const wd  = d.getDay();
      const bin = Math.floor(d.getHours() / 2) * 2;
      const key = `${wd}:${bin}`;
      const existing = buckets.get(key);
      if (existing) existing.count++;
      else buckets.set(key, { count: 1, weekday: wd, bin, sample: ev.title });
    }

    // Find the next 7 days' usage — skip if a slot is already filled
    const upcoming = new Set<string>();
    const sevenDaysOut = new Date(now.getTime() + 7 * 86_400_000);
    for (const ev of events) {
      const d = new Date(ev.start_time);
      if (isNaN(d.getTime()) || d < now || d > sevenDaysOut) continue;
      upcoming.add(`${d.getDay()}:${Math.floor(d.getHours() / 2) * 2}`);
    }

    // Score: prefer most-used unfilled slot
    const candidates = [...buckets.values()]
      .filter(b => b.count >= 5 && !upcoming.has(`${b.weekday}:${b.bin}`))
      .sort((a, b) => b.count - a.count);
    if (candidates.length === 0) return;

    const top = candidates[0];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const startStr = `${String(top.bin).padStart(2, '0')}:00`;
    const endStr   = `${String(top.bin + 2).padStart(2, '0')}:00`;
    const dayName  = dayNames[top.weekday];

    sessionStorage.setItem('loom_pattern_suggested', '1');

    // Find next occurrence of that weekday at that hour
    const nextDate = new Date(now);
    const daysUntil = (top.weekday - now.getDay() + 7) % 7 || 7;
    nextDate.setDate(now.getDate() + daysUntil);
    nextDate.setHours(top.bin, 0, 0, 0);
    const nextEnd = new Date(nextDate.getTime() + 2 * 3_600_000);

    addNotification({
      type: 'info',
      title: `${dayName} ${startStr}–${endStr} is normally busy`,
      message: `You usually have something here (${top.count}× in last 8 weeks). Block it this week?`,
      actionable: true,
      actionLabel: 'Block it',
      actionFn: () => openEventEditor(null, undefined, undefined, nextDate.toISOString(), nextEnd.toISOString()),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  // ---- Timeline actions ----
  // WS3 #11 — open the themed timeline editor in create mode instead of a raw
  // window.prompt.
  const handleNewTimeline = useCallback(() => {
    openTimelineEditor();
  }, [openTimelineEditor]);

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

  // WS3 #3 — templates are quick-create accelerators: pre-fill the editor from
  // the template (title, duration → now-rounded-to-next-15, recurrence, timeline)
  // instead of discarding it.
  const handleApplyTemplate = useCallback((t: EventTemplate) => {
    const ms = 15 * 60_000;
    const start = new Date(Math.ceil(Date.now() / ms) * ms);
    const end = new Date(start.getTime() + (t.duration_minutes || 60) * 60_000);
    openEventEditor(null, undefined, undefined, start.toISOString(), end.toISOString(), {
      title: t.title,
      calendarId: t.calendar_id || undefined,
      isRecurring: t.is_recurring,
      recurrenceDays: t.recurrence_days,
    });
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

  // ---- Keyboard shortcuts (WS4 #2) ----
  // The calendar's keys now live in the single central registry (App/Shell +
  // keybindConfig). New-event / today / prev / next / search dispatch through
  // CalendarNavContext; delete arrives as a window event (like snooze) and
  // Escape-to-clear-selection sits at the BOTTOM of the shared escape stack so
  // it only fires once nothing more specific (modal, popover, palette) is open.
  const selectedIdsRef = useRef(selectedEventIds);
  useEffect(() => { selectedIdsRef.current = selectedEventIds; }, [selectedEventIds]);
  useEffect(() => pushEscapeHandler(() => {
    if (selectedIdsRef.current.size === 0) return false; // fall through
    setSelectedEventIds(new Set());
  }), []);

  useEffect(() => {
    const handler = () => void bulkDelete();
    window.addEventListener('loom-delete-selected', handler);
    return () => window.removeEventListener('loom-delete-selected', handler);
  }, [bulkDelete]);

  // WS4 #9 — jump-to-date from the TopBar overlay navigates the live calendar
  // while preserving the current view.
  useEffect(() => {
    const handler = (e: globalThis.Event) => {
      const detail = (e as CustomEvent<{ date: string }>).detail;
      if (!detail?.date) return;
      const d = new Date(detail.date);
      if (isNaN(d.getTime())) return;
      if (nav.view === 'Year') { pendingDateRef.current = d; nav.setView('Month'); return; }
      const api = calRef.current?.getApi();
      if (api) { api.gotoDate(d); nav.setDateLabel(api.view.title); setMiniAnchor(api.view.currentStart); }
    };
    window.addEventListener('loom-jump-date', handler as EventListener);
    return () => window.removeEventListener('loom-jump-date', handler as EventListener);
  }, [nav]);

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
        missedCount={missedItems.length}
        onOpenMissed={handleOpenMissed}
        events={events}
        miniAnchor={miniAnchor}
        miniRangeStart={miniRange?.start ?? null}
        miniRangeEnd={miniRange?.end ?? null}
        onMiniPick={handleMiniPick}
        onMiniPickDay={handleMiniPickDay}
      />

      <div ref={mainRef} className={styles.main}>
        {nav.view === 'Year' && (
          <YearView
            events={events}
            timelines={timelines}
            onDayClick={handleYearDayClick}
            onMonthClick={handleYearMonthClick}
            onEventClick={(eid) => {
              const ev = events.find(e => e.id === eid);
              if (ev) openEventEditor(ev);
            }}
          />
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
          snapDuration="00:15:00"
          eventDragMinDistance={5}
          dragRevertDuration={200}
          slotEventOverlap={false}
          nowIndicator={true}
          dayMaxEvents={true}
          moreLinkClick="popover"
          defaultTimedEventDuration="00:30:00"
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
          datesSet={info => {
            nav.setDateLabel(info.view.title);
            setQuickCreate(null);
            setMiniAnchor(info.view.currentStart);
            setMiniRange({ start: info.start, end: info.end });
          }}
          eventClassNames={arg => {
            const ev: Event = arg.event.extendedProps.event;
            const classes: string[] = [];
            if (selectedEventIds.has(ev.id)) classes.push('loom-event-selected');
            // Dim occurrences whose end is in the past (per-occurrence — uses the
            // FC event's own end, so a single recurring row dims only its
            // elapsed instances).
            if (dimPast && arg.event.end && arg.event.end.getTime() < Date.now()) {
              classes.push('loom-event-past');
            }
            return classes;
          }}
        />

        {dragShaderEnabled && (
          <DragShader dragging={dragging} selectRange={selectRange} fcEvents={fcEvents} />
        )}
        <TodayLineFreshness view={nav.view} />

        {nav.view === 'Month' && lastSync && events.length === 0 && !emptyDismissed && (
          <div className={styles.emptyOverlay}>
            <div className={styles.emptyCard}>
              <p className={styles.emptyText}>
                Drag on the grid or press <kbd className={styles.emptyKbd}>N</kbd> to create your first event.
              </p>
              <button className="loom-btn-ghost" onClick={() => setEmptyDismissed(true)}>
                Got it
              </button>
            </div>
          </div>
        )}

        {peek && (
          <QuickPeek
            event={peek.event}
            timelines={timelines}
            anchorX={peek.x}
            anchorY={peek.y}
            pinned={peek.pinned}
            keyboardOpen={peek.keyboard}
            onClose={closePeek}
            onEdit={handlePeekEdit}
            onDuplicate={handlePeekDuplicate}
            onDelete={handlePeekDelete}
            onChecklistToggle={idx => void handlePeekChecklistToggle(peek.event, idx)}
            onHoverEnter={cancelPeekHide}
            onHoverLeave={schedulePeekHide}
          />
        )}

        {quickCreate && timelines.length > 0 && (
          <QuickCreatePopover
            start={quickCreate.start}
            end={quickCreate.end}
            allDay={quickCreate.allDay}
            anchor={quickCreate.anchor}
            timelines={timelines}
            templates={templates}
            defaultTimelineId={
              (() => {
                const last = Number(localStorage.getItem('loom_last_timeline'));
                return timelines.some(t => t.id === last) ? last : (timelines[0]?.id ?? 0);
              })()
            }
            onSubmit={handleQuickCreateSubmit}
            onMoreOptions={handleQuickCreateMore}
            onDiscard={discardQuickCreate}
          />
        )}
        </div>

        <SelectionBar
          count={selectedEventIds.size}
          onDelete={() => void bulkDelete()}
          onSnoozeDay={() => void snoozeSelected(1)}
          onSnoozeWeek={() => void snoozeSelected(7)}
          onClear={() => setSelectedEventIds(new Set())}
        />
        <WarningStack>
          {examClusterWarning && !isClusterDismissed(getClusterEventIds(examClusterWarning)) && (
            <ExamClusterBanner
              warning={examClusterWarning}
              onDismiss={() => {
                markClusterDismissed(getClusterEventIds(examClusterWarning));
                setExamClusterWarning(null);
              }}
            />
          )}
          {wellness && (
            <WellnessToast date={wellness.date} message={wellness.message} />
          )}
          {activeTakeaway && (
            <TakeawayToast
              key={`${activeTakeaway.event.id}:${activeTakeaway.occurrenceDate}`}
              event={activeTakeaway.event}
              occurrenceDate={activeTakeaway.occurrenceDate}
              onClose={() => setActiveTakeaway(null)}
            />
          )}
          {radar
            .filter(w => radarDismissed[w.assignment_id] !== w.due_date)
            .map(w => (
              <ProcrastinationToast
                key={w.assignment_id}
                warning={w}
                onDismiss={() => {
                  dismissRadar(w.assignment_id, w.due_date);
                  setRadarDismissed(prev => ({ ...prev, [w.assignment_id]: w.due_date }));
                }}
              />
            ))}
        </WarningStack>
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
