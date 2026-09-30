// A small monochrome "synced 3m ago" label for external connections, shown
// only in time-grid views (Day / Week) when at least one connection exists.
// Updates every 30s. Disappears entirely in local-only mode.
//
// Anchored to the grid's top-right corner (absolute inside the grid wrapper).

import { useEffect, useState } from 'react';
import styles from './TodayLineFreshness.module.css';
import { Badge } from '../ui';
import { useSync } from '../../contexts/SyncContext';
import { useIsVisibleRef } from '../../hooks/usePageVisibility';

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const ms = Date.now() - t;
  if (ms < 60_000)     return 'just now';
  if (ms < 3_600_000)  return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export function TodayLineFreshness({ view }: { view: string }) {
  const { connections } = useSync();
  // Force a re-render every 30s so the relative-time label stays fresh.
  const [, setTick] = useState(0);
  const visibleRef = useIsVisibleRef();
  useEffect(() => {
    const id = setInterval(() => {
      if (!visibleRef.current) return;
      setTick(t => t + 1);
    }, 30_000);
    return () => clearInterval(id);
  }, [visibleRef]);

  // Time-grid views only: Day + Week.
  if (view !== 'Day' && view !== 'Week') return null;
  if (connections.length === 0)          return null;

  // Most-recent sync across all connections.
  const latest = connections
    .map(c => c.last_synced_at)
    .filter((s): s is string => Boolean(s))
    .sort()
    .pop();
  if (!latest) return null;

  const label = `Synced ${relativeTime(latest)}`;
  return (
    <div
      className={styles.freshness}
      role="status"
      aria-live="polite"
      aria-label={`Connections ${label.toLowerCase()}`}
    >
      <Badge size="sm" dot tone="neutral" className={styles.badge}>{label}</Badge>
    </div>
  );
}
