import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type {
  EventDropArg, EventClickArg, EventHoveringArg, DateSelectArg, EventContentArg, DateSpanApi, DayHeaderContentArg,
} from '@fullcalendar/core';
import type { EventResizeDoneArg, EventDragStartArg, EventResizeStartArg } from '@fullcalendar/interaction';
import styles from './CalendarPage.module.css';
import { Page, Button, IconButton, EmptyState, Icons, confirm } from '../components/ui';
import { CalendarSidebar } from '../components/calendar/CalendarSidebar';
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
import { useEventKeyNav } from '../hooks/useEventKeyNav';
import { useEventEndPrompts, type EndedOccurrence } from '../hooks/useEventEndPrompts';
import { useIsVisibleRef } from '../hooks/usePageVisibility';
import { TakeawayToast } from '../components/calendar/TakeawayToast';
import { buildFCEvents, parseChecklist, timelineColor } from '../lib/eventUtils';
import { relativeTime } from '../lib/time';
import {
  listEvents, createEvent, updateEvent, deleteEvent, clockEvent,
  listCalendars, createCalendar, updateCalendar, deleteCalendar,
  listTemplates, createTemplate, deleteTemplate,
  analyzeSchedule,
  detectExamClusters,
  getProcrastinationRadar,
  findFreeSlots,
  listTimeBlockTemplates,
  createTimeBlockTemplate,
  deleteTimeBlockTemplate,
  applyTimeBlockTemplate,
  getMissedEvents,
  exportTimelinesICS,
} from '../api';
import type { FreeSlot } from '../types';
import type {
  Event, Calendar, CalendarCreate, EventTemplate, EventCreate, TimeBlockTemplate, TimeBlockDef,
  ProcrastinationWarning, WellnessWarning,
} from '../types';
import { getDismissed, dismiss as dismissRadar } from '../lib/radarDismissals';
import { checkSleepWindow } from '../lib/sleepWindow';
import { useNotifications, buildMutationToast } from '../store/notifications';

// ---- FullCalendar view name map ----
const FC_VIEW: Record<string, string> = {
  Month: 'dayGridMonth', Week: 'timeGridWeek', Day: 'timeGridDay', Agenda: 'listWeek',
};

const PANEL_KEY = 'loom:panel:calendar';
// Localized short weekday names indexed by day-of-week (0 = Sunday).
// 2023-01-01 is a Sunday; local-midnight dates keep the label stable.
const WEEKDAY_SHORT: string[] = Array.from({ length: 7 }, (_, i) =>
  new Date(2023, 0, 1 + i).toLocaleDateString([], { weekday: 'short' }),
);
const EMPTY_DISMISS_KEY = 'loom_calendar_empty_dismissed';

// Module-level cache of the deadline-chip threshold (days). Read once at module
// load instead of on every EventPill render; refreshed when another window
// changes the setting via the `storage` event.
let deadlineChipDays = Number(localStorage.getItem('loom_deadline_chip_days') ?? 3);
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'loom_deadline_chip_days' || e.key === null) {
      deadlineChipDays = Number(localStorage.getItem('loom_deadline_chip_days') ?? 3);
    }
  });
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const localYMD = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'timelines';

// ---- EventPill rendered inside FullCalendar ----
// Anatomy: [time] [title] [chips]. The grid template in CalendarPage.module.css
// lays these out as one row (month / agenda / short events) or as title over
// time + chips (taller time-grid events). `--tl` is the only inline value.
function EventPill({ info, timelines }: { info: EventContentArg; timelines: Calendar[] }) {
  const ev: Event = info.event.extendedProps.event;
  const isPrepBlock = !!info.event.extendedProps.isPrepBlock;
  const color = timelineColor(timelines, ev.calendar_id);
  const checklist = parseChecklist(ev.checklist);
  const doneCount = checklist.filter(c => c.done).length;
  const isClockedIn = !!ev.actual_start && !ev.actual_end;
  const startStr = info.event.start && !info.event.allDay
    ? info.event.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

  const now = new Date();
  const start = info.event.start;
  let chipLabel = '';
  let isUrgent = false;
  if (!isPrepBlock && start && start > now) {
    const diffMs = start.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays <= deadlineChipDays) {
      isUrgent = diffDays <= 1;
      chipLabel = diffDays < 1
        ? `${Math.ceil(diffMs / 3_600_000)}h`
        : `${Math.ceil(diffDays)}d`;
    }
  }

  return (
    <div
      className={`${styles.pill}${isPrepBlock ? ` ${styles.prepPill}` : ''}`}
      style={{ '--tl': color } as React.CSSProperties}
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
      <span className={styles.pillTitle}>
        {isPrepBlock ? `Prep · ${ev.title}` : info.event.title}
      </span>
      <span className={styles.pillChips}>
        {!isPrepBlock && ev.travel_time_minutes && ev.travel_time_minutes > 0 ? (
          <span className={styles.travelChip} title={`${ev.travel_time_minutes} min travel buffer`}>→ {ev.travel_time_minutes}m</span>
        ) : null}
        {!isPrepBlock && checklist.length > 0 && (
          <span className={styles.pillChk}>{doneCount}/{checklist.length}</span>
        )}
        {!isPrepBlock && isClockedIn && <span className={styles.clockDot} aria-label="Tracking active" />}
        {chipLabel && (
          <span className={`${styles.deadlineChip}${isUrgent ? ` ${styles.deadlineChipUrgent}` : ''}`} title="Due soon">
            {chipLabel}
          </span>
        )}
      </span>
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
  const { push: pushUndo, undo: undoLast } = useUndo();
  const {
    openEventEditor, openAvailability, openICSImport, openSyllabus, openTimeBlockTemplate, openMissedEvents, openTimelineEditor, openTemplateManager, modal,
  } = useModal();
  const { addNotification } = useNotifications();

  // Data
  const [events, setEvents] = useState<Event[]>([]);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [timeBlockTemplates, setTimeBlockTemplates] = useState<TimeBlockTemplate[]>([]);
  const [hiddenTimelineIds, setHiddenTimelineIds] = useState<Set<number>>(new Set());
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [selectedEventIds, setSelectedEventIds] = useState<Set<number>>(new Set());
  // Mini-calendar anchor (period start), selected date (FC's current date) and
  // the main view's visible range (band).
  const [miniAnchor, setMiniAnchor] = useState<Date>(() => new Date());
  const [miniSelected, setMiniSelected] = useState<Date | null>(() => new Date());
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

  // Sync state — the label is derived on render; `syncTick` re-renders it every 30s.
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncStatus, setSyncStatus] = useState<'ok' | 'error'>('ok');
  const [, setSyncTick] = useState(0);
  const syncError = syncStatus === 'error';
  const syncLabel = syncError ? 'Sync failed' : lastSync ? `Synced ${relativeTime(lastSync)}` : 'Syncing…';

  // Year view cursor. Derived from FC's current date unless the user paged
  // years with the TopBar chevrons / wheel (override), which any FC navigation
  // clears again.
  const [yearOverride, setYearOverride] = useState<number | null>(null);
  const yearCursor = yearOverride ?? miniSelected?.getFullYear() ?? new Date().getFullYear();

  // Drag shader
  const [dragging, setDragging] = useState<DragState | null>(null);
  // Drag-to-select tint
  const [selectRange, setSelectRange] = useState<SelectRange | null>(null);
  const dragShaderEnabled = localStorage.getItem('loom_drag_shader_enabled') !== 'false';
  // Plain-scroll period paging is opt-out. Read once (route remounts).
  const wheelNavEnabled = localStorage.getItem('loom_wheel_nav') !== 'false';
  // Element dimmed as the drag "ghost at origin"; cleared on drag stop.
  const dragSourceElRef = useRef<HTMLElement | null>(null);

  // Quick-create popover anchored to the drag/click selection.
  const [quickCreate, setQuickCreate] = useState<
    { start: Date; end: Date; allDay: boolean; anchor: QuickCreateAnchor } | null
  >(null);

  // Past-event dimming (opt-out). Read once on mount so a Settings toggle
  // takes effect the next time the calendar is navigated to (this route
  // remounts), without a localStorage read per pill.
  const dimPast = useMemo(() => localStorage.getItem('loom_dim_past') !== 'false', []);

  // Empty-range overlay (dismissible for the session).
  const [emptyDismissed, setEmptyDismissed] = useState(() => sessionStorage.getItem(EMPTY_DISMISS_KEY) === '1');
  const dismissEmpty = useCallback(() => {
    sessionStorage.setItem(EMPTY_DISMISS_KEY, '1');
    setEmptyDismissed(true);
  }, []);

  // Weekend-wash toggle → body class the grid CSS keys off. Applied on mount
  // so it survives a boot where Settings was never opened.
  useEffect(() => {
    const washOn = localStorage.getItem('loom_weekend_wash') !== 'false';
    document.body.classList.toggle('loom-no-weekend-wash', !washOn);
  }, []);

  // QuickPeek state. A hover peek is passive; a single click pins an interactive
  // one. `anchorEl` is the originating pill — focus returns to it on Esc.
  const [peek, setPeek] = useState<
    { event: Event; x: number; y: number; pinned: boolean; keyboard: boolean; anchorEl: HTMLElement | null } | null
  >(null);
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peekHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Double-click detection (timestamp-based — no 200ms selection delay: a single
  // click selects immediately, a second within the window opens the editor).
  const lastClickTimeRef = useRef<number>(0);
  const lastClickedIdRef = useRef<string | null>(null);

  // Context panel collapse — persisted under loom:panel:calendar; the shell can
  // toggle it through the `loom-panel-toggle` window event.
  const [panelOpen, setPanelOpen] = useState<boolean>(() => localStorage.getItem(PANEL_KEY) !== 'closed');
  const togglePanel = useCallback(() => {
    setPanelOpen(prev => {
      const next = !prev;
      localStorage.setItem(PANEL_KEY, next ? 'open' : 'closed');
      return next;
    });
  }, []);
  useEffect(() => {
    const handler = (e: globalThis.Event) => {
      const page = (e as CustomEvent<{ page?: string }>).detail?.page;
      if (page && page !== 'calendar') return;
      togglePanel();
    };
    window.addEventListener('loom-panel-toggle', handler as EventListener);
    return () => window.removeEventListener('loom-panel-toggle', handler as EventListener);
  }, [togglePanel]);

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

      // Wellness analysis (run after first load). Splits the response: cluster
      // warnings → ExamClusterBanner; everything else → WellnessToast.
      // Subsequent mutations re-detect via the cheap /schedule/detect-clusters
      // endpoint (see effect below).
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

  useEffect(() => { void loadAll(true); }, [loadAll]);

  // Refresh the "missed" list state (panel count) without reopening any modal.
  const refreshMissedState = useCallback(async () => {
    try {
      const { items, truncated } = await getMissedEvents();
      setMissedItems(items);
      setMissedTruncated(truncated);
    } catch { /* silently ignore — panel shows empty state */ }
  }, []);

  // Register the imperative refetch. Save/voice paths call nav.reload()
  // instead of remounting the whole page (which discarded scroll/view/selection).
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

  // Sync label refresh every 30 seconds (only while the tab is visible), and
  // mirror it to the shell so the TopBar can show the same status.
  const syncLabelVisibleRef = useIsVisibleRef();
  useEffect(() => {
    const id = setInterval(() => {
      if (!syncLabelVisibleRef.current) return;
      setSyncTick(t => t + 1);
    }, 30_000);
    return () => clearInterval(id);
  }, [syncLabelVisibleRef]);

  // Mirror the panel's sync badge into the shell (TopBar) via CalendarNavContext.
  // Depend on the stable setter, never on the whole `nav` object: setting the
  // status re-creates that object, and a cleanup keyed on it would clear and
  // re-set the status on every render (an update loop through FullCalendar).
  const { setSyncStatus: pushSyncStatus } = nav;
  useEffect(() => {
    pushSyncStatus({ label: syncLabel, error: syncError });
  }, [pushSyncStatus, syncLabel, syncError]);
  useEffect(() => () => { pushSyncStatus(null); }, [pushSyncStatus]);

  // Wire the TopBar's nav actions. FullCalendar views hand the API through;
  // Year view (a custom component) pages the year cursor instead.
  useEffect(() => {
    const api = calRef.current?.getApi();
    if (nav.view === 'Year') {
      const cleanup = nav.registerActions({
        prev:       () => setYearOverride(y => (y ?? yearCursor) - 1),
        next:       () => setYearOverride(y => (y ?? yearCursor) + 1),
        today:      () => setYearOverride(new Date().getFullYear()),
        changeView: (v) => { if (api) { api.changeView(v); nav.setDateLabel(api.view.title); } },
      });
      nav.setDateLabel(String(yearCursor));
      return cleanup;
    }
    if (!api) return;
    const cleanup = nav.registerActions({
      prev:       () => { api.prev();  nav.setDateLabel(api.view.title); },
      next:       () => { api.next();  nav.setDateLabel(api.view.title); },
      today:      () => { api.today(); nav.setDateLabel(api.view.title); },
      changeView: (v) => { api.changeView(v); nav.setDateLabel(api.view.title); },
    });
    nav.setDateLabel(api.view.title);
    return cleanup;
  }, [nav, yearCursor]);

  // Sync view prop → FullCalendar
  useEffect(() => {
    const api = calRef.current?.getApi();
    if (!api) return;
    const fc = FC_VIEW[nav.view];
    if (fc && api.view.type !== fc) {
      api.changeView(fc);
      nav.setDateLabel(api.view.title);
    }
  }, [nav]);

  // When leaving Year view, apply any pending date navigation
  useEffect(() => {
    if (nav.view === 'Year' || !pendingDateRef.current) return;
    const api = calRef.current?.getApi();
    if (!api) return;
    api.gotoDate(pendingDateRef.current);
    nav.setDateLabel(api.view.title);
    pendingDateRef.current = null;
  }, [nav]);

  // Cross-page navigation bridge: Home hands off via route state `{ date, view }`.
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
    setYearOverride(null);
    nav.setView('Day');
  }, [nav]);

  const handleYearMonthClick = useCallback((date: Date) => {
    pendingDateRef.current = date;
    setYearOverride(null);
    nav.setView('Month');
  }, [nav]);

  // Mini-calendar: single click moves the anchor date without changing the view
  // type; double-click drops into Day view.
  const handleMiniPick = useCallback((date: Date) => {
    setYearOverride(null);
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
      setMiniSelected(date);
    }
  }, [nav]);

  const handleMiniPickDay = useCallback((date: Date) => {
    pendingDateRef.current = date;
    setYearOverride(null);
    nav.setView('Day');
  }, [nav]);

  const handleFindFreeSlots = useCallback(async (durationMins: number, workingStart: number, workingEnd: number): Promise<FreeSlot[]> => {
    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const result = await findFreeSlots({
      window_start: now.toISOString(),
      window_end: weekEnd.toISOString(),
      duration_minutes: durationMins,
      working_hours_start: workingStart,
      working_hours_end: workingEnd,
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

  // Initial mount fetch of the missed list (drives the panel count).
  useEffect(() => {
    let cancelled = false;
    getMissedEvents()
      .then(({ items, truncated }) => {
        if (cancelled) return;
        setMissedItems(items);
        setMissedTruncated(truncated);
      })
      .catch(() => { /* silently ignore — panel shows empty state */ });
    return () => { cancelled = true; };
  }, []);

  // Missed-recovery re-open. The page no longer remounts on save, so both the
  // save and cancel paths converge here: when the editor closes with a recovery
  // in flight, fetch the *fresh* missed list (the saved event's missed_at was
  // auto-cleared, so it drops out) and re-open the modal.
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
      // Year view owns its own wheel paging.
      if (nav.view === 'Year') return;

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

      // One period per gesture; 250ms lockout beats 150ms's overshoot.
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

  // Does the visible range hold any occurrence? Drives the empty-state overlay.
  const rangeHasEvents = useMemo(() => {
    if (nav.view === 'Year') {
      const y = String(yearCursor);
      return fcEvents.some(o => typeof o.start === 'string' && o.start.startsWith(y));
    }
    if (!miniRange) return true;
    const s = miniRange.start.getTime();
    const e = miniRange.end.getTime();
    return fcEvents.some(o => {
      const t = new Date(o.start as string).getTime();
      return !isNaN(t) && t >= s && t < e;
    });
  }, [fcEvents, miniRange, nav.view, yearCursor]);

  // Keyboard event navigation + move-mode. Roving focus over the mounted
  // occurrences (fed by eventDidMount/eventWillUnmount below); selecting syncs
  // the highlight, Enter opens the pinned keyboard peek.
  const { registerEl, unregisterEl } = useEventKeyNav({
    active: nav.view !== 'Year',
    calRef,
    onSelect: (id) => setSelectedEventIds(id == null ? new Set() : new Set([id])),
    onOpenPeek: (ev, el) => {
      const r = el.getBoundingClientRect();
      setPeek({ event: ev, x: r.right, y: r.top, pinned: true, keyboard: true, anchorEl: el });
    },
  });

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

    // Alt-drag duplicates: leave the original in place and create a copy at
    // the drop time.
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
      // failed PUT reverts and pushes no undo entry.
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

  // ---- Drag shader callbacks ----
  const handleEventDragStart = useCallback((arg: EventDragStartArg) => {
    // Dim the source occurrence so it reads as a "ghost at origin".
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

  // Hover-grace helpers: don't drop a passive peek the instant the cursor
  // leaves the pill — give ~500ms so the user can move onto the card.
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
    // selects immediately — no artificial delay.
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

    // A plain single click pins an interactive peek to the clicked event;
    // clicking the same pinned event again (a de-select) closes it. Modifier
    // clicks are multi-select and carry no single-event peek.
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

  // ---- Pinned-peek actions ----
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
      addNotification(buildMutationToast({ verb: 'Duplicated', object: ev.title, undo: undoLast }));
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Duplicate failed', message: 'Could not copy event.' });
    }
  }, [closePeek, pushUndo, undoLast, loadAll, addNotification]);

  const handlePeekDelete = useCallback(async (ev: Event) => {
    const ok = await confirm({
      title: `Delete "${ev.title}"?`,
      description: ev.is_recurring
        ? 'This removes every occurrence of the recurring event. You can undo from the toast.'
        : 'You can undo from the toast.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    closePeek();
    const snapshot = { ...ev };
    try {
      await deleteEvent(ev.id);
      pushUndo({
        label: `Delete "${ev.title}"`,
        undo: async () => { const { id: _id, ...p } = snapshot; await createEvent(p); await loadAll(); },
        redo: async () => { await deleteEvent(ev.id); await loadAll(); },
      });
      // The toast is a pointer into the undo stack: its Undo button pops the
      // top entry (the delete we just pushed).
      addNotification(buildMutationToast({ verb: 'Deleted', object: ev.title, undo: undoLast }));
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Delete failed', message: 'Could not delete event.' });
    }
  }, [closePeek, pushUndo, undoLast, loadAll, addNotification]);

  const handlePeekClockToggle = useCallback(async (ev: Event) => {
    const isIn = !!ev.actual_start && !ev.actual_end;
    try {
      const updated = await clockEvent(ev.id, isIn ? 'out' : 'in');
      setPeek(prev => (prev && prev.event.id === ev.id ? { ...prev, event: updated } : prev));
      addNotification({ type: 'success', title: isIn ? 'Clocked out' : 'Clocked in', message: ev.title, autoRemoveMs: 2500 });
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: isIn ? 'Clock out failed' : 'Clock in failed', message: 'Could not update tracking.' });
    }
  }, [loadAll, addNotification]);

  const handlePeekChecklistToggle = useCallback(async (ev: Event, index: number) => {
    const items = parseChecklist(ev.checklist);
    if (index < 0 || index >= items.length) return;
    const next = items.map((it, i) => i === index ? { ...it, done: !it.done } : it);
    const nextJson = JSON.stringify(next.map(({ text, done, isReading }) => isReading ? { text, done, isReading } : { text, done }));
    const updated: Event = { ...ev, checklist: nextJson };
    // Optimistically reflect the toggle in the open peek.
    setPeek(prev => (prev && prev.event.id === ev.id ? { ...prev, event: updated } : prev));
    try {
      // The backend PUT binds to EventBase (title/start/end/calendar_id all
      // required), so a partial `{ checklist }` body 422s. Send the full event.
      await updateEvent(ev.id, updated);
      await loadAll();
    } catch {
      setPeek(prev => (prev && prev.event.id === ev.id ? { ...prev, event: ev } : prev));
      addNotification({ type: 'error', title: 'Update failed', message: 'Could not save the checklist.' });
    }
  }, [loadAll, addNotification]);

  // A drag (or click) on the empty grid opens the quick-create popover
  // anchored to the selection rect, rather than jumping straight to the full
  // editor. The DragShader selection tint clears here; the popover renders
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
    const dateStr = localYMD(start);
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
  // current selection range so DragShader can tint conflicts.
  // Always returning true keeps the drag enabled.
  const handleSelectAllow = useCallback((arg: { start: Date; end: Date }) => {
    setSelectRange({ start: arg.start, end: arg.end });
    return true;
  }, []);

  const eventContent = useCallback((info: EventContentArg) => (
    <EventPill info={info} timelines={timelines} />
  ), [timelines]);

  // Column headers: weekday small caps + day number (accent disc on today).
  // Month view carries only the weekday.
  const dayHeaderContent = useCallback((arg: DayHeaderContentArg) => {
    // Use FC's day-of-week index, not `arg.date`: in month view the header
    // dates are UTC-midnight, so formatting them locally shifts the label a
    // day west of Greenwich (SAT above the Sunday column).
    const dow = WEEKDAY_SHORT[arg.dow] ?? arg.text;
    if (arg.view.type === 'dayGridMonth') {
      return <span className={styles.colDow}>{dow}</span>;
    }
    return (
      <>
        <span className={[styles.colDow, arg.isToday ? styles.colDowToday : ''].join(' ')}>{dow}</span>
        <span className={[styles.colNum, arg.isToday ? styles.colNumToday : ''].join(' ')}>{arg.date.getDate()}</span>
      </>
    );
  }, []);

  // ---- Bulk delete (SelectionBar / Delete key) ----
  const bulkDelete = useCallback(async () => {
    if (selectedEventIds.size === 0) return;
    const ids = [...selectedEventIds];
    const deleted = events.filter(e => ids.includes(e.id));
    const ok = await confirm({
      title: ids.length === 1 && deleted[0]
        ? `Delete "${deleted[0].title}"?`
        : `Delete ${ids.length} events?`,
      description: 'You can undo from the toast.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    pushUndo({
      label: `Delete ${ids.length} event(s)`,
      undo: async () => {
        for (const ev of deleted) {
          const { id: _id, ...payload } = ev;
          await createEvent(payload);
        }
        await loadAll();
      },
      redo: async () => { await Promise.all(ids.map(id => deleteEvent(id))); await loadAll(); },
    });
    try {
      await Promise.all(ids.map(id => deleteEvent(id)));
      setSelectedEventIds(new Set());
      setPeek(null);
      addNotification(buildMutationToast({
        verb: 'Deleted',
        object: ids.length === 1 && deleted[0] ? deleted[0].title : `${ids.length} events`,
        undo: undoLast,
      }));
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Delete failed', message: 'Some events could not be deleted.' });
    }
  }, [selectedEventIds, events, pushUndo, undoLast, loadAll, addNotification]);

  // ---- Snooze: shifts selected events forward by N days. Triggered via the
  // `loom-snooze-selected` window event from the shell's keyboard shortcuts.
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
    const startStr = `${pad2(top.bin)}:00`;
    const endStr   = `${pad2(top.bin + 2)}:00`;
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
  const handleNewTimeline = useCallback(() => {
    openTimelineEditor();
  }, [openTimelineEditor]);

  const handleEditTimeline = useCallback((id: number) => {
    openTimelineEditor(id);
  }, [openTimelineEditor]);

  const handleRenameTimeline = useCallback(async (id: number, name: string) => {
    const prev = timelines.find(t => t.id === id)?.name ?? '';
    try {
      await updateCalendar(id, { name });
      pushUndo({
        label: `Rename timeline to "${name}"`,
        undo: async () => { await updateCalendar(id, { name: prev }); await loadAll(); },
        redo: async () => { await updateCalendar(id, { name }); await loadAll(); },
      });
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Rename failed', message: `Could not rename "${prev}".` });
    }
  }, [timelines, pushUndo, loadAll, addNotification]);

  // Deleting a timeline cascades to its events on the backend, so the undo
  // snapshot carries both: re-create the timeline, then re-point every event
  // at the new id.
  const handleDeleteTimeline = useCallback(async (id: number) => {
    const tl = timelines.find(t => t.id === id);
    if (!tl) return;
    const affected = events.filter(e => e.calendar_id === id);
    const ok = await confirm({
      title: `Delete "${tl.name}"?`,
      description: affected.length > 0
        ? `This also deletes ${affected.length} event${affected.length === 1 ? '' : 's'} on this timeline. You can undo from the toast.`
        : 'You can undo from the toast.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;

    const snapshot: CalendarCreate = {
      name: tl.name, description: tl.description, color: tl.color,
      is_course: tl.is_course, course_code: tl.course_code, term_start: tl.term_start, term_end: tl.term_end,
    };
    let currentId = id;
    try {
      await deleteCalendar(id);
      pushUndo({
        label: `Delete timeline "${tl.name}"`,
        undo: async () => {
          const created = await createCalendar(snapshot);
          currentId = created.id;
          for (const ev of affected) {
            const { id: _evId, ...payload } = ev;
            await createEvent({ ...payload, calendar_id: created.id });
          }
          await loadAll();
        },
        redo: async () => { await deleteCalendar(currentId); await loadAll(); },
      });
      setHiddenTimelineIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev); next.delete(id); return next;
      });
      addNotification(buildMutationToast({ verb: 'Deleted', object: tl.name, undo: undoLast }));
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Delete failed', message: `Could not delete "${tl.name}".` });
    }
  }, [timelines, events, pushUndo, undoLast, loadAll, addNotification]);

  const exportICS = useCallback(async (ids: number[], label: string) => {
    if (ids.length === 0) {
      addNotification({ type: 'info', title: 'Nothing to export', message: 'Create a timeline first.', autoRemoveMs: 3000 });
      return;
    }
    try {
      const blob = await exportTimelinesICS(ids);
      downloadBlob(blob, `${slugify(label)}.ics`);
      addNotification({ type: 'success', title: 'Exported .ics', message: label, autoRemoveMs: 3000 });
    } catch {
      addNotification({ type: 'error', title: 'Export failed', message: 'Could not build the .ics file.' });
    }
  }, [addNotification]);

  const handleExportTimeline = useCallback((id: number) => {
    const tl = timelines.find(t => t.id === id);
    void exportICS([id], tl?.name ?? 'timeline');
  }, [timelines, exportICS]);

  // `loom-export-ics` (shell / command palette): export the given timeline, or
  // every timeline when no id is passed.
  useEffect(() => {
    const handler = (e: globalThis.Event) => {
      const detail = (e as CustomEvent<{ timelineId?: number }>).detail;
      if (detail?.timelineId != null) {
        const tl = timelines.find(t => t.id === detail.timelineId);
        void exportICS([detail.timelineId], tl?.name ?? 'timeline');
      } else {
        void exportICS(timelines.map(t => t.id), 'loom-timelines');
      }
    };
    window.addEventListener('loom-export-ics', handler as EventListener);
    return () => window.removeEventListener('loom-export-ics', handler as EventListener);
  }, [timelines, exportICS]);

  // Templates are quick-create accelerators: pre-fill the editor from the
  // template (title, duration → now-rounded-to-next-15, recurrence, timeline).
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

  const handleDeleteTemplate = useCallback(async (id: number) => {
    const t = templates.find(x => x.id === id);
    if (!t) return;
    const ok = await confirm({
      title: `Delete template "${t.name}"?`,
      description: 'Events created from it are not affected. You can undo from the toast.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    const { id: _tid, ...snapshot } = t;
    let currentId = id;
    try {
      await deleteTemplate(id);
      pushUndo({
        label: `Delete template "${t.name}"`,
        undo: async () => { const created = await createTemplate(snapshot); currentId = created.id; await loadAll(); },
        redo: async () => { await deleteTemplate(currentId); await loadAll(); },
      });
      addNotification(buildMutationToast({ verb: 'Deleted', object: t.name, undo: undoLast }));
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Delete failed', message: `Could not delete "${t.name}".` });
    }
  }, [templates, pushUndo, undoLast, loadAll, addNotification]);

  // ---- Time block template handlers ----
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
          start_time: `${pad2(start.getHours())}:${pad2(start.getMinutes())}`,
          end_time:   `${pad2(end.getHours())}:${pad2(end.getMinutes())}`,
          calendar_id: e.calendar_id,
        };
      });

    openTimeBlockTemplate(prefillBlocks);
  }, [events, openTimeBlockTemplate]);

  // Apply stamps the template onto the week currently shown in the calendar
  // (Monday of the week containing FC's current date), after a confirm.
  const handleApplyTimeBlockTemplate = useCallback(async (tplId: number) => {
    const tpl = timeBlockTemplates.find(t => t.id === tplId);
    if (!tpl) return;
    const base = calRef.current?.getApi()?.getDate() ?? new Date();
    const monday = new Date(base);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(base.getDate() - ((base.getDay() + 6) % 7));
    const weekMondayDate = localYMD(monday);
    const weekLabel = monday.toLocaleDateString([], { month: 'short', day: 'numeric' });

    const ok = await confirm({
      title: `Apply "${tpl.name}"?`,
      description: `Adds its blocks to the week of ${weekLabel} — the week shown in the calendar. You can undo this.`,
      confirmLabel: 'Apply',
    });
    if (!ok) return;

    try {
      const { applied_count, events: newEvents } = await applyTimeBlockTemplate(tplId, weekMondayDate);
      const ids = newEvents.map(e => e.id);
      pushUndo({
        label: `Apply time block template (${applied_count} block${applied_count !== 1 ? 's' : ''})`,
        undo: async () => { await Promise.all(ids.map(id => deleteEvent(id))); await loadAll(); },
        redo: async () => { await applyTimeBlockTemplate(tplId, weekMondayDate); await loadAll(); },
      });
      await loadAll();
      addNotification({ type: 'success', title: `${applied_count} block${applied_count !== 1 ? 's' : ''} added`, message: `Week of ${weekLabel}`, autoRemoveMs: 3000 });
    } catch {
      addNotification({ type: 'error', title: 'Apply failed', message: 'Could not stamp template onto week.', autoRemoveMs: 4000 });
    }
  }, [timeBlockTemplates, pushUndo, loadAll, addNotification]);

  const handleDeleteTimeBlockTemplate = useCallback(async (id: number) => {
    const tpl = timeBlockTemplates.find(t => t.id === id);
    if (!tpl) return;
    const ok = await confirm({
      title: `Delete template "${tpl.name}"?`,
      description: 'Blocks already on the calendar stay. You can undo from the toast.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    let blocks: TimeBlockDef[] = [];
    try { blocks = JSON.parse(tpl.blocks_json) as TimeBlockDef[]; } catch { blocks = []; }
    let currentId = id;
    try {
      await deleteTimeBlockTemplate(id);
      pushUndo({
        label: `Delete time block template "${tpl.name}"`,
        undo: async () => {
          const created = await createTimeBlockTemplate(tpl.name, tpl.description, blocks);
          currentId = created.id;
          await loadAll();
        },
        redo: async () => { await deleteTimeBlockTemplate(currentId); await loadAll(); },
      });
      addNotification(buildMutationToast({ verb: 'Deleted', object: tpl.name, undo: undoLast }));
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Delete failed', message: `Could not delete "${tpl.name}".` });
    }
  }, [timeBlockTemplates, pushUndo, undoLast, loadAll, addNotification]);

  // ---- Keyboard shortcuts ----
  // The calendar's keys live in the single central registry (App/Shell +
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

  // Jump-to-date from the TopBar overlay navigates the live calendar while
  // preserving the current view.
  useEffect(() => {
    const handler = (e: globalThis.Event) => {
      const detail = (e as CustomEvent<{ date: string }>).detail;
      if (!detail?.date) return;
      const d = new Date(detail.date);
      if (isNaN(d.getTime())) return;
      setYearOverride(null);
      if (nav.view === 'Year') { pendingDateRef.current = d; nav.setView('Month'); return; }
      const api = calRef.current?.getApi();
      if (api) {
        api.gotoDate(d);
        nav.setDateLabel(api.view.title);
        setMiniAnchor(api.view.currentStart);
        setMiniSelected(d);
      }
    };
    window.addEventListener('loom-jump-date', handler as EventListener);
    return () => window.removeEventListener('loom-jump-date', handler as EventListener);
  }, [nav]);

  const filtersHidingEvents = hiddenTimelineIds.size > 0 || activeFilters.size > 0;
  const emptyTitle =
    nav.view === 'Month' ? 'No events this month'
    : nav.view === 'Day' ? 'No events this day'
    : nav.view === 'Year' ? 'No events this year'
    : 'No events this week';
  const showEmpty = lastSync !== null && !emptyDismissed && !rangeHasEvents;

  const quickCreateDefaultTimeline = (() => {
    const last = Number(localStorage.getItem('loom_last_timeline'));
    return timelines.some(t => t.id === last) ? last : (timelines[0]?.id ?? 0);
  })();

  return (
    <Page bare>
      <CalendarSidebar
        open={panelOpen}
        onToggle={togglePanel}
        syncLabel={syncLabel}
        syncError={syncError}
        timelines={timelines}
        templates={templates}
        timeBlockTemplates={timeBlockTemplates}
        events={events}
        hiddenTimelineIds={hiddenTimelineIds}
        activeFilters={activeFilters}
        eventCountByTimeline={eventCountByTimeline}
        filterCounts={filterCounts}
        onToggleTimeline={toggleTimeline}
        onToggleFilter={toggleFilter}
        onNewTimeline={handleNewTimeline}
        onEditTimeline={handleEditTimeline}
        onRenameTimeline={handleRenameTimeline}
        onDeleteTimeline={handleDeleteTimeline}
        onExportTimeline={handleExportTimeline}
        onApplyTemplate={handleApplyTemplate}
        onDeleteTemplate={handleDeleteTemplate}
        onNewTimeBlockTemplate={handleNewTimeBlockTemplate}
        onManageTemplates={openTemplateManager}
        onApplyTimeBlockTemplate={handleApplyTimeBlockTemplate}
        onDeleteTimeBlockTemplate={handleDeleteTimeBlockTemplate}
        onFindFreeSlots={handleFindFreeSlots}
        onScheduleSlot={handleScheduleSlot}
        missedCount={missedItems.length}
        onOpenMissed={handleOpenMissed}
        onImportICS={openICSImport}
        onScanSyllabus={openSyllabus}
        onAvailability={openAvailability}
        miniAnchor={miniAnchor}
        miniSelected={miniSelected}
        miniRangeStart={miniRange?.start ?? null}
        miniRangeEnd={miniRange?.end ?? null}
        onMiniPick={handleMiniPick}
        onMiniPickDay={handleMiniPickDay}
      />

      <div ref={mainRef} className={styles.main}>
        {!panelOpen && (
          <IconButton
            className={styles.showPanelBtn}
            icon={Icons.chevronsRight}
            label="Show panel"
            variant="ghost"
            size="sm"
            onClick={togglePanel}
          />
        )}

        {nav.view === 'Year' && (
          <YearView
            events={events}
            timelines={timelines}
            year={yearCursor}
            onYearChange={setYearOverride}
            onDayClick={handleYearDayClick}
            onMonthClick={handleYearMonthClick}
            onEventClick={(eid) => {
              const ev = events.find(e => e.id === eid);
              if (ev) openEventEditor(ev);
            }}
          />
        )}

        <div className={[styles.gridWrap, nav.view === 'Year' ? styles.hidden : ''].join(' ')}>
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={false}
            events={fcEvents}
            eventContent={eventContent}
            dayHeaderContent={dayHeaderContent}
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
            // Descriptive a11y hints ($0 = FC's view-unit / button-text
            // placeholder). closeHint labels the "+N more" popover's close button.
            buttonHints={{ prev: 'Previous $0', next: 'Next $0', today: 'This $0' }}
            viewHint="$0 view"
            navLinkHint="Go to $0"
            closeHint="Close"
            // Event + day-cell ARIA and roving-nav registration. ARIA goes on
            // FC's outer element (info.el), never inside the pill.
            eventDidMount={(info) => {
              if (info.event.display === 'background') return; // move-mode phantom
              const ev: Event = info.event.extendedProps.event;
              const isPrep = !!info.event.extendedProps.isPrepBlock;
              const start = info.event.start;
              const end = info.event.end;
              const tlName = timelines.find(t => t.id === ev.calendar_id)?.name ?? '';
              const startStr = start ? start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
              const endStr = end ? end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
              const recur = ev.is_recurring ? ', recurring' : '';
              info.el.setAttribute(
                'aria-label',
                `${isPrep ? 'Prep, ' : ''}${ev.title}, ${startStr} to ${endStr}${tlName ? `, ${tlName}` : ''}${recur}`,
              );
              info.el.setAttribute('role', 'button');
              info.el.setAttribute('tabindex', '-1');
              // Decorative chips inside the pill are already covered by aria-label.
              info.el
                .querySelectorAll('[class*="pillTime"],[class*="pillChips"]')
                .forEach(n => n.setAttribute('aria-hidden', 'true'));
              if (!isPrep && start && end) {
                registerEl(info.event.id, { el: info.el as HTMLElement, ev, instanceDate: info.event.extendedProps.instanceDate, start, end });
              }
            }}
            eventWillUnmount={(info) => {
              if (info.event.display === 'background') return;
              unregisterEl(info.event.id);
            }}
            dayCellDidMount={(info) => {
              info.el.setAttribute('aria-label', info.date.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
            }}
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
              setMiniSelected(info.view.calendar.getDate());
              setMiniRange({ start: info.start, end: info.end });
              setYearOverride(null);
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

          {nav.view === 'Week' && (
            <div className={styles.floatLeft}>
              <Button size="sm" variant="secondary" icon={Icons.bookmark} onClick={handleSaveWeekAsTemplate}>
                Save week as template
              </Button>
            </div>
          )}
        </div>

        {showEmpty && (
          <div className={styles.emptyOverlay}>
            <div className={styles.emptyCard}>
              <EmptyState
                icon={Icons.calendar}
                title={emptyTitle}
                description={filtersHidingEvents
                  ? 'Timelines or filters are hiding events. Clear them in the panel, or create a new one.'
                  : 'Drag on the grid or press N to create one.'}
                action={{ label: 'New event', icon: Icons.plus, kbd: 'N', onClick: () => openEventEditor(null) }}
                secondary={{ label: 'Dismiss', onClick: dismissEmpty }}
              />
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
            onClockToggle={handlePeekClockToggle}
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
            defaultTimelineId={quickCreateDefaultTimeline}
            onSubmit={handleQuickCreateSubmit}
            onMoreOptions={handleQuickCreateMore}
            onDiscard={discardQuickCreate}
          />
        )}

        {/* Bottom-center dock: warnings stack, then the selection bar. */}
        <div className={styles.dock}>
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
          <SelectionBar
            count={selectedEventIds.size}
            onDelete={() => void bulkDelete()}
            onSnoozeDay={() => void snoozeSelected(1)}
            onSnoozeWeek={() => void snoozeSelected(7)}
            onClear={() => setSelectedEventIds(new Set())}
          />
        </div>
      </div>
    </Page>
  );
}
