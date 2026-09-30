// Settings → Account → Profile.
//
// Local mode is a first-class state, not an error: the page still owns the
// display name (used by the Home greeting) and offers sign-in as an option.
// Sign-out is non-destructive and confirms through the shared dialog.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../contexts/AccountContext';
import {
  PageHeader, Card, CardHeader, CardBody, Row, Avatar, Badge, Button, Input, Skeleton, Icon, Icons, confirm,
} from '../components/ui';
import { SettingsLayout } from '../components/settings/SettingsLayout';
import { ProviderGlyph } from '../components/settings/ProviderGlyph';
import { providerMeta } from '../components/settings/providers';
import { errMessage } from '../components/settings/util';
import styles from './AccountSettingsPage.module.css';

const LOCAL_NAME_KEY = 'loom_user_name';

export function AccountSettingsPage() {
  const { account, status, error } = useAccount();

  return (
    <SettingsLayout>
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description="Who LoomAssist greets, and whether that follows you to another device."
      />
      <div className={styles.stack}>
        {status === 'loading' && <LoadingCard />}
        {status === 'error' && (
          <div className={styles.alert} role="alert">
            <Icon d={Icons.alertCircle} size={14} className={styles.alertIcon} />
            <span>Could not reach the local backend to read your account. {error}</span>
          </div>
        )}
        {(status === 'local' || status === 'error') && <LocalProfile />}
        {status === 'signedIn' && account && <SignedInProfile />}
      </div>
    </SettingsLayout>
  );
}

function LoadingCard() {
  return (
    <Card aria-busy="true">
      <CardBody>
        <div className={styles.identity}>
          <Skeleton width={48} height={48} radius={24} />
          <div className={styles.identityText}>
            <Skeleton width={160} height={16} />
            <Skeleton width={220} />
          </div>
        </div>
        <div className={styles.skeletonRows}>
          <Skeleton width="100%" height={32} />
          <Skeleton width="100%" height={32} />
        </div>
      </CardBody>
    </Card>
  );
}

/* ── Local mode ─────────────────────────────────────────────────────────── */

function LocalProfile() {
  const navigate = useNavigate();
  const [name, setName] = useState(() => localStorage.getItem(LOCAL_NAME_KEY) ?? '');
  const [saved, setSaved] = useState(() => localStorage.getItem(LOCAL_NAME_KEY) ?? '');

  function save() {
    const trimmed = name.trim();
    if (trimmed) localStorage.setItem(LOCAL_NAME_KEY, trimmed);
    else localStorage.removeItem(LOCAL_NAME_KEY);
    setSaved(trimmed);
    setName(trimmed);
  }

  return (
    <>
      <Card as="section" aria-labelledby="acct-local-title">
        <CardBody>
          <div className={styles.identity}>
            <Avatar name={saved || null} size={48} />
            <div className={styles.identityText}>
              <div className={styles.identityName} id="acct-local-title">{saved || 'Using LoomAssist without an account'}</div>
              <div className={styles.identityMeta}>
                <Badge tone="neutral" dot>Local mode</Badge>
                <span>Everything works offline and stays on this device.</span>
              </div>
            </div>
          </div>
          <Row label="Display name" description="Used for the greeting on Home." divider={false}>
            <form className={styles.inlineForm} onSubmit={e => { e.preventDefault(); save(); }}>
              <Input
                aria-label="Display name"
                className={styles.nameInput}
                value={name}
                placeholder="Your name"
                autoComplete="nickname"
                onChange={e => setName(e.target.value)}
              />
              <Button type="submit" variant="secondary" disabled={name.trim() === saved}>Save</Button>
            </form>
          </Row>
        </CardBody>
      </Card>

      <Card as="section" aria-labelledby="acct-signin-title">
        <CardHeader
          title={<span id="acct-signin-title">Sign in</span>}
          description="Optional. An account carries your display name and preferences between devices. Calendar data always stays local."
          actions={<Button variant="primary" icon={Icons.logOut} onClick={() => navigate('/auth/sign-in?next=/settings/account')}>Sign in</Button>}
        />
      </Card>
    </>
  );
}

/* ── Signed in ──────────────────────────────────────────────────────────── */

function SignedInProfile() {
  const navigate = useNavigate();
  const { account, updateDisplayName, signOut } = useAccount();
  const current = account?.display_name ?? '';

  const [name, setName]     = useState(current);
  const [busy, setBusy]     = useState(false);
  const [saved, setSaved]   = useState(false);
  const [err, setErr]       = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  if (!account) return null;
  const provider = providerMeta(account.auth_provider);
  const dirty = name.trim() !== current;

  async function save() {
    if (!dirty) return;
    setBusy(true); setErr(null); setSaved(false);
    try {
      await updateDisplayName(name.trim());
      // Mirror to the local greeting so Home matches without a second field.
      if (name.trim()) localStorage.setItem(LOCAL_NAME_KEY, name.trim());
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(errMessage(e, 'Could not save your display name.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    const ok = await confirm({
      title: 'Sign out of LoomAssist?',
      description: 'Your events, tasks, timelines and calendar connections stay on this device exactly as they are. You can sign back in at any time.',
      confirmLabel: 'Sign out',
      icon: Icons.logOut,
    });
    if (!ok) return;
    setSigningOut(true); setErr(null);
    try {
      await signOut();
      navigate('/home');
    } catch (e) {
      setErr(errMessage(e, 'Could not sign out.'));
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
      <Card as="section" aria-labelledby="acct-profile-title">
        <CardBody>
          <div className={styles.identity}>
            <Avatar name={account.display_name || account.email} size={48} />
            <div className={styles.identityText}>
              <div className={styles.identityName} id="acct-profile-title">{account.display_name || account.email}</div>
              <div className={styles.identityMeta}>
                <Badge tone="success" dot>Signed in</Badge>
                <Badge tone="neutral" outline icon={<ProviderGlyph id={provider.id} size={11} />}>{provider.label}</Badge>
              </div>
            </div>
          </div>

          <Row label="Display name" description="Shown on Home and on any device you sign in to.">
            <form className={styles.inlineForm} onSubmit={e => { e.preventDefault(); save(); }}>
              <Input
                aria-label="Display name"
                className={styles.nameInput}
                value={name}
                placeholder={account.email.split('@')[0]}
                autoComplete="nickname"
                disabled={busy}
                onChange={e => { setName(e.target.value); setSaved(false); }}
              />
              <Button type="submit" variant="secondary" loading={busy} disabled={!dirty}>Save</Button>
              {saved && <Badge tone="success" icon={Icons.check}>Saved</Badge>}
            </form>
          </Row>
          <Row label="Email" description="Managed by your sign-in provider.">
            <span className={styles.mono}>{account.email}</span>
          </Row>
          <Row label="Signed in with" divider={false}>
            <span className={styles.providerCell}>
              <ProviderGlyph id={provider.id} size={14} />
              {provider.label}
            </span>
          </Row>
          {err && (
            <div className={styles.alert} role="alert">
              <Icon d={Icons.alertCircle} size={14} className={styles.alertIcon} />
              <span>{err}</span>
            </div>
          )}
        </CardBody>
      </Card>

      <Card as="section" aria-labelledby="acct-signout-title">
        <CardHeader
          title={<span id="acct-signout-title">Sign out</span>}
          description="Removes the account from this device only. Nothing you have created is deleted, and calendar connections keep syncing."
          actions={<Button variant="ghost" icon={Icons.logOut} loading={signingOut} onClick={handleSignOut}>Sign out…</Button>}
        />
      </Card>
    </>
  );
}
