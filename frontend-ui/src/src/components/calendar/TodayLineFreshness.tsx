// Phase v3.0 §8 ride-along #3: a small monochrome "synced 3m ago" label,
// shown only in time-grid views (Day / Week) when at least one connection
// exists. Updates every 30s. Disappears entirely in local-only mode.
//
// Anchored to the calendar's top-right corner via fixed positioning relative
// to the calendar container. Subtle, no new color, no new accent.

import { useEffect, useState } from 'react';
import { useSync } from '../../contexts/SyncContext';

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
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

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

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 16,
        zIndex: 5,
        pointerEvents: 'none',
        fontSize: 10.5,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-dim)',
        background: 'var(--bg-panel)',
        padding: '3px 8px',
        borderRadius: 999,
        border: '1px solid var(--border)',
      }}
      aria-hidden
    >
      synced {relativeTime(latest)}
    </div>
  );
}
