/**
 * Bridges the Shell's TopBar with CalendarPage's FullCalendar API.
 * CalendarPage registers setters; TopBar reads the values + calls the actions.
 */
import { createContext, useContext, useState, useCallback, useMemo, useRef, type ReactNode } from 'react';

type CalendarView = 'Month' | 'Week' | 'Day' | 'Agenda' | 'Year';

const FC_VIEW: Record<CalendarView, string> = {
  Month:  'dayGridMonth',
  Week:   'timeGridWeek',
  Day:    'timeGridDay',
  Agenda: 'listWeek',
  Year:   '',
};

interface CalendarNavContextValue {
  view: CalendarView;
  dateLabel: string;
  setView: (v: CalendarView) => void;
  setDateLabel: (label: string) => void;
  // Registered by CalendarPage to give TopBar access to the FullCalendar API
  registerActions: (actions: { prev(): void; next(): void; today(): void; changeView(v: string): void }) => void;
  goNext: () => void;
  goPrev: () => void;
  goToday: () => void;
  fcView: (v: CalendarView) => string;
}

const CalendarNavContext = createContext<CalendarNavContextValue | null>(null);

export function CalendarNavProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<CalendarView>('Month');
  const [dateLabel, setDateLabel] = useState('');
  const actionsRef = useRef<{ prev(): void; next(): void; today(): void; changeView(v: string): void } | null>(null);

  const registerActions = useCallback((actions: typeof actionsRef.current) => {
    actionsRef.current = actions;
  }, []);

  const goNext  = useCallback(() => actionsRef.current?.next(),  []);
  const goPrev  = useCallback(() => actionsRef.current?.prev(),  []);
  const goToday = useCallback(() => actionsRef.current?.today(), []);

  const changeView = useCallback((v: CalendarView) => {
    setView(v);
    const fc = FC_VIEW[v];
    if (fc) actionsRef.current?.changeView(fc);
  }, []);

  const value = useMemo<CalendarNavContextValue>(() => ({
    view, dateLabel, setView: changeView, setDateLabel, registerActions, goNext, goPrev, goToday, fcView: v => FC_VIEW[v],
  }), [view, dateLabel, changeView, setDateLabel, registerActions, goNext, goPrev, goToday]);

  return <CalendarNavContext value={value}>{children}</CalendarNavContext>;
}

export function useCalendarNav(): CalendarNavContextValue {
  const ctx = useContext(CalendarNavContext);
  if (!ctx) throw new Error('useCalendarNav must be inside CalendarNavProvider');
  return ctx;
}
