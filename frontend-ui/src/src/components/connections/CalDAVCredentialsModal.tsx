// Phase v3.0: CalDAVCredentialsModal — server URL + username + password +
// inline 'Test connection' button (POST /connections/caldav/test).
// iCloud preset prefills https://caldav.icloud.com and renders the helper line
// about app-specific passwords (per design doc §6 Flow B).

import { useState } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useSync } from '../../contexts/SyncContext';
import { useNotifications } from '../../store/notifications';
import { Icon, Icons } from '../shared/Icon';
import { testCalDAV, createCalDAVConnection } from '../../api';
import styles from './connections.module.css';

const ICLOUD_BASE = 'https://caldav.icloud.com';

export function CalDAVCredentialsModal({
  kind,
  onCreated,
}: {
  kind: 'caldav_icloud' | 'caldav_generic';
  onCreated?: (connectionId: string) => void;
}) {
  const { close, openSubscribeDrawer } = useModal();
  const { refreshConnections, refreshStatuses } = useSync();
  const { addNotification } = useNotifications();

  const [baseUrl, setBaseUrl]   = useState(kind === 'caldav_icloud' ? ICLOUD_BASE : '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [test, setTest]         = useState<{ ok?: boolean; error?: string } | null>(null);
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  async function handleTest() {
    if (!baseUrl || !username || !password) return;
    setBusy(true); setTest(null); setErr(null);
    try {
      const r = await testCalDAV(baseUrl, username, password);
      setTest(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true); setErr(null);
    try {
      const conn = await createCalDAVConnection({
        kind, base_url: baseUrl, username, password,
      });
      await refreshConnections();
      await refreshStatuses();
      addNotification({ type: 'success', title: 'Connection added', autoRemoveMs: 3000 });
      close();
      onCreated?.(conn.id);
      // Auto-open subscribe drawer so the user picks which calendars to sync.
      openSubscribeDrawer(conn.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.shell} role="dialog" aria-modal="true" aria-label="CalDAV credentials">
      <div className={styles.header}>
        <span className={styles.headerTitle}>
          {kind === 'caldav_icloud' ? 'Connect iCloud' : 'Connect CalDAV server'}
        </span>
        <button className={styles.closeBtn} onClick={() => close()}>
          <Icon d={Icons.x} size={14} />
        </button>
      </div>

      <div className={styles.body}>
        {kind === 'caldav_icloud' && (
          <p className={styles.lede}>
            iCloud requires an <strong>app-specific password</strong> from{' '}
            <code>appleid.apple.com</code> — your normal Apple ID password won't work.
            We never see this password; it's stored in the macOS Keychain.
          </p>
        )}

        {err && <div className={styles.errorBox}>{err}</div>}

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="caldav-url">Server URL</label>
          <input
            id="caldav-url"
            className="loom-field"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://caldav.example.com"
            disabled={kind === 'caldav_icloud' || busy}
          />
          {kind === 'caldav_generic' && (
            <div className={styles.fieldHint}>
              Examples: <code>https://caldav.fastmail.com</code>,{' '}
              <code>https://your.nextcloud.example/remote.php/dav</code>
            </div>
          )}
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="caldav-user">Username / Email</label>
          <input
            id="caldav-user"
            className="loom-field"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="you@example.com"
            disabled={busy}
            autoComplete="username"
          />
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="caldav-pw">
            {kind === 'caldav_icloud' ? 'App-specific password' : 'Password'}
          </label>
          <input
            id="caldav-pw"
            className="loom-field"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={busy}
            autoComplete="current-password"
          />
        </div>

        <div className={styles.testRow}>
          <button
            type="button"
            className="loom-btn-ghost"
            onClick={handleTest}
            disabled={!baseUrl || !username || !password || busy}
          >
            Test connection
          </button>
          {test?.ok && (
            <span className={styles.testOk}>
              <Icon d={Icons.check} size={12} stroke="var(--success)" />
              Connection ok
            </span>
          )}
          {test?.ok === false && (
            <span className={styles.testErr}>
              <Icon d={Icons.x} size={12} stroke="var(--error)" />
              {test.error || 'Connection failed'}
            </span>
          )}
        </div>
      </div>

      <div className={styles.footer}>
        <span className={styles.spacer} />
        <button className="loom-btn-ghost" onClick={() => close()} disabled={busy}>Cancel</button>
        <button
          className="loom-btn-primary"
          onClick={handleSave}
          disabled={busy || !baseUrl || !username || !password}
        >
          Save connection
        </button>
      </div>
    </div>
  );
}
