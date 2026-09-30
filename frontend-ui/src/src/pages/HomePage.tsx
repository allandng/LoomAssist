import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './HomePage.module.css';
import { listEvents, listCalendars, listTasks, listHabits, listHabitEntries } from '../api';
import type { Event, Calendar, Task, HabitEntry } from '../types';
import {
  Page, PageHeader, Button, StatTile, Skeleton, Badge,
  Card, CardHeader, CardBody, Icons,
} from '../components/ui';
import { UpNextWidget } from '../components/home/UpNextWidget';
import { EnergyMappingWidget } from '../components/home/EnergyMappingWidget';
import { WeeklyReviewWidget } from '../components/home/WeeklyReviewWidget';
import { GradeWidget } from '../components/home/GradeWidget';
import { DensityHeatmap } from '../components/shared/DensityHeatmap';
import { useModal } from '../contexts/ModalContext';
import { useAccount } from '../contexts/AccountContext';
import { useFocusVersion, focusMinutesBetween } from '../components/focus/focusStore';
import { occurrencesOn, tasksDueThisWeek, habitStreak, formatMinutes } from '../components/home/homeStats';
import { todayISO, startOfWeek, addDays } from '../components/tasks/taskUtils';

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function readLocalName(): string | null {
  try {
    return localStorage.getItem('loom_user_name')?.trim() || null;
  } catch {
    return null;
  }
}

async function loadHabitData(): Promise<{ habitCount: number; entries: HabitEntry[] }> {
  const habits = await listHabits();
  const lists = await Promise.all(habits.map(h => listHabitEntries(h.id).catch(() => [] as HabitEntry[])));
  return { habitCount: habits.length, entries: lists.flat() };
}

type Source = 'events' | 'timelines' | 'tasks' | 'habits';

export function HomePage() {
  const navigate = useNavigate();
  const { openEventEditor } = useModal();
  const { account } = useAccount();
  const focusVersion = useFocusVersion();

  const [events, setEvents]         = useState<Event[]>([]);
  const [timelines, setTimelines]   = useState<Calendar[]>([]);
  const [tasks, setTasks]           = useState<Task[]>([]);
  const [habitEntries, setEntries]  = useState<HabitEntry[]>([]);
  const [habitCount, setHabitCount] = useState(0);
  const [loading, setLoading]       = useState(true);
  const [failed, setFailed]         = useState<Source[]>([]);
  const [reloadKey, setReloadKey]   = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([listEvents(), listCalendars(), listTasks(), loadHabitData()]).then(([ev, cal, tk, hb]) => {
      if (!alive) return;
      const fails: Source[] = [];
      if (ev.status === 'fulfilled') setEvents(ev.value); else fails.push('events');
      if (cal.status === 'fulfilled') setTimelines(cal.value); else fails.push('timelines');
      if (tk.status === 'fulfilled') setTasks(tk.value); else fails.push('tasks');
      if (hb.status === 'fulfilled') { setEntries(hb.value.entries); setHabitCount(hb.value.habitCount); } else fails.push('habits');
      setFailed(fails);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [reloadKey]);

  const retry = useCallback(() => {
    setLoading(true);
    setReloadKey(k => k + 1);
  }, []);

  const now = new Date();
  const today = todayISO();
  const displayName = account?.display_name?.trim() || readLocalName();
  const dateLabel = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const eventsToday  = useMemo(() => occurrencesOn(events, timelines, today).length, [events, timelines, today]);
  const dueWeek      = useMemo(() => tasksDueThisWeek(tasks, today), [tasks, today]);
  const streak       = useMemo(() => habitStreak(habitEntries, today), [habitEntries, today]);
  const focusMinutes = useMemo(() => {
    const start = startOfWeek(new Date());
    return focusMinutesBetween(start, addDays(start, 7));
  }, [focusVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- re-read the store when it changes

  function capture() {
    // App may intercept this to open its inbox panel; when nobody does, route there.
    const handled = !window.dispatchEvent(new CustomEvent('loom-open-inbox', { cancelable: true }));
    if (!handled) navigate('/inbox');
  }

  function goToDay(date: Date) {
    navigate('/calendar', { state: { date: date.toISOString(), view: 'Day' } });
  }

  return (
    <Page narrow="lg">
      <PageHeader
        title={`${greetingFor(now)}${displayName ? `, ${displayName}` : ''}.`}
        description={dateLabel}
        actions={
          <>
            <Button variant="ghost" icon={Icons.inbox} onClick={capture}>Capture</Button>
            <Button variant="ghost" icon={Icons.timer} onClick={() => navigate('/focus')}>Start focus</Button>
            <Button variant="primary" icon={Icons.plus} kbd="N" onClick={() => openEventEditor()}>New event</Button>
          </>
        }
      />

      {failed.length > 0 && (
        <div className={styles.errors} role="alert">
          {failed.map(f => (
            <Badge key={f} tone="error" icon={Icons.alertCircle}>Couldn't load {f}</Badge>
          ))}
          <Button size="sm" variant="subtle" icon={Icons.refresh} onClick={retry}>Retry</Button>
        </div>
      )}

      <div className={styles.stats}>
        {loading ? (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={styles.statSkeleton} aria-hidden="true">
              <Skeleton width="45%" height={11} />
              <Skeleton width="55%" height={26} />
              <Skeleton width="65%" height={11} />
            </div>
          ))
        ) : (
          <>
            <StatTile
              label="Events today"
              value={eventsToday}
              sub={eventsToday === 0 ? 'Nothing scheduled' : 'Open the calendar'}
              icon={Icons.calendar}
              onClick={() => navigate('/calendar')}
            />
            <StatTile
              label="Tasks due this week"
              value={dueWeek.due}
              sub={dueWeek.overdue ? `${dueWeek.overdue} overdue` : 'None overdue'}
              tone={dueWeek.overdue ? 'error' : 'neutral'}
              icon={Icons.tasks}
              onClick={() => navigate('/tasks')}
            />
            <StatTile
              label="Focus this week"
              value={formatMinutes(focusMinutes)}
              sub="Completed pomodoro sessions"
              tone={focusMinutes > 0 ? 'accent' : 'neutral'}
              icon={Icons.timer}
              onClick={() => navigate('/focus')}
            />
            <StatTile
              label="Habit streak"
              value={`${streak} ${streak === 1 ? 'day' : 'days'}`}
              sub={habitCount ? `${habitCount} habit${habitCount === 1 ? '' : 's'} tracked` : 'No habits yet'}
              tone={streak > 0 ? 'success' : 'neutral'}
              icon={Icons.repeat}
              onClick={() => navigate('/tasks')}
            />
          </>
        )}
      </div>

      <div className={styles.grid}>
        <div className={styles.column}>
          <UpNextWidget events={events} timelines={timelines} loading={loading} />

          <Card>
            <CardHeader
              title="Activity"
              description="Events per day over the last 12 weeks"
              actions={
                <Button size="sm" variant="subtle" iconRight={Icons.arrowRight} onClick={() => navigate('/calendar')}>
                  Open calendar
                </Button>
              }
            />
            <CardBody>
              {loading ? <Skeleton height={104} /> : <DensityHeatmap events={events} onDayClick={goToDay} range="trailing12w" />}
            </CardBody>
          </Card>

          <EnergyMappingWidget />
        </div>

        <div className={styles.column}>
          <WeeklyReviewWidget />
          <GradeWidget />
        </div>
      </div>
    </Page>
  );
}
