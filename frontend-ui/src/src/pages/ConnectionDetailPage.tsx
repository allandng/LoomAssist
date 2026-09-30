// Settings → Connections → one connection.
//
// Subscribed calendars come from GET /connections/{id}/calendars (the join rows,
// with per-row sync direction editable in place). Disconnect asks, per timeline,
// whether to keep or delete the synced events and passes those decisions on.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSync } from '../contexts/SyncContext';
import { useModal } from '../contexts/ModalContext';
import { useNotifications } from '../store/notifications';
import {
  type Connection,
  listConnectionCalendars, listCalendars,
  unsubscribeCalendar, patchConnectionCalendar, disconnectConnection,
  startGoogleConnection, type DisconnectTimelineDecision,
} from '../api';
import type { Calendar, ConnectionCalendar } from '../types';
import {
  PageHeader, Card, CardHeader, CardBody, Badge, Button, IconButton, Select, Skeleton, EmptyState,
  Icon, Icons, TLDot, confirm,
} from '../components/ui';
import { SettingsLayout } from '../components/settings/SettingsLayout';
import { ProviderGlyph } from '../components/settings/ProviderGlyph';
import { providerMeta } from '../components/settings/providers';
import { statusMeta, DIRECTION_LABEL } from '../components/settings/connectionStatus';
import { DisconnectDialog, type DisconnectTimeline } from '../components/settings/DisconnectDialog';
import { errMessage, openExternal, relativeTime } from '../components/settings/util';
import styles from './ConnectionsPages.module.css';

type Direction = 'both' | 'pull' | 'push';

/** Normalised view of a ConnectionCalendar row regardless of which field spelling the backend used. */
interface CalRow {
  id: string;
  name: string;
  remoteId: string;
  timelineId: number | null;
  direction: Direction;
  color: string | null;
  lastSynced: string | null;
}

function normalise(cc: ConnectionCalendar): CalRow {
  // Canonical columns first; the alias keys are the same values under the older names.
  const row = cc as Partial<ConnectionCalendar>;
  return {
    id: cc.id,
    name: row.remote_display_name || row.name || '(Untitled calendar)',
    remoteId: row.remote_calendar_id || row.remote_id || cc.id,
    timelineId: row.local_calendar_id ?? row.timeline_id ?? row.calendar_id ?? null,
    direction: cc.sync_direction,
    color: row.remote_color ?? row.color ?? null,
    lastSynced: row.last_full_sync_at ?? row.last_synced_at ?? null,
  };
}

export function ConnectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { connections, refreshConnections, refreshStatuses, runOne, pause, resume } = useSync();
  const { openSubscribeDrawer, openCalDAVCredentials } = useModal();
  const { addNotification } = useNotifications();

  const conn: Connection | undefined = connections.find(c => c.id === id);

  // Resolve "loading" vs "not found": refresh the list once, then decide.
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    refreshConnections().finally(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, [refreshConnections]);

  const [rows, setRows]           = useState<CalRow[] | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const [busy, setBusy]           = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);

  const loadRows = useCallback(async () => {
    if (!id) return;
    try {
      const [ccs, cals] = await Promise.all([listConnectionCalendars(id), listCalendars().catch(() => [] as Calendar[])]);
      setRows(ccs.map(normalise));
      setTimelines(cals);
      setRowsError(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setRows([]);
      setRowsError(status === 401 ? 'The provider rejected the saved sign-in. Reconnect to load calendars.' : errMessage(e, 'Could not load the subscribed calendars.'));
    }
  }, [id]);

  // Boot-time fetch; state is set inside the async path, not synchronously.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadRows(); }, [loadRows]);

  const timelineById = useMemo(() => new Map(timelines.map(t => [t.id, t])), [timelines]);

  if (!conn) {
    if (!checked) {
      return (
        <SettingsLayout>
          <div className={styles.stack} aria-busy="true">
            <Skeleton width={160} height={12} />
            <Skeleton width={320} height={28} />
            <Skeleton width="100%" height={120} radius={12} />
          </div>
        </SettingsLayout>
      );
    }
    return (
      <SettingsLayout>
        <Card>
          <EmptyState
            icon={Icons.cloud}
            title="Connection not found"
            description="It may have been disconnected on this device. Your local events are unaffected."
            action={{ label: 'All connections', icon: Icons.arrowLeft, onClick: () => navigate('/settings/connections') }}
          />
        </Card>
      </SettingsLayout>
    );
  }

  const provider = providerMeta(conn.kind);
  const status = statusMeta(conn.status);
  const paused = conn.status === 'paused';
  const authExpired = conn.status === 'auth_expired';

  async function handleReconnect() {
    if (!conn) return;
    if (conn.kind === 'google') {
      try {
        const { auth_url } = await startGoogleConnection();
        await openExternal(auth_url);
        addNotification({ type: 'info', title: 'Finish signing in with Google in your browser', message: 'Come back here when it is done; the connection resumes on its own.' });
      } catch (e) {
        addNotification({ type: 'error', title: 'Reconnect failed', message: errMessage(e) });
      }
    } else {
      openCalDAVCredentials(conn.kind);
    }
  }

  async function handleSync() {
    if (!conn) return;
    setBusy('sync');
    try {
      await runOne(conn.id);
      addNotification({ type: 'info', title: `Syncing ${conn.display_name}`, severity: 'ambient', autoRemoveMs: 4000 });
    } catch (e) {
      addNotification({ type: 'error', title: 'Sync failed', message: errMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function handlePauseResume() {
    if (!conn) return;
    setBusy('pause');
    try {
      if (paused) await resume(conn.id); else await pause(conn.id);
    } catch (e) {
      addNotification({ type: 'error', title: paused ? 'Could not resume' : 'Could not pause', message: errMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function handleDirection(row: CalRow, direction: Direction) {
    if (!conn || direction === row.direction) return;
    setBusy(row.id);
    try {
      await patchConnectionCalendar(conn.id, row.id, { sync_direction: direction });
      setRows(prev => prev?.map(r => (r.id === row.id ? { ...r, direction } : r)) ?? prev);
    } catch (e) {
      addNotification({ type: 'error', title: 'Could not change sync direction', message: errMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function handleUnsubscribe(row: CalRow) {
    if (!conn) return;
    const ok = await confirm({
      title: `Stop syncing "${row.name}"?`,
      description: 'Events already on this device stay here as local events. The calendar on the provider is not changed.',
      confirmLabel: 'Stop syncing',
      destructive: true,
    });
    if (!ok) return;
    setBusy(row.id);
    try {
      await unsubscribeCalendar(conn.id, row.id);
      await loadRows();
      await refreshStatuses();
    } catch (e) {
      addNotification({ type: 'error', title: 'Could not stop syncing', message: errMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect(decisions: DisconnectTimelineDecision[]) {
    if (!conn) return;
    setDisconnecting(true);
    try {
      await disconnectConnection(conn.id, decisions);
      addNotification({ type: 'success', title: `Disconnected ${conn.display_name}`, autoRemoveMs: 3000 });
      setShowDisconnect(false);
      await refreshConnections();
      await refreshStatuses();
      navigate('/settings/connections');
    } catch (e) {
      addNotification({ type: 'error', title: 'Disconnect failed', message: errMessage(e) });
    } finally {
      setDisconnecting(false);
    }
  }

  const disconnectTimelines: DisconnectTimeline[] = (() => {
    const seen = new Map<number, DisconnectTimeline>();
    for (const r of rows ?? []) {
      if (r.timelineId == null) continue;
      const tl = timelineById.get(r.timelineId);
      const existing = seen.get(r.timelineId);
      if (existing) continue;
      seen.set(r.timelineId, { id: r.timelineId, name: tl?.name ?? r.name, color: tl?.color ?? r.color ?? undefined });
    }
    return [...seen.values()];
  })();

  return (
    <SettingsLayout>
      <PageHeader
        eyebrow={
          <Button variant="subtle" size="sm" icon={Icons.arrowLeft} onClick={() => navigate('/settings/connections')}>
            All connections
          </Button>
        }
        title={
          <span className={styles.detailTitle}>
            <span className={styles.glyph} aria-hidden="true"><ProviderGlyph id={provider.id} size={18} /></span>
            {conn.display_name}
          </span>
        }
        description={`${conn.account_email} · ${provider.label}`}
        actions={
          <>
            <Badge tone={status.tone} dot title={conn.last_error ?? undefined}>{status.label}</Badge>
            <Button variant="secondary" size="sm" icon={Icons.sync} loading={busy === 'sync'} disabled={busy !== null || paused || authExpired} onClick={handleSync}>Sync now</Button>
            <Button variant="ghost" size="sm" icon={paused ? Icons.play : Icons.pause} loading={busy === 'pause'} disabled={busy !== null} onClick={handlePauseResume}>{paused ? 'Resume' : 'Pause'}</Button>
          </>
        }
      />

      <div className={styles.stack}>
        {authExpired && (
          <div className={`${styles.banner} ${styles.bannerWarning}`} role="status">
            <Icon d={Icons.warning} size={15} className={styles.bannerIcon} />
            <span className={styles.bannerText}>
              {provider.label} no longer accepts the saved sign-in. Reconnect to resume syncing — nothing on this device is lost.
            </span>
            <Button variant="primary" size="sm" onClick={handleReconnect}>Reconnect</Button>
          </div>
        )}
        {conn.status === 'error' && conn.last_error && (
          <div className={`${styles.banner} ${styles.bannerError}`} role="status">
            <Icon d={Icons.alertCircle} size={15} className={styles.bannerIcon} />
            <span className={styles.bannerText}>Last sync failed: {conn.last_error}</span>
          </div>
        )}

        <Card as="section" flush aria-labelledby="conn-cals-title">
          <CardHeader
            title={<span id="conn-cals-title">Calendars</span>}
            description="Each subscribed calendar maps to a timeline here. Direction controls which side wins on changes."
            actions={<Button size="sm" variant="secondary" icon={Icons.plus} onClick={() => openSubscribeDrawer(conn.id)}>Subscribe to more</Button>}
          />
          <CardBody>
            {rows === null && (
              <div className={styles.listPad} aria-busy="true">
                <div className={styles.stackSm}><Skeleton width="45%" /><Skeleton width="60%" /><Skeleton width="35%" /></div>
              </div>
            )}
            {rowsError && (
              <div className={`${styles.banner} ${styles.bannerError} ${styles.bannerInset}`} role="alert">
                <Icon d={Icons.alertCircle} size={15} className={styles.bannerIcon} />
                <span className={styles.bannerText}>{rowsError}</span>
                <Button size="sm" variant="ghost" onClick={loadRows}>Retry</Button>
              </div>
            )}
            {rows && rows.length === 0 && !rowsError && (
              <EmptyState
                compact
                icon={Icons.calendar}
                title="No calendars subscribed"
                description="Pick which of this account's calendars to bring into LoomAssist."
                action={{ label: 'Choose calendars', icon: Icons.plus, onClick: () => openSubscribeDrawer(conn.id) }}
              />
            )}
            {rows && rows.length > 0 && (
              <ul className={styles.calList}>
                {rows.map(row => {
                  const tl = row.timelineId != null ? timelineById.get(row.timelineId) : undefined;
                  const rowBusy = busy === row.id;
                  return (
                    <li key={row.id} className={styles.calRow}>
                      <TLDot color={tl?.color ?? row.color ?? 'var(--accent)'} size={10} />
                      <div className={styles.calMain}>
                        <span className={styles.calName}>{row.name}</span>
                        <span className={styles.calMeta}>
                          {tl ? <>Timeline <strong>{tl.name}</strong></> : 'Timeline not found'}
                          <span aria-hidden="true"> · </span>
                          Synced {relativeTime(row.lastSynced, 'never')}
                        </span>
                      </div>
                      <Select
                        size="sm"
                        className={styles.dirSelect}
                        aria-label={`Sync direction for ${row.name}`}
                        value={row.direction}
                        disabled={rowBusy}
                        onChange={e => handleDirection(row, e.target.value as Direction)}
                      >
                        {(Object.keys(DIRECTION_LABEL) as Direction[]).map(d => (
                          <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>
                        ))}
                      </Select>
                      <IconButton size="sm" icon={Icons.x} label={`Stop syncing ${row.name}`} disabled={rowBusy} onClick={() => handleUnsubscribe(row)} />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card as="section" aria-labelledby="conn-disconnect-title">
          <CardHeader
            title={<span id="conn-disconnect-title">Disconnect this account</span>}
            description="Stops all syncing and removes the sign-in from this device. You choose what happens to each synced timeline; the provider is never modified."
            actions={<Button variant="danger" onClick={() => setShowDisconnect(true)}>Disconnect…</Button>}
          />
        </Card>
      </div>

      {showDisconnect && (
        <DisconnectDialog
          connectionName={conn.display_name}
          timelines={disconnectTimelines}
          busy={disconnecting}
          onCancel={() => setShowDisconnect(false)}
          onConfirm={handleDisconnect}
        />
      )}
    </SettingsLayout>
  );
}
