// Phase v3.0: SyncCenter — top-bar popover replacing the static sync indicator.
//
// Per design doc §6 Flow E + mockup-sync-center.jsx: per-connection rows with
// status pill + last-synced + per-row pause/resume + thin progress bar while
// syncing. Footer: 'Sync all' button + 'Open Sync Review →' + 'Manage
// connections in Settings →'.
//
// Tab-trapped, Esc closes (handled by useEscapeClose hook below).

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, Icons } from '../shared/Icon';
import { useSync } from '../../contexts/SyncContext';
import type { Connection, SyncStatus } from '../../api';
import styles from './SyncCenter.module.css';

function relativeTime(iso: string | null): string {
  if (!iso) return 'never synced';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 'never synced';
  const ms = Date.now() - t;
  if (ms < 60_000)        return 'just now';
  if (ms < 3_600_000)     return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000)    return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function statusPill(status: Connection['status']) {
  switch (status) {
    case 'connected':    return { className: styles.pillSuccess, label: 'Connected' };
    case 'paused':       return { className: styles.pill,        label: 'Paused' };
    case 'auth_expired': return { className: styles.pillError,   label: 'Reconnect' };
    case 'error':        return { className: styles.pillError,   label: 'Error' };
    default:             return { className: styles.pill,        label: status };
  }
}

export function SyncCenter() {
  const navigate = useNavigate();
  const { connections, statuses, reviewCount, runAll, runOne, pause, resume } = useSync();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Esc closes; click outside closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const hasError    = connections.some(c => c.status === 'auth_expired' || c.status === 'error');
  const isSyncing   = connections.some(c => c.status === 'connected' && (statuses.find(s => s.connection_id === c.id)?.last_synced_at == null));
  const triggerLabel = connections.length === 0 ? 'Sync' : `${connections.length}`;

  return (
    <div className={styles.popoverWrap} ref={wrapRef}>
      <button
        className={`${styles.trigger} ${open ? styles.triggerActive : ''}`}
        onClick={() => setOpen(o => !o)}
        title={connections.length === 0 ? 'No connections — click to set up sync' : 'Sync Center'}
        aria-label="Sync Center"
      >
        <span
          className={`${styles.triggerDot} ${hasError ? styles.triggerDotError : isSyncing ? styles.triggerDotPulse : ''}`}
        />
        {triggerLabel}
        {reviewCount > 0 && (
          <span className={styles.triggerBadge} aria-label={`${reviewCount} pending review`}>
            {reviewCount > 9 ? '9+' : reviewCount}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="Sync Center">
          <div className={styles.header}>
            <Icon d={Icons.sync} size={14} stroke="var(--accent)" />
            <span className={styles.headerTitle}>Sync Center</span>
            <div className={styles.spacer} />
            <button
              className={styles.syncAllBtn}
              onClick={() => runAll()}
              disabled={connections.length === 0}
            >
              Sync all
            </button>
          </div>

          {connections.length === 0 ? (
            <div className={styles.empty}>
              No calendar connections yet.<br />
              Connect Google or iCloud to mirror events into LoomAssist.
              <button
                className={styles.emptyAction}
                onClick={() => { setOpen(false); navigate('/settings/connections'); }}
              >
                Manage connections →
              </button>
            </div>
          ) : (
            <>
              <div className={styles.connList}>
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
              </div>

              <div className={styles.footer}>
                {reviewCount > 0 ? (
                  <>
                    <span className={`${styles.pill} ${styles.pillWarning}`}>
                      {reviewCount} review
                    </span>
                    <span className={styles.spacer} />
                    <button
                      className={styles.footerLink}
                      onClick={() => { setOpen(false); navigate('/calendar/sync-review'); }}
                    >
                      Open Sync Review →
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ color: 'var(--text-muted)' }}>All clear.</span>
                    <span className={styles.spacer} />
                  </>
                )}
              </div>
              <button
                className={styles.footerSecondary}
                onClick={() => { setOpen(false); navigate('/settings/connections'); }}
              >
                Manage connections in Settings →
              </button>
            </>
          )}
        </div>
      )}
    </div>
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
  const pill = statusPill(conn.status);
  const isProgress = conn.status === 'connected' && conn.last_synced_at == null;

  return (
    <div className={styles.connRow}>
      <div className={styles.connRowMain}>
        <span className={styles.connKindIcon}>
          <Icon
            d={conn.kind === 'google' ? Icons.mail : conn.kind === 'caldav_icloud' ? Icons.upload : Icons.doc}
            size={14}
          />
        </span>
        <div className={styles.connInfo}>
          <div className={styles.connName}>
            {conn.display_name}
            {reviewCount > 0 && (
              <span className={`${styles.pill} ${styles.pillWarning}`}>{reviewCount}</span>
            )}
          </div>
          <div className={styles.connEmail}>{conn.account_email}</div>
        </div>
        <div className={styles.connRight}>
          <span className={`${styles.pill} ${pill.className}`}>{pill.label}</span>
          <span className={styles.connTimestamp}>{relativeTime(conn.last_synced_at)}</span>
        </div>
        <button
          className={styles.connAction}
          onClick={onSync}
          title="Sync now"
          disabled={conn.status === 'paused'}
        >
          <Icon d={Icons.sync} size={12} />
        </button>
        <button
          className={styles.connAction}
          onClick={onPauseResume}
          title={conn.status === 'paused' ? 'Resume' : 'Pause'}
        >
          <Icon d={conn.status === 'paused' ? Icons.play : Icons.pause} size={12} />
        </button>
      </div>
      {isProgress && (
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} />
        </div>
      )}
      {conn.last_error && (
        <div style={{ fontSize: 11, color: 'var(--error)', paddingLeft: 38 }}>
          {conn.last_error.slice(0, 120)}
        </div>
      )}
    </div>
  );
}
