// Phase v3.0: Settings → Connections → :id detail.
//
// Subscribed calendars list, sync direction, pause/resume, disconnect dialog
// (per-timeline keep/move/delete). Per design doc §6 Flow D: when status is
// auth_expired, banner with a single Reconnect button at the top.

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSync } from '../contexts/SyncContext';
import { useModal } from '../contexts/ModalContext';
import { useNotifications } from '../store/notifications';
import {
  type ConnectionCalendar, type Connection,
  unsubscribeCalendar, disconnectConnection,
  startGoogleConnection, runOneSync,
} from '../api';
import { Icon, Icons } from '../components/shared/Icon';
import styles from './ConnectionsPages.module.css';

export function ConnectionDetailPage() {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { connections, refreshConnections, refreshStatuses, runOne, pause, resume } = useSync();
  const { openSubscribeDrawer } = useModal();
  const { addNotification } = useNotifications();

  const conn: Connection | undefined = connections.find(c => c.id === id);
  const [ccs,  setCcs]  = useState<ConnectionCalendar[]>([]);
  const [busy, setBusy] = useState(false);

  const refreshCCs = useCallback(async () => {
    if (!id) return;
    try {
      // The backend doesn't expose a /connections/{id}/cc list yet — derive
      // from /sync/status (carries pending_review_count) plus the local DB
      // (subscribed calendars are visible to the user as timelines). For the
      // first cut we surface what we have via /events/.
      const r = await fetch(`http://localhost:8000/connections/${id}/calendars`);
      if (r.ok) {
        const remotes = await r.json() as Array<{ id: string; display_name: string }>;
        // Without a dedicated GET on ConnectionCalendar rows, we render the
        // remote list (which is what the user picked from). A subsequent
        // pass should add GET /connections/{id}/cc to expose the join rows
        // directly with sync_direction visible.
        setCcs(remotes.map(r => ({
          id: r.id,
          connection_id: id,
          local_calendar_id: 0,
          remote_calendar_id: r.id,
          remote_display_name: r.display_name,
          sync_direction: 'both' as const,
          sync_token: null, caldav_ctag: null,
          last_full_sync_at: null,
          created_at: '',
        })));
      }
    } catch { /* best-effort */ }
  }, [id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refreshCCs(); }, [refreshCCs]);

  if (!conn) {
    return (
      <div className={styles.page}>
        <p className={styles.lede}>Loading connection…</p>
        <button className="loom-btn-ghost" onClick={() => navigate('/settings/connections')}>
          ← Back to Connections
        </button>
      </div>
    );
  }

  async function handleReconnect() {
    if (!conn || conn.kind !== 'google') return;
    try {
      const { auth_url } = await startGoogleConnection();
      const inv = window.__TAURI_INTERNALS__?.invoke;
      if (inv) {
        try { await inv('plugin:opener|open_url', { url: auth_url }); return; } catch { /* fall through */ }
      }
      window.open(auth_url, '_blank');
    } catch (e) {
      addNotification({ type: 'error', title: 'Reconnect failed', message: e instanceof Error ? e.message : '' });
    }
  }

  async function handleSyncNow() {
    if (!conn) return;
    setBusy(true);
    try {
      await runOneSync(conn.id);
      await runOne(conn.id);
    } catch (e) {
      addNotification({ type: 'error', title: 'Sync failed', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  }

  async function handlePauseResume() {
    if (!conn) return;
    setBusy(true);
    try {
      if (conn.status === 'paused') await resume(conn.id);
      else                           await pause(conn.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleUnsubscribe(ccId: string) {
    if (!conn) return;
    if (!confirm('Stop syncing this calendar? Local events will become local-only (not deleted).')) return;
    setBusy(true);
    try {
      await unsubscribeCalendar(conn.id, ccId);
      await refreshCCs();
      await refreshStatuses();
    } catch (e) {
      addNotification({ type: 'error', title: 'Unsubscribe failed', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!conn) return;
    if (!confirm(
      'Disconnect this account?\n\n' +
      "Local events become local-only — they'll stay on this device.\n" +
      'Provider events are not modified.\n\n' +
      'Continue?',
    )) return;
    setBusy(true);
    try {
      await disconnectConnection(conn.id, []);
      addNotification({ type: 'success', title: 'Disconnected', autoRemoveMs: 3000 });
      await refreshConnections();
      await refreshStatuses();
      navigate('/settings/connections');
    } catch (e) {
      addNotification({ type: 'error', title: 'Disconnect failed', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  }

  const isAuthExpired = conn.status === 'auth_expired';

  return (
    <div className={styles.page}>
      <div className={styles.detailHeader}>
        <div className={styles.detailKindIcon}>
          <Icon d={conn.kind === 'google' ? Icons.mail : conn.kind === 'caldav_icloud' ? Icons.upload : Icons.doc} size={20} />
        </div>
        <div style={{ flex: 1 }}>
          <div className={styles.detailTitle}>{conn.display_name}</div>
          <div className={styles.detailMeta}>
            {conn.account_email} · {conn.kind} · status: {conn.status}
          </div>
        </div>
        <button className="loom-btn-ghost" onClick={() => navigate('/settings/connections')}>
          ← Back
        </button>
      </div>

      {isAuthExpired && (
        <div className={styles.banner}>
          <Icon d={Icons.x} size={14} stroke="var(--error)" />
          Reconnect {conn.kind === 'google' ? 'Google' : 'this account'} to resume sync. No data is lost.
          <span className={styles.bannerSpacer} />
          {conn.kind === 'google' && (
            <button className="loom-btn-primary" onClick={handleReconnect}>Reconnect</button>
          )}
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Calendars</h3>
          <span className={styles.spacer} />
          <button
            className="loom-btn-ghost"
            onClick={() => openSubscribeDrawer(conn.id)}
          >
            <Icon d={Icons.plus} size={12} /> Subscribe to more
          </button>
        </div>
        {ccs.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            No calendars subscribed yet — pick which to sync.
          </p>
        ) : (
          ccs.map(cc => (
            <div key={cc.id} className={styles.subRow}>
              <span className={styles.subRowName}>{cc.remote_display_name}</span>
              <span className={styles.subRowMeta}>{cc.sync_direction}</span>
              <button
                className="loom-btn-ghost"
                onClick={() => handleUnsubscribe(cc.id)}
                disabled={busy}
              >
                Unsubscribe
              </button>
            </div>
          ))
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Actions</h3>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="loom-btn-ghost" onClick={handleSyncNow} disabled={busy || conn.status === 'paused'}>
            <Icon d={Icons.sync} size={12} /> Sync now
          </button>
          <button className="loom-btn-ghost" onClick={handlePauseResume} disabled={busy}>
            <Icon d={conn.status === 'paused' ? Icons.play : Icons.pause} size={12} />
            {conn.status === 'paused' ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>

      <div className={styles.dangerSection}>
        <div className={styles.dangerTitle}>Disconnect</div>
        <p className={styles.dangerLede}>
          Disconnecting stops all syncing for this account. Local events become
          local-only (not deleted). Provider events are not touched.
        </p>
        <button
          className="loom-btn-ghost"
          style={{ borderColor: 'color-mix(in srgb, var(--error) 30%, var(--border))', color: 'var(--error)' }}
          onClick={handleDisconnect}
          disabled={busy}
        >
          Disconnect this account
        </button>
      </div>
    </div>
  );
}
