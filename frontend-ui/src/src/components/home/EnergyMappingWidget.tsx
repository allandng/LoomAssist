import { useEffect, useMemo, useState } from 'react';
import styles from './EnergyMappingWidget.module.css';
import densityStyles from '../shared/DensityHeatmap.module.css';
import { getEnergyMap, type EnergyMap } from '../../api';

const INTENSITY = [
  densityStyles.hmL0,
  densityStyles.hmL1,
  densityStyles.hmL2,
  densityStyles.hmL3,
  densityStyles.hmL4,
] as const;

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const HOUR_TICKS = [0, 6, 12, 18] as const;

function formatHour(h: number): string {
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || isNaN(ms)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function EnergyMappingWidget() {
  const [data, setData] = useState<EnergyMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getEnergyMap(12)
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const max = useMemo(() => {
    if (!data) return 0;
    let m = 0;
    for (const row of data.grid) for (const v of row) if (v > m) m = v;
    return m;
  }, [data]);

  const caption = useMemo(() => {
    if (!data) return '';
    if (data.source === 'events_proxy') {
      return 'Based on scheduled events — complete a few pomodoros to refine.';
    }
    if (data.source === 'mixed') {
      return `${data.total} pomodoro${data.total !== 1 ? 's' : ''} (last ${data.weeks}w) · scheduled events shown alongside`;
    }
    const fresh = data.last_session_at ? ` · last ${timeAgo(data.last_session_at)}` : '';
    return `Last ${data.weeks} weeks · ${data.total} session${data.total !== 1 ? 's' : ''}${fresh}`;
  }, [data]);

  return (
    <section className={styles.widget}>
      <h2 className={styles.heading}>Energy Map</h2>

      {error && (
        <p className={styles.empty}>Couldn't load energy data.</p>
      )}

      {!error && (
        <div className={styles.body}>
          <div className={styles.hourRow}>
            <div className={styles.dayLabelSpacer} />
            {Array.from({ length: 24 }, (_, h) => (
              <span
                key={h}
                className={styles.hourTick}
                style={HOUR_TICKS.includes(h as 0 | 6 | 12 | 18) ? undefined : { visibility: 'hidden' }}
              >
                {formatHour(h)}
              </span>
            ))}
          </div>

          <div className={styles.gridWrap}>
            {DAY_LABELS.map((label, dow) => (
              <div key={label} className={styles.dayRow}>
                <span className={styles.dayLabel}>{label}</span>
                <div className={styles.cells}>
                  {Array.from({ length: 24 }, (_, h) => {
                    const count = data?.grid[dow]?.[h] ?? 0;
                    const level = !data || max === 0 || count === 0
                      ? 0
                      : Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
                    return (
                      <span
                        key={h}
                        className={`${styles.cell} ${INTENSITY[level]}`}
                        title={`${label} ${formatHour(h)} — ${count} session${count !== 1 ? 's' : ''}`}
                        aria-label={`${label} ${formatHour(h)}, ${count} sessions`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <p className={styles.caption}>{loading ? 'Loading…' : caption}</p>
        </div>
      )}
    </section>
  );
}
