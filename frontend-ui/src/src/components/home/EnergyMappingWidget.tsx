import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './EnergyMappingWidget.module.css';
import densityStyles from '../shared/DensityHeatmap.module.css';
import { getEnergyMap, type EnergyMap } from '../../api';
import { Card, CardHeader, CardBody, Badge, EmptyState, Skeleton, Icons } from '../ui';
import { relativeTime } from '../../lib/time';

const INTENSITY = [
  densityStyles.hmL0,
  densityStyles.hmL1,
  densityStyles.hmL2,
  densityStyles.hmL3,
  densityStyles.hmL4,
] as const;

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const HOUR_TICKS = new Set([0, 6, 12, 18]);
const WEEKS = 12;

function formatHour(h: number): string {
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

export function EnergyMappingWidget() {
  const navigate = useNavigate();
  const [data, setData]       = useState<EnergyMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  useEffect(() => {
    let cancelled = false;
    getEnergyMap(WEEKS)
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
      return 'Based on scheduled events. Complete a few pomodoro sessions to refine it.';
    }
    if (data.source === 'mixed') {
      return `${data.total} pomodoro session${data.total !== 1 ? 's' : ''} in the last ${data.weeks} weeks, shown alongside scheduled events.`;
    }
    const fresh = data.last_session_at ? ` · last ${relativeTime(data.last_session_at)}` : '';
    return `Last ${data.weeks} weeks · ${data.total} session${data.total !== 1 ? 's' : ''}${fresh}`;
  }, [data]);

  const isEmpty = !loading && !error && max === 0;

  return (
    <Card>
      <CardHeader
        title="Energy map"
        description="When your focus sessions land, by weekday and hour"
      />
      <CardBody>
        {error ? (
          <div className={styles.errorRow} role="alert">
            <Badge tone="error" icon={Icons.alertCircle}>Couldn't load energy data</Badge>
          </div>
        ) : loading ? (
          <Skeleton height={148} />
        ) : isEmpty ? (
          <EmptyState
            compact
            icon={Icons.zap}
            title="No focus data yet"
            description="Complete a few pomodoro sessions and your energy map will fill in."
            action={{ label: 'Start focus', onClick: () => navigate('/focus') }}
          />
        ) : (
          <div className={styles.body}>
            <div className={styles.hourRow} aria-hidden="true">
              <span className={styles.dayLabelSpacer} />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className={[styles.hourTick, HOUR_TICKS.has(h) ? '' : styles.hourTickHidden].join(' ')}>
                  {formatHour(h)}
                </span>
              ))}
            </div>

            <div className={styles.gridWrap} role="img" aria-label="Focus intensity by weekday and hour">
              {DAY_LABELS.map((label, dow) => (
                <div key={label} className={styles.dayRow}>
                  <span className={styles.dayLabel}>{label}</span>
                  <div className={styles.cells}>
                    {Array.from({ length: 24 }, (_, h) => {
                      const count = data?.grid[dow]?.[h] ?? 0;
                      const level = max === 0 || count === 0
                        ? 0
                        : Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
                      return (
                        <span
                          key={h}
                          className={`${styles.cell} ${INTENSITY[level]}`}
                          title={`${label} ${formatHour(h)}: ${count} session${count !== 1 ? 's' : ''}`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <p className={styles.caption}>{caption}</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
