// Settings → Account → Connections.
//
// One card per provider connection with a human status, last-sync time and the
// quick actions (Sync now / Pause / Open). "Add connection" opens the provider
// picker. Sync runs device ↔ provider; disconnecting never touches the provider.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSync } from '../contexts/SyncContext';
import { useModal } from '../contexts/ModalContext';
import { useNotifications } from '../store/notifications';
import type { Connection } from '../api';
import { PageHeader, Card, Badge, Button, EmptyState, Icon, Icons } from '../components/ui';
import { SettingsLayout } from '../components/settings/SettingsLayout';
import { ProviderGlyph } from '../components/settings/ProviderGlyph';
import { providerMeta } from '../components/settings/providers';
import { statusMeta } from '../components/settings/connectionStatus';
import { errMessage, relativeTime } from '../components/settings/util';
import styles from './ConnectionsPages.module.css';

export function ConnectionsSettingsPage() {
  const navigate = useNavigate();
  const { connections } = useSync();
  const { openProviderPicker } = useModal();
  const hasAny = connections.length > 0;

  return (
    <SettingsLayout>
      <PageHeader
        eyebrow="Account"
        title="Connections"
        description="Each connection syncs directly between this device and the provider. Disconnecting keeps your local events."
        actions={hasAny && <Button variant="primary" icon={Icons.plus} onClick={() => openProviderPicker()}>Add connection</Button>}
      />

      <div className={styles.stack}>
        {!hasAny ? (
          <Card>
            <EmptyState
              icon={Icons.cloud}
              title="No connections yet"
              description="Connect Google Calendar, iCloud or any CalDAV server to mirror events into LoomAssist."
              action={{ label: 'Add connection', icon: Icons.plus, onClick: () => openProviderPicker() }}
            />
          </Card>
        ) : (
          connections.map(c => (
            <ConnectionCard key={c.id} conn={c} onOpen={() => navigate(`/settings/connections/${c.id}`)} />
          ))
        )}

        <div className={styles.note}>
          <Icon d={Icons.lock} size={14} className={styles.noteIcon} />
          <span>
            Sign-in tokens and CalDAV passwords are stored in your system keychain, scoped per connection.
            Calendar data lives in the local database and never passes through a LoomAssist server.
          </span>
        </div>
      </div>
    </SettingsLayout>
  );
}

function ConnectionCard({ conn, onOpen }: { conn: Connection; onOpen: () => void }) {
  const { runOne, pause, resume } = useSync();
  const { addNotification } = useNotifications();
  const [busy, setBusy] = useState<'sync' | 'pause' | null>(null);

  const provider = providerMeta(conn.kind);
  const status = statusMeta(conn.status);
  const paused = conn.status === 'paused';
  const canSync = conn.status === 'connected' || conn.status === 'error';

  async function handleSync() {
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
    setBusy('pause');
    try {
      if (paused) await resume(conn.id); else await pause(conn.id);
    } catch (e) {
      addNotification({ type: 'error', title: paused ? 'Could not resume' : 'Could not pause', message: errMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card as="article" aria-label={conn.display_name}>
      <div className={styles.connRow}>
        <span className={styles.glyph} aria-hidden="true"><ProviderGlyph id={provider.id} size={18} /></span>
        <div className={styles.connMain}>
          <div className={styles.connTitleRow}>
            <span className={styles.connName}>{conn.display_name}</span>
            <Badge tone={status.tone} dot size="sm" title={conn.last_error ?? undefined}>{status.label}</Badge>
          </div>
          <div className={styles.connMeta}>
            <span>{conn.account_email}</span>
            <span aria-hidden="true">·</span>
            <span>{provider.label}</span>
            <span aria-hidden="true">·</span>
            <span>Last synced {relativeTime(conn.last_synced_at, 'never')}</span>
          </div>
          {conn.last_error && conn.status === 'error' && (
            <div className={styles.connError} title={conn.last_error}>{conn.last_error}</div>
          )}
        </div>
        <div className={styles.connActions}>
          <Button size="sm" variant="secondary" icon={Icons.sync} loading={busy === 'sync'} disabled={!canSync || busy !== null} onClick={handleSync}>Sync now</Button>
          <Button size="sm" variant="ghost" icon={paused ? Icons.play : Icons.pause} loading={busy === 'pause'} disabled={busy !== null} onClick={handlePauseResume}>{paused ? 'Resume' : 'Pause'}</Button>
          <Button size="sm" variant="ghost" iconRight={Icons.chevronRight} onClick={onOpen}>Open</Button>
        </div>
      </div>
    </Card>
  );
}
