// Phase v3.0: Settings → Connections.
//
// Per mockup-accounts.jsx: list of connections with status pills + Manage btn.
// "Add connection" CTA opens the ProviderPicker modal.
//
// Per design doc §11 R5 + §10 Q7: privacy reminder at the bottom enumerates
// the local-first guarantees.

import { useNavigate } from 'react-router-dom';
import { useSync } from '../contexts/SyncContext';
import { useModal } from '../contexts/ModalContext';
import { Icon, Icons } from '../components/shared/Icon';
import type { Connection, ConnectionStatus } from '../api';
import styles from './ConnectionsPages.module.css';

function relativeTime(iso: string | null): string {
  if (!iso) return 'never synced';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 'never synced';
  const ms = Date.now() - t;
  if (ms < 60_000)     return 'just now';
  if (ms < 3_600_000)  return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function statusInfo(s: ConnectionStatus) {
  switch (s) {
    case 'connected':    return { cls: styles.pillSuccess, label: 'Connected' };
    case 'paused':       return { cls: styles.pill,        label: 'Paused' };
    case 'auth_expired': return { cls: styles.pillError,   label: 'Reconnect needed' };
    case 'error':        return { cls: styles.pillError,   label: 'Error' };
    default:             return { cls: styles.pill,        label: s };
  }
}

export function ConnectionsSettingsPage() {
  const navigate = useNavigate();
  const { connections } = useSync();
  const { openProviderPicker } = useModal();

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <h2 className={styles.headerTitle}>Connections</h2>
        <span className={styles.spacer} />
        <button className="loom-btn-primary" onClick={() => openProviderPicker()}>
          <Icon d={Icons.plus} size={12} /> Add connection
        </button>
      </div>
      <p className={styles.lede}>
        Each connection syncs directly between this device and the provider.
        Disconnecting keeps your local events; the provider is never modified.
      </p>

      {connections.length === 0 ? (
        <div className={styles.empty}>
          <h3 className={styles.emptyTitle}>No connections yet</h3>
          <p className={styles.emptyLede}>
            Connect Google Calendar or iCloud to mirror events into LoomAssist.
            All sync is direct device ↔ provider — no event data ever traverses
            a LoomAssist server.
          </p>
          <button className="loom-btn-primary" onClick={() => openProviderPicker()}>
            <Icon d={Icons.plus} size={12} /> Add your first connection
          </button>
        </div>
      ) : (
        <div className={styles.list}>
          {connections.map(c => <Row key={c.id} c={c} onClick={() => navigate(`/settings/connections/${c.id}`)} />)}
        </div>
      )}

      <div className={styles.privacyNote}>
        <Icon d={Icons.user} size={14} stroke="var(--success)" />
        <span>
          OAuth tokens and CalDAV passwords are stored in the macOS Keychain,
          scoped per-connection. Calendar data lives in local SQLite — no event
          ever leaves this device en route to a LoomAssist server.
        </span>
      </div>
    </div>
  );
}

function Row({ c, onClick }: { c: Connection; onClick: () => void }) {
  const info = statusInfo(c.status);
  return (
    <button
      type="button"
      className={styles.row}
      style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', width: '100%', textAlign: 'left', cursor: 'pointer' }}
      onClick={onClick}
    >
      <div className={styles.rowKindIcon}>
        <Icon d={c.kind === 'google' ? Icons.mail : c.kind === 'caldav_icloud' ? Icons.upload : Icons.doc} size={18} />
      </div>
      <div className={styles.rowInfo}>
        <div className={styles.rowName}>
          {c.display_name}
        </div>
        <div className={styles.rowEmail}>{c.account_email}</div>
        <div className={styles.rowMeta}>last synced {relativeTime(c.last_synced_at)}</div>
      </div>
      <span className={`${styles.pill} ${info.cls}`}>{info.label}</span>
      <Icon d={Icons.chevronRight} size={14} stroke="var(--text-muted)" />
    </button>
  );
}
