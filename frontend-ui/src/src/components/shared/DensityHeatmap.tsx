import { useState, useMemo } from 'react';
import styles from './DensityHeatmap.module.css';
import type { Event } from '../../types';

const INTENSITY = [
  styles.hmL0, styles.hmL1, styles.hmL2, styles.hmL3, styles.hmL4,
] as const;

interface DensityHeatmapProps {
  events: Event[];
  onDayClick?: (date: Date) => void;
}

export function DensityHeatmap({ events, onDayClick }: DensityHeatmapProps) {
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

      {/* Legend bar */}
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
