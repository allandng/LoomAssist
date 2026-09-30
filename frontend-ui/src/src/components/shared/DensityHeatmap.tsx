import { useState, useMemo } from 'react';
import styles from './DensityHeatmap.module.css';
import type { Event } from '../../types';
import { IconButton } from '../ui/Button';
import { Icons } from './Icon';

const INTENSITY = [
  styles.hmL0, styles.hmL1, styles.hmL2, styles.hmL3, styles.hmL4,
] as const;

type HeatmapRange = 'month' | 'trailing12w';

interface DensityHeatmapProps {
  events: Event[];
  onDayClick?: (date: Date) => void;
  range?: HeatmapRange;
}

function eventsLabel(n: number): string {
  return `${n} event${n === 1 ? '' : 's'}`;
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Month-at-a-glance (or trailing 12 weeks) event density grid. Every cell is a
 * labelled button ("Mar 4: 3 events"); `onDayClick` receives the local date.
 * Level classes `hmL0`–`hmL4` are shared with the Energy map widget.
 */
export function DensityHeatmap({ events, onDayClick, range = 'month' }: DensityHeatmapProps) {
  return range === 'trailing12w'
    ? <Trailing12W events={events} onDayClick={onDayClick} />
    : <MonthHeatmap events={events} onDayClick={onDayClick} />;
}

function Legend() {
  return (
    <div className={styles.legend} aria-hidden="true">
      <span className={styles.legendLabel}>Less busy</span>
      <div className={styles.legendSwatches}>
        {INTENSITY.map((cls, i) => (
          <span key={i} className={`${styles.legendSwatch} ${cls}`} />
        ))}
      </div>
      <span className={styles.legendLabel}>More busy</span>
    </div>
  );
}

function MonthHeatmap({ events, onDayClick }: Omit<DensityHeatmapProps, 'range'>) {
  const [offset, setOffset] = useState(0);

  const view = useMemo(() => {
    const today = new Date();
    const anchor = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    return {
      year,
      month,
      todayDate: today.getDate(),
      daysInMonth: new Date(year, month + 1, 0).getDate(),
      startDow: anchor.getDay(),
      monthLabel: anchor.toLocaleString([], { month: 'long', year: 'numeric' }),
    };
  }, [offset]);
  const { year, month, todayDate, daysInMonth, startDow, monthLabel } = view;

  const countByDay = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const ev of events) {
      const d = new Date(ev.start_time);
      if (d.getFullYear() === year && d.getMonth() === month) {
        counts[d.getDate()] = (counts[d.getDate()] ?? 0) + 1;
      }
    }
    return counts;
  }, [events, year, month]);

  const maxCount = Math.max(...Object.values(countByDay), 1);
  const isNow    = offset === 0;

  return (
    <div className={styles.heatmap}>
      <div className={styles.heatmapHeader}>
        <IconButton size="sm" icon={Icons.chevronLeft} label="Previous month" onClick={() => setOffset(o => o - 1)} />
        <span className={styles.heatmapMonth}>{monthLabel}</span>
        <IconButton size="sm" icon={Icons.chevronRight} label="Next month" onClick={() => setOffset(o => o + 1)} />
      </div>
      <div className={styles.heatmapGrid} role="grid" aria-label={`Events per day, ${monthLabel}`}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className={styles.heatmapDow} aria-hidden="true">{d}</div>
        ))}
        {Array.from({ length: startDow }, (_, i) => (
          <div key={`pad${i}`} className={styles.heatmapEmpty} aria-hidden="true" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day     = i + 1;
          const date    = new Date(year, month, day);
          const count   = countByDay[day] ?? 0;
          const level   = Math.min(4, Math.round((count / maxCount) * 4));
          const isToday = isNow && day === todayDate;
          return (
            <button
              key={day}
              type="button"
              className={[styles.heatmapCell, INTENSITY[level], isToday ? styles.heatmapToday : ''].join(' ')}
              onClick={() => onDayClick?.(date)}
              aria-label={`${dayLabel(date)}: ${eventsLabel(count)}${isToday ? ' (today)' : ''}`}
              title={`${dayLabel(date)}: ${eventsLabel(count)}`}
              aria-current={isToday ? 'date' : undefined}
            >
              {day}
            </button>
          );
        })}
      </div>
      <Legend />
    </div>
  );
}

function Trailing12W({ events, onDayClick }: Omit<DensityHeatmapProps, 'range'>) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Anchor on the coming Saturday so columns align by week (Sun..Sat).
  const anchorEnd = new Date(today);
  anchorEnd.setDate(anchorEnd.getDate() + (6 - today.getDay()));
  const anchorStart = new Date(anchorEnd);
  anchorStart.setDate(anchorStart.getDate() - (12 * 7 - 1));

  const countByDay = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ev of events) {
      const d = new Date(ev.start_time);
      if (isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [events]);

  const maxCount = Math.max(...Object.values(countByDay), 1);

  const weeks: Date[][] = [];
  for (let w = 0; w < 12; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(anchorStart);
      day.setDate(anchorStart.getDate() + w * 7 + d);
      week.push(day);
    }
    weeks.push(week);
  }

  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, col) => {
    const m = week[0].getMonth();
    if (m !== lastMonth) {
      monthLabels.push({ col, label: week[0].toLocaleString([], { month: 'short' }) });
      lastMonth = m;
    }
  });

  return (
    <div className={styles.heatmap}>
      <div className={styles.tw12MonthRow} aria-hidden="true">
        {monthLabels.map(({ col, label }) => (
          <span key={col} className={styles.tw12MonthLabel} style={{ gridColumnStart: col + 1 }}>
            {label}
          </span>
        ))}
      </div>
      <div className={styles.tw12Grid} role="grid" aria-label="Events per day, last 12 weeks">
        {weeks.map((week, w) =>
          week.map((day, d) => {
            const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
            const count = countByDay[key] ?? 0;
            const level = count === 0 ? 0 : Math.min(4, Math.round((count / maxCount) * 4));
            const isToday = day.getTime() === today.getTime();
            const isFuture = day.getTime() > today.getTime();
            return (
              <button
                key={`${w}-${d}`}
                type="button"
                className={[
                  styles.tw12Cell,
                  INTENSITY[level],
                  isToday ? styles.heatmapToday : '',
                  isFuture ? styles.cellFuture : '',
                ].join(' ')}
                onClick={() => onDayClick?.(new Date(day))}
                aria-label={`${dayLabel(day)}: ${eventsLabel(count)}${isToday ? ' (today)' : ''}`}
                title={`${dayLabel(day)}: ${eventsLabel(count)}`}
                aria-current={isToday ? 'date' : undefined}
              />
            );
          }),
        )}
      </div>
      <Legend />
    </div>
  );
}
