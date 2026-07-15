import { useState, useRef, useCallback } from 'react';
import type { Event, Calendar } from '../../types';
import { DEFAULT_TIMELINE_COLOR } from '../../lib/colors';
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

interface YearViewProps {
  events: Event[];
  onDayClick: (date: Date) => void;
  onMonthClick: (date: Date) => void;
  timelines?: Calendar[];
  onEventClick?: (eventId: number) => void;
}

export function YearView({ events, onDayClick, onMonthClick, timelines = [], onEventClick }: YearViewProps) {
  const [mode, setMode] = useState<'year' | 'semester'>('year');
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const [year, setYear] = useState(today.getFullYear());
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (wheelTimerRef.current) return;
    e.preventDefault();
    setYear(y => e.deltaY > 0 ? y + 1 : y - 1);
    wheelTimerRef.current = setTimeout(() => { wheelTimerRef.current = null; }, 200);
  }, []);

  // Per-day density: event count + the dominant timeline's color, so the
  // mini-calendar shows 1–3 density dots pre-navigation (WS2 §10).
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
      <div className={styles.header}>
        <button className={styles.navBtn} onClick={() => setYear(y => y - 1)}>‹</button>
        <span className={styles.yearLabel}>{year}</span>
        <button className={styles.navBtn} onClick={() => setYear(y => y + 1)}>›</button>
        <div style={{ marginLeft: 16, display: 'inline-flex', gap: 4, padding: 2, background: 'var(--bg-elevated)', borderRadius: 6 }}>
          <button
            onClick={() => setMode('year')}
            style={{
              padding: '4px 10px', fontSize: 11, fontWeight: 600,
              borderRadius: 4, border: 'none', cursor: 'pointer',
              background: mode === 'year' ? 'var(--accent)' : 'transparent',
              color: mode === 'year' ? '#fff' : 'var(--text-muted)',
            }}
          >
            Year
          </button>
          <button
            onClick={() => setMode('semester')}
            style={{
              padding: '4px 10px', fontSize: 11, fontWeight: 600,
              borderRadius: 4, border: 'none', cursor: 'pointer',
              background: mode === 'semester' ? 'var(--accent)' : 'transparent',
              color: mode === 'semester' ? '#fff' : 'var(--text-muted)',
            }}
          >
            Semester
          </button>
        </div>
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
                className={styles.monthName}
                onClick={() => onMonthClick(new Date(year, m, 1))}
                title={`Go to ${MONTH_NAMES[m]} ${year}`}
              >
                {MONTH_NAMES[m]}
              </button>
              <div className={styles.dow}>
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
                      className={`${styles.day} ${isToday ? styles.today : ''}`}
                      onClick={() => onDayClick(new Date(year, m, day))}
                      title={ds}
                    >
                      <span className={styles.dayNum}>{day}</span>
                      {dotCount > 0 && (
                        <span className={styles.dots}>
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
      <div style={{ padding: '32px 24px', color: 'var(--text-muted)', fontSize: 13 }}>
        No course timelines yet. Mark a timeline as a course in its Edit menu (with a term start and end) to see it here.
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px 32px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto' }}>
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
          <div key={tl.id} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: tl.color, display: 'inline-block' }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)' }}>{tl.name}</span>
              {tl.course_code && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{tl.course_code}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {start.toLocaleDateString([], { month: 'short', day: 'numeric' })} – {end.toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
            </div>
            <div style={{ position: 'relative', height: 32, background: 'var(--bg-subtle)', borderRadius: 4 }}>
              {tlEvents.map(ev => {
                const evDate = new Date(ev.start_time);
                const pct = ((evDate.getTime() - start.getTime()) / totalMs) * 100;
                return (
                  <button
                    key={ev.id}
                    onClick={() => onEventClick?.(ev.id)}
                    title={`${ev.title} — ${evDate.toLocaleDateString()}`}
                    style={{
                      position: 'absolute',
                      left: `${pct}%`,
                      top: 4, bottom: 4, width: 6,
                      background: tl.color,
                      border: 'none', borderRadius: 2,
                      cursor: 'pointer', padding: 0,
                      transform: 'translateX(-50%)',
                    }}
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
