import { useState, useRef, useCallback } from 'react';
import type { Event } from '../../types';
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
}

export function YearView({ events, onDayClick, onMonthClick }: YearViewProps) {
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

  const eventDates = new Set<string>();
  for (const ev of events) {
    eventDates.add(ev.start_time.slice(0, 10));
  }

  return (
    <div className={styles.root} onWheel={handleWheel}>
      <div className={styles.header}>
        <button className={styles.navBtn} onClick={() => setYear(y => y - 1)}>‹</button>
        <span className={styles.yearLabel}>{year}</span>
        <button className={styles.navBtn} onClick={() => setYear(y => y + 1)}>›</button>
      </div>

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
                  const hasEvent = eventDates.has(ds);
                  return (
                    <button
                      key={i}
                      className={`${styles.day} ${isToday ? styles.today : ''}`}
                      onClick={() => onDayClick(new Date(year, m, day))}
                      title={ds}
                    >
                      <span className={styles.dayNum}>{day}</span>
                      {hasEvent && <span className={styles.dot} />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
