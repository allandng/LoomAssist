// SourceBadge — provenance for synced events.
//
// A single monochrome provider glyph + connection display name + "synced 2m
// ago". Lives in QuickPeek (bottom row) and the event editor (metadata
// cluster). Never on event pills.
//
// Attribution: the list endpoint doesn't expose the ConnectionCalendar →
// Connection map, so we attribute precisely only when it's unambiguous (one
// connection). With several connections we show the generic "Synced calendar"
// label and link to the connections list rather than guessing.

import { useNavigate } from 'react-router-dom';
import { useSync } from '../../contexts/SyncContext';
import { ProviderGlyph } from '../connections/ProviderGlyph';
import styles from './SourceBadge.module.css';

function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const ms = Date.now() - t;
  if (ms < 60_000)     return 'synced just now';
  if (ms < 3_600_000)  return `synced ${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `synced ${Math.round(ms / 3_600_000)}h ago`;
  return `synced ${Math.round(ms / 86_400_000)}d ago`;
}

export function SourceBadge({
  connectionCalendarId,
  lastSyncedAt,
  variant = 'inline',
}: {
  connectionCalendarId?: string | null;
  lastSyncedAt?: string | null;
  variant?: 'inline' | 'editor';
}) {
  const navigate = useNavigate();
  const { connections } = useSync();

  if (!connectionCalendarId) return null;

  // Best-effort attribution. `connection_calendar_id` is a ConnectionCalendar
  // row id, which the frontend can't map to a Connection without a dedicated
  // route; when exactly one connection exists it's the only possible source.
  const conn = connections.length === 1 ? connections[0] : null;
  const label = conn?.display_name ?? 'Synced calendar';
  const glyphKind = conn?.kind ?? 'generic';
  const href = conn ? `/settings/connections/${conn.id}` : '/settings/connections';

  if (variant === 'editor') {
    return (
      <div className={styles.editor}>
        <span className={styles.glyph}><ProviderGlyph kind={glyphKind} size={13} /></span>
        <span>Source</span>
        <button type="button" className={styles.link} onClick={() => navigate(href)}>
          {label}
        </button>
        {lastSyncedAt && <span className={styles.time}>· {relativeTime(lastSyncedAt)}</span>}
      </div>
    );
  }

  return (
    <div className={styles.inline}>
      <span className={styles.glyph}><ProviderGlyph kind={glyphKind} size={11} /></span>
      <span>{label}</span>
      {lastSyncedAt && <span className={styles.time}>· {relativeTime(lastSyncedAt)}</span>}
    </div>
  );
}
