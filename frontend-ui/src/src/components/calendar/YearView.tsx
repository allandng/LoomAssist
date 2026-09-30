import { useState, useRef, useCallback } from 'react';
import type { Event, Calendar } from '../../types';
import { DEFAULT_TIMELINE_COLOR } from '../../lib/colors';
import { Segmented, TLDot } from '../ui';
import styles from './YearView.module.css';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function monthDays(year: number, month: number): (number | null)[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

type YearMode = 'year' | 'semester';

interface YearViewProps {
  events: Event[];
  /** The displayed year — owned by CalendarPage so the TopBar chevrons drive it. */
  year: number;
  onYearChange: (year: number) => void;
  onDayClick: (date: Date) => void;
  onMonthClick: (date: Date) => void;
  timelines?: Calendar[];
  onEventClick?: (eventId: number) => void;
}

/**
 * Custom Year view (not a FullCalendar view). Navigation lives in the TopBar
 * via CalendarNavContext; here only the Year / Semester mode switch remains.
 * Scroll-wheel pages years; a month name opens Month view, a day opens Day view.
 */
export function YearView({ events, year, onYearChange, onDayClick, onMonthClick, timelines = [], onEventClick }: YearViewProps) {
  const [mode, setMode] = useState<YearMode>('year');
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (wheelTimerRef.current) return;
    onYearChange(e.deltaY > 0 ? year + 1 : year - 1);
    wheelTimerRef.current = setTimeout(() => { wheelTimerRef.current = null; }, 200);
  }, [onYearChange, year]);

  // Per-day density: event count + the dominant timeline's color, so each
  // mini month shows 1–3 density dots pre-navigation.
  const dayDensity = new Map<string, { count: number; byCal: Record<number, number> }>();
  for (const ev of events) {
    const ds = ev.start_time.slice(0, 10);
    const info = dayDensity.get(ds) ?? { count: 0, byCal: {} };
    info.count += 1;
    info.byCal[ev.calendar_id] = (info.byCal[ev.calendar_id] ?? 0) + 1;
    dayDensity.set(ds, info);
  }

  const dotColorFor = (byCal: Record<number, number>): string => {
    let bestId = -1;
    let bestN = -1;
    for (const [id, n] of Object.entries(byCal)) {
      if (n > bestN) { bestN = n; bestId = Number(id); }
    }
    return timelines.find(t => t.id === bestId)?.color ?? DEFAULT_TIMELINE_COLOR;
  };

  return (
    <div className={styles.root} onWheel={handleWheel}>
      <div className={styles.toolbar}>
        <Segmented<YearMode>
          size="sm"
          aria-label="Year layout"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'year', label: 'Year' },
            { value: 'semester', label: 'Semester' },
          ]}
        />
      </div>

      {mode === 'semester' ? (
        <SemesterView
          year={year}
          events={events}
          timelines={timelines}
          onEventClick={onEventClick}
        />
      ) : (
        <div className={styles.grid}>
          {Array.from({ length: 12 }, (_, m) => {
            const cells = monthDays(year, m);
            return (
              <div key={m} className={styles.month}>
                <button
                  type="button"
                  className={styles.monthName}
                  onClick={() => onMonthClick(new Date(year, m, 1))}
                  title={`Open ${MONTH_NAMES[m]} ${year} in Month view`}
                >
                  {MONTH_NAMES[m]}
                </button>
                <div className={styles.dow} aria-hidden="true">
                  {DOW.map((d, i) => <span key={i}>{d}</span>)}
                </div>
                <div className={styles.days}>
                  {cells.map((day, i) => {
                    if (!day) return <span key={i} className={styles.empty} />;
                    const ds = `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const isToday = ds === todayStr;
                    const density = dayDensity.get(ds);
                    const dotCount = density ? (density.count >= 5 ? 3 : density.count >= 3 ? 2 : 1) : 0;
                    const dotColor = density ? dotColorFor(density.byCal) : undefined;
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`${styles.day} ${isToday ? styles.today : ''}`}
                        onClick={() => onDayClick(new Date(year, m, day))}
                        aria-current={isToday ? 'date' : undefined}
                        title={density ? `${ds} · ${density.count} event${density.count === 1 ? '' : 's'}` : ds}
                      >
                        <span className={styles.dayNum}>{day}</span>
                        {dotCount > 0 && (
                          <span className={styles.dots} aria-hidden="true">
                            {Array.from({ length: dotCount }, (_, di) => (
                              <span key={di} className={styles.dot} style={{ background: dotColor }} />
                            ))}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SemesterViewProps {
  year: number;
  events: Event[];
  timelines: Calendar[];
  onEventClick?: (eventId: number) => void;
}

function SemesterView({ year, events, timelines, onEventClick }: SemesterViewProps) {
  const courseTimelines = timelines.filter(t => t.is_course && t.term_start && t.term_end);

  if (courseTimelines.length === 0) {
    return (
      <p className={styles.semesterEmpty}>
        No course timelines yet. Mark a timeline as a course in its Edit menu (with a term start and end) to see it here.
      </p>
    );
  }

  return (
    <div className={styles.semester}>
      {courseTimelines.map(tl => {
        const start = new Date(tl.term_start!);
        const end   = new Date(tl.term_end!);
        const totalMs = end.getTime() - start.getTime();
        if (totalMs <= 0) return null;
        const tlEvents = events.filter(ev => {
          if (ev.calendar_id !== tl.id) return false;
          const evDate = new Date(ev.start_time);
          return evDate >= start && evDate <= end && evDate.getFullYear() === year;
        });

        return (
          <div key={tl.id} className={styles.course}>
            <div className={styles.courseHead}>
              <TLDot color={tl.color} size={8} />
              <span className={styles.courseName}>{tl.name}</span>
              {tl.course_code && <span className={styles.courseCode}>{tl.course_code}</span>}
              <span className={styles.courseTerm}>
                {start.toLocaleDateString([], { month: 'short', day: 'numeric' })} – {end.toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
            </div>
            <div className={styles.track}>
              {tlEvents.map(ev => {
                const evDate = new Date(ev.start_time);
                const pct = ((evDate.getTime() - start.getTime()) / totalMs) * 100;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    className={styles.tick}
                    onClick={() => onEventClick?.(ev.id)}
                    aria-label={`${ev.title}, ${evDate.toLocaleDateString()}`}
                    title={`${ev.title} — ${evDate.toLocaleDateString()}`}
                    style={{ left: `${pct}%`, background: tl.color }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
