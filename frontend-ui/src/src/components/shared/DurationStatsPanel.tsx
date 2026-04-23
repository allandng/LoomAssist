import { useEffect, useState } from 'react';
import { getDurationStats } from '../../api';
import type { DurationStat } from '../../types';
import styles from './DurationStatsPanel.module.css';

export function DurationStatsPanel() {
  const [entries, setEntries] = useState<DurationStat[]>([]);

  useEffect(() => {
    getDurationStats().then(r => setEntries(r.entries)).catch(() => {});
  }, []);

  if (!entries.length) {
    return <p className={styles.empty}>No tracked events yet. Open any event and click "▶ Start Tracking" to begin.</p>;
  }

  const avgDelta = Math.round(entries.reduce((s, e) => s + e.delta_minutes, 0) / entries.length);
  const totalActual = entries.reduce((s, e) => s + e.actual_minutes, 0);

  function deltaClass(delta: number) {
    if (delta <= 0) return styles.under;
    if (delta <= 15) return styles.over;
    return styles.overRed;
  }

  function deltaLabel(delta: number) {
    return delta > 0 ? `+${delta} min` : `${delta} min`;
  }

  return (
    <div className={styles.panel}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Event</th>
            <th>Planned</th>
            <th>Actual</th>
            <th>Delta</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id}>
              <td className={styles.titleCell}>{e.title}</td>
              <td>{e.planned_minutes} min</td>
              <td>{e.actual_minutes} min</td>
              <td className={deltaClass(e.delta_minutes)}>{deltaLabel(e.delta_minutes)}</td>
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
