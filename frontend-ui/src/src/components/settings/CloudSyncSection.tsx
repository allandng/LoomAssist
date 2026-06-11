import { useCallback, useEffect, useState } from 'react';
import {
  cloudConfirm, cloudLock, cloudSignup, cloudSyncRun, cloudUnlock,
  getCloudStatus, type CloudStatus,
} from '../../api';
import { useNotifications } from '../../store/notifications';

const fieldStyle = {
  padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg-elevated)', color: 'var(--text-main)', fontSize: 13, width: 260,
} as const;

/**
 * Settings section for the v3.0 AWS E2E-encrypted sync (Stage 2).
 * One password does double duty: Cognito SRP sign-in + local KEK derivation.
 * Locking (or restarting the backend) drops the keys — re-unlock required.
 */
export function CloudSyncSection() {
  const { addNotification } = useNotifications();
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(() => {
    getCloudStatus().then(s => {
      setStatus(s);
      if (s.email) setEmail(s.email);
    }).catch(() => setStatus(null));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSignup = async () => {
    setBusy(true);
    try {
      await cloudSignup(email, password);
      setNeedsConfirm(true);
      addNotification({ type: 'info', title: 'Check your email', message: 'Enter the confirmation code to finish creating your sync account.' });
    } catch (e) {
      addNotification({ type: 'error', title: 'Sign-up failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await cloudConfirm(email, code);
      setNeedsConfirm(false);
      addNotification({ type: 'success', title: 'Account confirmed', message: 'You can now unlock cloud sync.' });
    } catch (e) {
      addNotification({ type: 'error', title: 'Confirmation failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setBusy(true);
    try {
      const r = await cloudUnlock(email, password);
      setPassword('');
      addNotification({
        type: 'success',
        title: r.vault_created ? 'Vault created' : 'Vault unlocked',
        message: r.vault_created
          ? 'End-to-end encrypted sync is set up. Your password is the only key — losing it means losing the vault.'
          : 'Cloud sync is ready.',
      });
      refresh();
    } catch (e) {
      addNotification({ type: 'error', title: 'Unlock failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleLock = async () => {
    await cloudLock();
    refresh();
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const s = await cloudSyncRun();
      addNotification({
        type: 'success', title: 'Sync complete', collapseKey: 'cloud-sync',
        message: `Pulled ${s.pull.created + s.pull.updated}, pushed ${s.push.pushed}, deleted ${s.pull.deleted + s.push.deleted}.`,
      });
      refresh();
    } catch (e) {
      addNotification({ type: 'error', title: 'Sync failed', message: String(e), collapseKey: 'cloud-sync' });
    } finally {
      setSyncing(false);
    }
  };

  const unlocked = status?.unlocked ?? false;

  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Sync events and tasks between your own devices through an end-to-end encrypted vault
        (AES-256-GCM; the server only ever stores ciphertext). Separate from provider
        connections and from your LoomAssist account — one password signs you in and derives
        the encryption key, and it never leaves this device.
      </p>

      {unlocked ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, color: 'var(--text-main)' }}>
            <span style={{ color: 'var(--success)', marginRight: 6 }}>●</span>
            Unlocked as <strong>{status?.email}</strong>
            {status?.last_synced_at && (
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}· last synced {new Date(status.last_synced_at).toLocaleString()}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="loom-btn-primary" onClick={handleSync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button className="loom-btn-ghost" onClick={handleLock}>Lock</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)} style={fieldStyle} />
          <input type="password" placeholder="Password" value={password}
            onChange={e => setPassword(e.target.value)} style={fieldStyle} />
          {needsConfirm && (
            <input placeholder="Confirmation code" value={code}
              onChange={e => setCode(e.target.value)} style={fieldStyle} />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {needsConfirm ? (
              <button className="loom-btn-primary" onClick={handleConfirm} disabled={busy || !code}>
                {busy ? 'Confirming…' : 'Confirm account'}
              </button>
            ) : (
              <>
                <button className="loom-btn-primary" onClick={handleUnlock}
                  disabled={busy || !email || !password}>
                  {busy ? 'Unlocking…' : 'Unlock / Sign in'}
                </button>
                <button className="loom-btn-ghost" onClick={handleSignup}
                  disabled={busy || !email || !password}>
                  Create sync account
                </button>
              </>
            )}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
            Unlocking takes a moment — the encryption key is derived on-device with scrypt.
          </p>
        </div>
      )}
    </>
  );
}
