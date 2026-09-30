import { useEffect, useState } from 'react';
import { getDurationStats } from '../../api';
import type { DurationStat } from '../../types';
import styles from './DurationStatsPanel.module.css';
import { Badge } from '../ui/Controls';
import { Skeleton } from '../ui/Controls';
import { EmptyState } from '../ui/Layout';
import { Icons } from './Icon';

function deltaTone(delta: number): 'success' | 'warning' | 'error' {
  if (delta <= 0) return 'success';
  if (delta <= 15) return 'warning';
  return 'error';
}

function deltaLabel(delta: number): string {
  return delta > 0 ? `+${delta} min` : `${delta} min`;
}

/** Planned vs. actual duration for clocked events (Settings → Insights). */
export function DurationStatsPanel() {
  const [entries, setEntries] = useState<DurationStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  useEffect(() => {
    let alive = true;
    getDurationStats()
      .then(r => { if (alive) { setEntries(r.entries); setLoading(false); } })
      .catch(() => { if (alive) { setError(true); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  if (error) {
    return (
      <div className={styles.errorRow} role="alert">
        <Badge tone="error" icon={Icons.alertCircle}>Couldn't load duration stats</Badge>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.skeleton} aria-hidden="true">
        <Skeleton height={14} />
        <Skeleton height={14} />
        <Skeleton height={14} width="70%" />
      </div>
    );
  }

  if (!entries.length) {
    return (
      <EmptyState
        compact
        icon={Icons.timer}
        title="No tracked events yet"
        description="Open an event and choose Start tracking to compare planned and actual time."
      />
    );
  }

  const avgDelta = Math.round(entries.reduce((s, e) => s + e.delta_minutes, 0) / entries.length);
  const totalActual = entries.reduce((s, e) => s + e.actual_minutes, 0);

  return (
    <div className={styles.panel}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col" className={styles.num}>Planned</th>
            <th scope="col" className={styles.num}>Actual</th>
            <th scope="col" className={styles.num}>Delta</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id}>
              <td className={styles.titleCell} title={e.title}>{e.title}</td>
              <td className={styles.num}>{e.planned_minutes} min</td>
              <td className={styles.num}>{e.actual_minutes} min</td>
              <td className={styles.num}>
                <Badge size="sm" tone={deltaTone(e.delta_minutes)}>{deltaLabel(e.delta_minutes)}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className={styles.summary}>
        <li>Average overrun: <strong>{avgDelta > 0 ? `+${avgDelta}` : avgDelta} min</strong></li>
        <li>Total tracked time: <strong>{Math.round(totalActual / 60 * 10) / 10} hrs</strong></li>
      </ul>
    </div>
  );
}
