// First-launch wizard — /onboarding.
//
// One question per step, a thin progress bar, Skip on every step. Nothing here
// is required: local mode is the default outcome. Step 3 runs the real provider
// flows through the shared modals; Step 4 opens the subscribe drawer for the
// connection that was just created (or points to Settings → Connections).
//
// This route renders outside <Shell/>, so the modal host is mounted here too.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../contexts/AccountContext';
import { useModal } from '../contexts/ModalContext';
import { useSync } from '../contexts/SyncContext';
import { ModalRoot } from '../components/modals/ModalRoot';
import { Button, Badge, ProgressBar, Icon, Icons } from '../components/ui';
import { ProviderGlyph, type ProviderId } from '../components/settings/ProviderGlyph';
import { errMessage } from '../components/settings/util';
import styles from './OnboardingPage.module.css';

const TOTAL = 4;
const STEP_KEY = 'loom:onboarding:step';
const ONBOARDED_KEY = 'loom:onboarded';

function readStep(): number {
  const n = Number(sessionStorage.getItem(STEP_KEY));
  return n >= 1 && n <= TOTAL ? n : 1;
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStepState] = useState<number>(readStep);
  const [connectionId, setConnectionId] = useState<string | null>(null);

  function setStep(n: number) {
    setStepState(n);
    sessionStorage.setItem(STEP_KEY, String(n));
  }

  function finish() {
    localStorage.setItem(ONBOARDED_KEY, 'true');
    sessionStorage.removeItem(STEP_KEY);
    navigate('/home');
  }

  const next = () => (step >= TOTAL ? finish() : setStep(step + 1));
  const back = () => setStep(Math.max(1, step - 1));

  return (
    <div className={styles.shell}>
      <main className={styles.card} aria-labelledby="onboarding-heading">
        <header className={styles.top}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">L</span>
            <span className={styles.brandName}>LoomAssist</span>
          </div>
          <span className={styles.stepCount}>Step {step} of {TOTAL}</span>
        </header>
        <ProgressBar value={step / TOTAL} height={3} aria-label={`Setup progress: step ${step} of ${TOTAL}`} className={styles.progress} />

        <div className={styles.body}>
          {step === 1 && <StepWelcome />}
          {step === 2 && <StepAccount />}
          {step === 3 && <StepConnect onConnected={setConnectionId} connectionId={connectionId} />}
          {step === 4 && <StepSubscribe connectionId={connectionId} />}
        </div>

        <footer className={styles.footer}>
          {step > 1 ? (
            <Button variant="subtle" icon={Icons.arrowLeft} onClick={back}>Back</Button>
          ) : <span />}
          <div className={styles.footerRight}>
            {step < TOTAL && <Button variant="subtle" onClick={finish}>Skip setup</Button>}
            <Button variant="primary" iconRight={step < TOTAL ? Icons.arrowRight : undefined} onClick={next}>
              {step < TOTAL ? 'Continue' : 'Open LoomAssist'}
            </Button>
          </div>
        </footer>
      </main>
      <ModalRoot onSaved={() => { /* nothing to reload on this route */ }} />
    </div>
  );
}

/* ── Step 1 ─────────────────────────────────────────────────────────────── */

function StepWelcome() {
  return (
    <>
      <h1 id="onboarding-heading" className={styles.heading}>Welcome to LoomAssist</h1>
      <p className={styles.lede}>
        A calm, local-first planner for your week. Everything you add stays on this device,
        and the assistant runs here too. The next three steps are optional.
      </p>
      <ul className={styles.points}>
        <li><Icon d={Icons.lock} size={14} /> Events, tasks and notes live in a local database.</li>
        <li><Icon d={Icons.cloud} size={14} /> Connect a calendar only if you want two-way sync.</li>
        <li><Icon d={Icons.keyboard} size={14} /> Fast keyboard flows throughout; open the shortcuts sheet with <kbd className={styles.kbd}>?</kbd>.</li>
      </ul>
    </>
  );
}

/* ── Step 2 ─────────────────────────────────────────────────────────────── */

const OAUTH: Array<{ id: 'google' | 'apple' | 'microsoft'; label: string }> = [
  { id: 'google',    label: 'Continue with Google' },
  { id: 'apple',     label: 'Continue with Apple' },
  { id: 'microsoft', label: 'Continue with Microsoft' },
];

function StepAccount() {
  const navigate = useNavigate();
  const { account, status, signInOAuth } = useAccount();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  async function oauth(provider: 'google' | 'apple' | 'microsoft') {
    setBusy(provider); setNote(null);
    try {
      await signInOAuth(provider);
      setNote({ tone: 'info', text: 'Finish signing in with your browser, then come back here.' });
    } catch (e) {
      setNote({ tone: 'error', text: errMessage(e, 'Could not start sign-in.') });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1 id="onboarding-heading" className={styles.heading}>Do you want an account?</h1>
      <p className={styles.lede}>
        Optional. An account carries only your display name and preferences to other devices.
        Your calendar never leaves this device either way.
      </p>

      {status === 'signedIn' && account ? (
        <div className={styles.signedIn}>
          <Badge tone="success" dot>Signed in</Badge>
          <span>{account.display_name || account.email}</span>
        </div>
      ) : (
        <div className={styles.providers}>
          {OAUTH.map(p => (
            <Button key={p.id} variant="secondary" size="lg" block icon={<ProviderGlyph id={p.id} size={16} />} loading={busy === p.id} disabled={busy !== null} onClick={() => oauth(p.id)}>
              {p.label}
            </Button>
          ))}
          <Button variant="secondary" size="lg" block icon={<ProviderGlyph id="email" size={16} />} disabled={busy !== null} onClick={() => navigate('/auth/sign-in?next=/onboarding')}>
            Use email and password
          </Button>
        </div>
      )}

      {note && (
        <div className={`${styles.alert} ${note.tone === 'error' ? styles.alertError : styles.alertInfo}`} role={note.tone === 'error' ? 'alert' : 'status'}>
          <Icon d={note.tone === 'error' ? Icons.alertCircle : Icons.info} size={14} />
          <span>{note.text}</span>
        </div>
      )}
      <p className={styles.fine}>Continue to keep using LoomAssist without an account.</p>
    </>
  );
}

/* ── Step 3 ─────────────────────────────────────────────────────────────── */

const PROVIDERS: Array<{ id: ProviderId; name: string; sub: string; action: 'picker' | 'caldav_icloud' | 'caldav_generic' }> = [
  { id: 'google', name: 'Google Calendar',     sub: 'Sign in with Google and pick which calendars to sync.',        action: 'picker' },
  { id: 'icloud', name: 'iCloud',              sub: 'Uses an app-specific password from your Apple ID.',             action: 'caldav_icloud' },
  { id: 'caldav', name: 'Other CalDAV server', sub: 'Fastmail, Nextcloud, Mailbox.org or anything that speaks CalDAV.', action: 'caldav_generic' },
];

function StepConnect({ connectionId, onConnected }: { connectionId: string | null; onConnected: (id: string) => void }) {
  const { openProviderPicker, openCalDAVCredentials } = useModal();
  const { connections, refreshConnections } = useSync();

  // Any connection that appears while this step is open counts as "created here"
  // (covers the Google flow, which finishes in the system browser). Snapshot the
  // ids present at mount, then poll the list until something new shows up.
  const [initialIds] = useState(() => new Set(connections.map(c => c.id)));
  useEffect(() => {
    if (connectionId) return;
    const fresh = connections.find(c => !initialIds.has(c.id));
    if (fresh) onConnected(fresh.id);
  }, [connections, connectionId, initialIds, onConnected]);
  useEffect(() => {
    if (connectionId) return;
    const timer = window.setInterval(() => { refreshConnections().catch(() => { /* backend may be restarting */ }); }, 3000);
    return () => window.clearInterval(timer);
  }, [connectionId, refreshConnections]);

  const connected = connections.find(c => c.id === connectionId);

  function pick(p: typeof PROVIDERS[number]) {
    if (p.action === 'picker') openProviderPicker();
    else openCalDAVCredentials(p.action, id => onConnected(id));
  }

  return (
    <>
      <h1 id="onboarding-heading" className={styles.heading}>Connect a calendar</h1>
      <p className={styles.lede}>
        Sync runs directly between this device and your provider; there is no LoomAssist server in between.
        Sign-in tokens are kept in your system keychain.
      </p>

      {connected ? (
        <div className={styles.signedIn}>
          <Badge tone="success" dot>Connected</Badge>
          <span>{connected.display_name}</span>
        </div>
      ) : (
        <div className={styles.providerGrid}>
          {PROVIDERS.map(p => (
            <button key={p.id} type="button" className={styles.providerCard} onClick={() => pick(p)}>
              <span className={styles.providerLogo} aria-hidden="true"><ProviderGlyph id={p.id} size={20} /></span>
              <span className={styles.providerText}>
                <span className={styles.providerName}>{p.name}</span>
                <span className={styles.providerSub}>{p.sub}</span>
              </span>
              <Icon d={Icons.chevronRight} size={14} className={styles.providerChevron} />
            </button>
          ))}
        </div>
      )}
      <p className={styles.fine}>You can add or remove connections any time in Settings → Connections.</p>
    </>
  );
}

/* ── Step 4 ─────────────────────────────────────────────────────────────── */

function StepSubscribe({ connectionId }: { connectionId: string | null }) {
  const { openSubscribeDrawer } = useModal();
  const { connections } = useSync();
  const conn = connections.find(c => c.id === connectionId);

  return (
    <>
      <h1 id="onboarding-heading" className={styles.heading}>Choose what to sync</h1>
      {conn ? (
        <>
          <p className={styles.lede}>
            Pick which of <strong>{conn.display_name}</strong>'s calendars to bring in. Each one becomes a timeline
            here, and you can change its sync direction later.
          </p>
          <div className={styles.providers}>
            <Button variant="secondary" size="lg" icon={Icons.calendar} onClick={() => openSubscribeDrawer(conn.id)}>
              Choose calendars
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.lede}>
            No calendar connected yet, and that is fine. LoomAssist is complete on its own.
          </p>
          <div className={styles.later}>
            <Icon d={Icons.info} size={14} />
            <span>You can do this later in Settings → Connections.</span>
          </div>
        </>
      )}
    </>
  );
}
