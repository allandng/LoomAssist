import { useState, useMemo } from 'react';
import styles from './DensityHeatmap.module.css';
import type { Event } from '../../types';

const INTENSITY = [
  styles.hmL0, styles.hmL1, styles.hmL2, styles.hmL3, styles.hmL4,
] as const;

type HeatmapRange = 'month' | 'trailing12w';

interface DensityHeatmapProps {
  events: Event[];
  onDayClick?: (date: Date) => void;
  range?: HeatmapRange;
}

export function DensityHeatmap({ events, onDayClick, range = 'month' }: DensityHeatmapProps) {
  return range === 'trailing12w'
    ? <Trailing12W events={events} onDayClick={onDayClick} />
    : <MonthHeatmap events={events} onDayClick={onDayClick} />;
}

function MonthHeatmap({ events, onDayClick }: Omit<DensityHeatmapProps, 'range'>) {
  const [offset, setOffset] = useState(0);

  const today = new Date();
  const viewYear  = today.getFullYear();
  const viewMonth = today.getMonth() + offset;
  const anchor    = new Date(viewYear, viewMonth, 1);
  const year      = anchor.getFullYear();
  const month     = anchor.getMonth();

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

  const maxCount    = Math.max(...Object.values(countByDay), 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow    = new Date(year, month, 1).getDay();
  const isNow       = offset === 0;
  const todayDate   = today.getDate();
  const monthLabel  = anchor.toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div className={styles.heatmap}>
      <div className={styles.heatmapHeader}>
        <button className={styles.heatmapNav} onClick={() => setOffset(o => o - 1)}>‹</button>
        <span className={styles.heatmapMonth}>{monthLabel}</span>
        <button className={styles.heatmapNav} onClick={() => setOffset(o => o + 1)}>›</button>
      </div>
      <div className={styles.heatmapGrid}>
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} className={styles.heatmapDow}>{d}</div>
        ))}
        {Array.from({ length: startDow }, (_, i) => (
          <div key={`pad${i}`} className={styles.heatmapEmpty} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day     = i + 1;
          const count   = countByDay[day] ?? 0;
          const level   = Math.min(4, Math.round((count / maxCount) * 4));
          const isToday = isNow && day === todayDate;
          return (
            <button
              key={day}
              className={`${styles.heatmapCell} ${INTENSITY[level]}${isToday ? ` ${styles.heatmapToday}` : ''}`}
              onClick={() => onDayClick?.(new Date(year, month, day))}
              title={`${count} event${count !== 1 ? 's' : ''}`}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className={styles.legend}>
        <span className={styles.legendLabel}>Less busy</span>
        <div className={styles.legendSwatches}>
          {INTENSITY.map((cls, i) => (
            <span key={i} className={`${styles.legendSwatch} ${cls}`} />
          ))}
        </div>
        <span className={styles.legendLabel}>More busy</span>
      </div>
    </div>
  );
}

function Trailing12W({ events, onDayClick }: Omit<DensityHeatmapProps, 'range'>) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Anchor on the most recent Sunday so columns align by week
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
      monthLabels.push({ col, label: week[0].toLocaleString('default', { month: 'short' }) });
      lastMonth = m;
    }
  });

  return (
    <div className={styles.heatmap}>
      <div className={styles.tw12MonthRow}>
        {monthLabels.map(({ col, label }) => (
          <span key={col} className={styles.tw12MonthLabel} style={{ gridColumnStart: col + 1 }}>
            {label}
          </span>
        ))}
      </div>
      <div className={styles.tw12Grid}>
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
                className={`${styles.tw12Cell} ${INTENSITY[level]}${isToday ? ` ${styles.heatmapToday}` : ''}`}
                onClick={() => onDayClick?.(new Date(day))}
                title={`${day.toLocaleDateString()} — ${count} event${count !== 1 ? 's' : ''}`}
                style={isFuture ? { opacity: 0.35 } : undefined}
              />
            );
          })
        )}
      </div>
      <div className={styles.legend}>
        <span className={styles.legendLabel}>Less busy</span>
        <div className={styles.legendSwatches}>
          {INTENSITY.map((cls, i) => (
            <span key={i} className={`${styles.legendSwatch} ${cls}`} />
          ))}
        </div>
        <span className={styles.legendLabel}>More busy</span>
      </div>
    </div>
  );
}
