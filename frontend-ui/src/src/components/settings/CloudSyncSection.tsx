import { useCallback, useEffect, useState } from 'react';
import {
  cloudConfirm, cloudLock, cloudSignup, cloudSyncRun, cloudUnlock,
  getCloudStatus, type CloudStatus,
} from '../../api';
import { useNotifications } from '../../store/notifications';
import { Badge, Button, Field, Input, Row, Skeleton } from '../ui';
import { errMessage, relativeTime } from './util';
import styles from './settings.module.css';

/**
 * Settings → Sync → Encrypted cloud vault (Stage 2 AWS E2E sync).
 * One password does double duty: cloud sign-in + local key derivation.
 * Locking (or restarting the backend) drops the keys, so re-unlock is needed.
 * Rendered inside a Card body by SyncSection.
 */
export function CloudSyncSection() {
  const { addNotification } = useNotifications();
  const [status, setStatus]     = useState<CloudStatus | null | 'unavailable'>(null);
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode]         = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [syncing, setSyncing]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const refresh = useCallback(() => {
    getCloudStatus()
      .then(s => { setStatus(s); if (s.email) setEmail(s.email); })
      .catch(() => setStatus('unavailable'));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleSignup() {
    setBusy(true); setError(null);
    try {
      await cloudSignup(email, password);
      setNeedsConfirm(true);
      addNotification({ type: 'info', title: 'Check your email', message: 'Enter the confirmation code to finish creating your sync account.' });
    } catch (e) {
      setError(errMessage(e, 'Sign-up failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    setBusy(true); setError(null);
    try {
      await cloudConfirm(email, code);
      setNeedsConfirm(false);
      addNotification({ type: 'success', title: 'Account confirmed', message: 'You can now unlock the vault.' });
    } catch (e) {
      setError(errMessage(e, 'Confirmation failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock() {
    setBusy(true); setError(null);
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
      setError(errMessage(e, 'Unlock failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleLock() {
    setBusy(true);
    try { await cloudLock(); refresh(); } finally { setBusy(false); }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const s = await cloudSyncRun();
      addNotification({
        type: 'success', title: 'Sync complete', collapseKey: 'cloud-sync', autoRemoveMs: 5000,
        message: `Pulled ${s.pull.created + s.pull.updated}, pushed ${s.push.pushed}, deleted ${s.pull.deleted + s.push.deleted}.`,
      });
      refresh();
    } catch (e) {
      addNotification({ type: 'error', title: 'Sync failed', message: errMessage(e), collapseKey: 'cloud-sync' });
    } finally {
      setSyncing(false);
    }
  }

  if (status === null) {
    return (
      <div className={styles.stack} aria-busy="true">
        <Skeleton width="60%" />
        <Skeleton width="40%" />
        <Skeleton width={120} height={32} />
      </div>
    );
  }

  if (status === 'unavailable') {
    return (
      <Row label="Vault" description="Cloud sync is not configured on this device's backend." divider={false}>
        <Badge tone="neutral">Unavailable</Badge>
      </Row>
    );
  }

  if (status.unlocked) {
    return (
      <>
        <Row label="Vault" description={status.email ?? undefined}>
          <Badge tone="success" dot>Unlocked</Badge>
        </Row>
        <Row label="Last synced" divider={false}>
          <span className={styles.value}>{relativeTime(status.last_synced_at, 'Not yet')}</span>
        </Row>
        <div className={styles.actions}>
          <Button variant="primary" loading={syncing} onClick={handleSync}>Sync now</Button>
          <Button variant="ghost" disabled={busy} onClick={handleLock}>Lock</Button>
        </div>
      </>
    );
  }

  const canSubmit = !!email && !!password && !busy;
  return (
    <form
      className={styles.vaultForm}
      onSubmit={e => { e.preventDefault(); if (needsConfirm) handleConfirm(); else if (canSubmit) handleUnlock(); }}
    >
      <div className={styles.vaultFields}>
        <Field label="Email" htmlFor="vault-email">
          <Input id="vault-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
        </Field>
        <Field label="Password" htmlFor="vault-password" hint="Signs you in and derives the encryption key on this device.">
          <Input id="vault-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
        </Field>
        {needsConfirm && (
          <Field label="Confirmation code" htmlFor="vault-code" className={styles.formWide} hint="From the email we just sent.">
            <Input id="vault-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} disabled={busy} />
          </Field>
        )}
      </div>
      {error && (
        <div className={`${styles.alert} ${styles.alertError}`} role="alert">
          <span className={styles.alertText}>{error}</span>
        </div>
      )}
      <div className={styles.actions}>
        {needsConfirm ? (
          <Button type="submit" variant="primary" loading={busy} disabled={!code}>Confirm account</Button>
        ) : (
          <>
            <Button type="submit" variant="primary" loading={busy} disabled={!email || !password}>Unlock</Button>
            <Button type="button" variant="ghost" disabled={!canSubmit} onClick={handleSignup}>Create sync account</Button>
          </>
        )}
        <span className={styles.dim}>Unlocking takes a moment — the key is derived on-device with scrypt.</span>
      </div>
    </form>
  );
}
