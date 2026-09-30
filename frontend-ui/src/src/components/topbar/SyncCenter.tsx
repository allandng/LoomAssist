// SyncCenter — top-bar popover with one row per connection: status badge,
// last-synced, per-row sync / pause. Footer: "Sync all", the review count with
// a link to Sync review, and a link to Connections in Settings.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, Icons } from '../shared/Icon';
import { Badge, Button, EmptyState, IconButton, Popover, type BadgeTone } from '../ui';
import { useSync } from '../../contexts/SyncContext';
import { relativeTime } from '../../lib/time';
import type { Connection, SyncStatus } from '../../api';
import styles from './SyncCenter.module.css';

function lastSynced(iso: string | null): string {
  if (!iso) return 'never synced';
  const r = relativeTime(iso);
  return r ? `synced ${r}` : 'never synced';
}

function statusBadge(status: Connection['status']): { tone: BadgeTone; label: string } {
  switch (status) {
    case 'connected':    return { tone: 'success', label: 'Connected' };
    case 'paused':       return { tone: 'neutral', label: 'Paused' };
    case 'auth_expired': return { tone: 'error',   label: 'Reconnect' };
    case 'error':        return { tone: 'error',   label: 'Error' };
    default:             return { tone: 'neutral', label: status };
  }
}

export function SyncCenter() {
  const navigate = useNavigate();
  const { connections, statuses, reviewCount, runAll, runOne, pause, resume } = useSync();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);

  const hasError  = connections.some(c => c.status === 'auth_expired' || c.status === 'error');
  const isSyncing = connections.some(c => c.status === 'connected' && (statuses.find(s => s.connection_id === c.id)?.last_synced_at == null));
  const dotClass  = hasError ? styles.dotError : isSyncing ? styles.dotSyncing : connections.length === 0 ? styles.dotOff : styles.dotOk;
  const title = connections.length === 0
    ? 'Sync — no connections yet'
    : hasError ? 'Sync needs attention' : isSyncing ? 'Syncing…' : 'Sync';

  const go = (path: string) => { setOpen(false); navigate(path); };

  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className={[styles.trigger, open ? styles.triggerActive : ''].join(' ')}
        onClick={() => setOpen(o => !o)}
        title={title}
        aria-label={reviewCount > 0 ? `${title}, ${reviewCount} to review` : title}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={[styles.dot, dotClass].join(' ')} aria-hidden="true" />
        <Icon d={Icons.sync} size={15} className={isSyncing ? styles.spin : undefined} />
        {reviewCount > 0 && (
          <span className={styles.triggerBadge} aria-hidden="true">{reviewCount > 9 ? '9+' : reviewCount}</span>
        )}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} align="end" width={380} label="Sync" className={styles.popover}>
        <div className={styles.header}>
          <h2 className={styles.headerTitle}>Sync</h2>
          <Button size="sm" variant="ghost" icon={Icons.sync} onClick={() => runAll()} disabled={connections.length === 0}>
            Sync all
          </Button>
        </div>

        {connections.length === 0 ? (
          <EmptyState
            compact
            icon={Icons.cloud}
            title="No calendar connections"
            description="Connect Google or iCloud to mirror events into LoomAssist."
            action={{ label: 'Add connection', onClick: () => go('/settings/connections'), icon: Icons.plus }}
          />
        ) : (
          <>
            <ul className={styles.connList}>
              {connections.map(c => {
                const stat: SyncStatus | undefined = statuses.find(s => s.connection_id === c.id);
                return (
                  <SyncCenterRow
                    key={c.id}
                    conn={c}
                    reviewCount={stat?.pending_review_count ?? 0}
                    onSync={() => runOne(c.id)}
                    onPauseResume={() => (c.status === 'paused' ? resume(c.id) : pause(c.id))}
                  />
                );
              })}
            </ul>

            <div className={styles.footer}>
              {reviewCount > 0 ? (
                <>
                  <Badge tone="warning" dot>{reviewCount} to review</Badge>
                  <Button size="sm" variant="subtle" iconRight={Icons.arrowRight} onClick={() => go('/calendar/sync-review')}>
                    Open Sync review
                  </Button>
                </>
              ) : (
                <>
                  <span className={styles.footerNote}>All clear</span>
                  <Button size="sm" variant="subtle" iconRight={Icons.arrowRight} onClick={() => go('/settings/connections')}>
                    Manage connections
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </Popover>
    </>
  );
}

function SyncCenterRow({
  conn, reviewCount, onSync, onPauseResume,
}: {
  conn: Connection;
  reviewCount: number;
  onSync: () => void;
  onPauseResume: () => void;
}) {
  const badge = statusBadge(conn.status);
  const isProgress = conn.status === 'connected' && conn.last_synced_at == null;

  return (
    <li className={styles.connRow}>
      <div className={styles.connRowMain}>
        <span className={styles.connKindIcon} aria-hidden="true">
          <Icon
            d={conn.kind === 'google' ? Icons.mail : conn.kind === 'caldav_icloud' ? Icons.cloud : Icons.link}
            size={14}
          />
        </span>
        <div className={styles.connInfo}>
          <div className={styles.connName}>
            <span className={styles.connNameText}>{conn.display_name}</span>
            {reviewCount > 0 && <Badge tone="warning" size="sm">{reviewCount}</Badge>}
          </div>
          <div className={styles.connMeta}>
            <span className={styles.connEmail}>{conn.account_email}</span>
            <span aria-hidden="true">·</span>
            <span>{isProgress ? 'syncing…' : lastSynced(conn.last_synced_at)}</span>
          </div>
        </div>
        <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
        <div className={styles.connActions}>
          <IconButton icon={Icons.sync} label={`Sync ${conn.display_name} now`} size="sm" onClick={onSync} disabled={conn.status === 'paused'} />
          <IconButton
            icon={conn.status === 'paused' ? Icons.play : Icons.pause}
            label={conn.status === 'paused' ? `Resume ${conn.display_name}` : `Pause ${conn.display_name}`}
            size="sm"
            onClick={onPauseResume}
          />
        </div>
      </div>
      {isProgress && (
        <div className={styles.progressTrack} role="progressbar" aria-label="Syncing">
          <div className={styles.progressFill} />
        </div>
      )}
      {conn.last_error && (
        <div className={styles.connError}>{conn.last_error.slice(0, 120)}</div>
      )}
    </li>
  );
}
