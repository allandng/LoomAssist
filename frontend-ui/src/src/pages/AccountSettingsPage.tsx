// Phase v3.0 AccountSettingsPage — display name edit + sign-out + sign-in CTA.
//
// Sign-out copy is deliberate per design doc §11 R5: explicitly enumerates that
// connections + events are preserved. Single-screen, no second confirm.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../contexts/AccountContext';
import styles from './AccountSettingsPage.module.css';

function initials(input: string): string {
  const parts = input.split(/[\s.@_-]/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function AccountSettingsPage() {
  const navigate = useNavigate();
  const { account, status, updateDisplayName, signOut } = useAccount();

  const [name, setName]   = useState(account?.display_name ?? '');
  const [busy, setBusy]   = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  // Sync the controlled input with whatever is in the Account when the page
  // mounts or when the underlying display_name changes (e.g. after Save).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setName(account?.display_name ?? ''); }, [account?.display_name]);

  if (status === 'loading') {
    return <div className={styles.page}>Loading account…</div>;
  }

  if (!account) {
    return (
      <div className={styles.page}>
        <div className={styles.localCard}>
          <h2 className={styles.localCardTitle}>You're in local mode</h2>
          <p className={styles.localCardLede}>
            LoomAssist is fully functional without an account. Sign in if you want
            your account preferences (display name, etc.) to follow you to another
            device. Calendar data always stays local — signing in won't change that.
          </p>
          <button className="loom-btn-primary" onClick={() => navigate('/auth/sign-in')}>
            Sign in or create an account
          </button>
        </div>
      </div>
    );
  }

  async function save() {
    if (!account) return;
    setBusy(true); setErr(null);
    try {
      await updateDisplayName(name);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true); setErr(null);
    try {
      await signOut();
      navigate('/calendar');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.avatar}>{initials(account.display_name || account.email)}</div>
        <div className={styles.profileInfo}>
          <div className={styles.profileName}>{account.display_name || account.email}</div>
          <div className={styles.profileMeta}>
            {account.email} · signed in with {account.auth_provider}
          </div>
        </div>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Profile</h2>
        <p className={styles.sectionLede}>
          Display name is editable. Email is managed at your sign-in provider.
        </p>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="acct-display-name">Display name</label>
          <input
            id="acct-display-name"
            className="loom-field"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={busy}
            placeholder={account.email.split('@')[0]}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Email</label>
          <input className="loom-field" type="email" value={account.email} disabled />
        </div>
        <div className={styles.actions}>
          <button className="loom-btn-primary" onClick={save} disabled={busy || name === (account.display_name ?? '')}>
            Save
          </button>
          {saved && <span className={styles.savedBadge}>Saved</span>}
        </div>
        {err && <div className={styles.errorBox}>{err}</div>}
      </section>

      <div className={styles.dangerZone}>
        <div className={styles.dangerTitle}>Sign out</div>
        <p className={styles.dangerLede}>
          Signing out clears your LoomAssist account from this device. It does
          <strong> not </strong>delete your local events, tasks, or anything else
          you've created.
        </p>
        <div className={styles.signOutNotice}>
          Your connections (Google, iCloud) will keep syncing as long as their tokens
          remain valid. To stop a connection, disconnect it from Settings → Connections.
        </div>
        <div className={styles.actions}>
          <button className="loom-btn-ghost" onClick={handleSignOut} disabled={busy}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
