import { useMemo, useState } from 'react';
import styles from './MiniCalendar.module.css';
import { DEFAULT_TIMELINE_COLOR } from '../../lib/colors';
import type { Event, Calendar } from '../../types';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface MiniCalendarProps {
  events: Event[];
  timelines: Calendar[];
  /** The main view's current anchor date (drives which month is shown). */
  anchorDate: Date;
  /** Inclusive-start / exclusive-end range currently visible in the main view. */
  rangeStart?: Date | null;
  rangeEnd?: Date | null;
  /** Move the main view's anchor date without changing the view type. */
  onPick: (d: Date) => void;
  /** Switch the main view to Day at the picked date (double-click). */
  onPickDay: (d: Date) => void;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthCells(year: number, month: number): (Date | null)[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * WS4 #10 — mini-calendar pinned at the top of the calendar sidebar. Clicking a
 * day moves the main view's anchor date WITHOUT switching the view type;
 * double-click drops into Day view. A translucent band marks the range the main
 * view currently shows, and a single density dot (dominant timeline color)
 * marks days that hold events.
 */
export function MiniCalendar({
  events, timelines, anchorDate, rangeStart, rangeEnd, onPick, onPickDay,
}: MiniCalendarProps) {
  // The displayed month is a plain year*12+month key so it survives the
  // anchorDate identity churn (a fresh Date arrives each datesSet). It follows
  // the main view via a render-phase adjustment (no setState-in-effect) but the
  // ‹ › steppers can page it independently.
  const anchorKey = anchorDate.getFullYear() * 12 + anchorDate.getMonth();
  const [cursorKey, setCursorKey] = useState(anchorKey);
  const [prevAnchorKey, setPrevAnchorKey] = useState(anchorKey);
  if (anchorKey !== prevAnchorKey) { setPrevAnchorKey(anchorKey); setCursorKey(anchorKey); }
  const cursor = new Date(Math.floor(cursorKey / 12), cursorKey % 12, 1);

  const density = useMemo(() => {
    const map = new Map<string, Record<number, number>>();
    for (const ev of events) {
      const ds = ev.start_time.slice(0, 10);
      const byCal = map.get(ds) ?? {};
      byCal[ev.calendar_id] = (byCal[ev.calendar_id] ?? 0) + 1;
      map.set(ds, byCal);
    }
    return map;
  }, [events]);

  const colorFor = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of timelines) m.set(t.id, t.color || DEFAULT_TIMELINE_COLOR);
    return (byCal: Record<number, number>): string => {
      let bestId = -1, bestN = -1;
      for (const [id, n] of Object.entries(byCal)) {
        if (n > bestN) { bestN = n; bestId = Number(id); }
      }
      return m.get(bestId) ?? DEFAULT_TIMELINE_COLOR;
    };
  }, [timelines]);

  const todayStr = ymd(new Date());
  const cells = monthCells(cursor.getFullYear(), cursor.getMonth());

  const inRange = (d: Date): boolean => {
    if (!rangeStart || !rangeEnd) return false;
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return t >= new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate()).getTime()
        && t <  new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate()).getTime();
  };

  const step = (delta: number) => setCursorKey(k => k + delta);

  return (
    <div className={styles.mini}>
      <div className={styles.head}>
        <span className={styles.monthLabel}>
          {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
        </span>
        <div className={styles.steppers}>
          <button className={styles.stepBtn} onClick={() => step(-1)} aria-label="Previous month">‹</button>
          <button className={styles.stepBtn} onClick={() => step(1)} aria-label="Next month">›</button>
        </div>
      </div>
      <div className={styles.dow} aria-hidden="true">
        {DOW.map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className={styles.grid}>
        {cells.map((d, i) => {
          if (!d) return <span key={i} className={styles.blank} />;
          const ds = ymd(d);
          const isToday = ds === todayStr;
          const banded = inRange(d);
          const byCal = density.get(ds);
          return (
            <button
              key={i}
              className={`${styles.day} ${isToday ? styles.today : ''} ${banded ? styles.banded : ''}`}
              onClick={() => onPick(d)}
              onDoubleClick={() => onPickDay(d)}
              title={d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            >
              <span className={styles.num}>{d.getDate()}</span>
              {byCal && <span className={styles.dot} style={{ background: colorFor(byCal) }} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
