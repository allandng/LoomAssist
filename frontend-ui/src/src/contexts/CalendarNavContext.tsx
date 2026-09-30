/**
 * Bridges the Shell's TopBar with CalendarPage's FullCalendar API.
 * CalendarPage registers setters; TopBar reads the values + calls the actions.
 *
 * Registration is scoped to the calendar page's lifetime: `registerActions`
 * returns a cleanup (and `unregisterActions` exists for symmetry) so prev /
 * next / today become no-ops once the page unmounts, instead of driving a
 * stale FullCalendar instance from another route.
 */
import { createContext, useContext, useState, useCallback, useMemo, useRef, type ReactNode } from 'react';

export type CalendarView = 'Month' | 'Week' | 'Day' | 'Agenda' | 'Year';

const FC_VIEW: Record<CalendarView, string> = {
  Month:  'dayGridMonth',
  Week:   'timeGridWeek',
  Day:    'timeGridDay',
  Agenda: 'listWeek',
  Year:   '',
};

export interface CalendarNavActions {
  prev(): void;
  next(): void;
  today(): void;
  changeView(v: string): void;
}

/** Reported by CalendarPage; shown in the TopBar / sidebar account row. */
export interface CalendarSyncStatus {
  label: string;
  error: boolean;
}

interface CalendarNavContextValue {
  view: CalendarView;
  dateLabel: string;
  setView: (v: CalendarView) => void;
  setDateLabel: (label: string) => void;
  /**
   * Registered by CalendarPage to give TopBar access to the FullCalendar API.
   * Returns a cleanup that clears the registration (only if it is still the
   * current one), so pass it straight back from a useEffect.
   */
  registerActions: (actions: CalendarNavActions) => () => void;
  unregisterActions: () => void;
  goNext: () => void;
  goPrev: () => void;
  goToday: () => void;
  fcView: (v: CalendarView) => string;
  // WS3 #8 — imperative refetch handoff. CalendarPage registers its `loadAll`
  // here so save/voice paths can refresh the grid in place instead of
  // remounting the whole page (which threw away scroll/view/selection).
  registerReload: (fn: () => void | Promise<void>) => void;
  reload: () => void;
  /** Last sync outcome reported by the calendar page; null when unknown. */
  syncStatus: CalendarSyncStatus | null;
  setSyncStatus: (s: CalendarSyncStatus | null) => void;
}

const CalendarNavContext = createContext<CalendarNavContextValue | null>(null);

export function CalendarNavProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<CalendarView>('Month');
  const [dateLabel, setDateLabel] = useState('');
  const [syncStatus, setSyncStatusState] = useState<CalendarSyncStatus | null>(null);
  const actionsRef = useRef<CalendarNavActions | null>(null);
  const reloadRef = useRef<(() => void | Promise<void>) | null>(null);

  const unregisterActions = useCallback(() => { actionsRef.current = null; }, []);

  const registerActions = useCallback((actions: CalendarNavActions) => {
    actionsRef.current = actions;
    return () => { if (actionsRef.current === actions) actionsRef.current = null; };
  }, []);

  const registerReload = useCallback((fn: () => void | Promise<void>) => {
    reloadRef.current = fn;
  }, []);

  const reload = useCallback(() => { void reloadRef.current?.(); }, []);

  const goNext  = useCallback(() => actionsRef.current?.next(),  []);
  const goPrev  = useCallback(() => actionsRef.current?.prev(),  []);
  const goToday = useCallback(() => actionsRef.current?.today(), []);

  const changeView = useCallback((v: CalendarView) => {
    setView(v);
    const fc = FC_VIEW[v];
    if (fc) actionsRef.current?.changeView(fc);
  }, []);

  // Only re-render consumers when the status actually changes.
  const setSyncStatus = useCallback((s: CalendarSyncStatus | null) => {
    setSyncStatusState(prev => {
      if (prev === s) return prev;
      if (prev && s && prev.label === s.label && prev.error === s.error) return prev;
      return s;
    });
  }, []);

  const value = useMemo<CalendarNavContextValue>(() => ({
    view, dateLabel, setView: changeView, setDateLabel,
    registerActions, unregisterActions, goNext, goPrev, goToday,
    fcView: v => FC_VIEW[v],
    registerReload, reload,
    syncStatus, setSyncStatus,
  }), [view, dateLabel, changeView, setDateLabel, registerActions, unregisterActions, goNext, goPrev, goToday, registerReload, reload, syncStatus, setSyncStatus]);

  return <CalendarNavContext value={value}>{children}</CalendarNavContext>;
}

export function useCalendarNav(): CalendarNavContextValue {
  const ctx = useContext(CalendarNavContext);
  if (!ctx) throw new Error('useCalendarNav must be inside CalendarNavProvider');
  return ctx;
}
