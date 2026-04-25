// Phase v3.0 OnboardingPage — first-launch wizard.
//
// Per design doc §6 Flow A: 4 steps with Skip on every step. The wizard never
// blocks the user from a fully functional local-mode app. Sets
// localStorage.onboarded=true on completion or skip.
//
// Phase 1 lands steps 1+2 as fully functional. Steps 3+4 (calendar provider
// connection) are scaffolded as "coming next" surfaces — Phase 2 will wire them.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../contexts/AccountContext';
import { Icon, Icons } from '../components/shared/Icon';
import styles from './OnboardingPage.module.css';

const STEPS = [
  { n: 1, title: 'Welcome',            sub: 'Plain-language framing' },
  { n: 2, title: 'Account',            sub: 'Optional — local mode is first-class' },
  { n: 3, title: 'Connect a calendar', sub: 'Pick a provider' },
  { n: 4, title: 'Pick what to sync',  sub: 'Calendars & direction' },
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const { signInOAuth } = useAccount();
  const [step, setStep] = useState(1);

  function finish() {
    localStorage.setItem('loom:onboarded', 'true');
    navigate('/calendar');
  }

  function next() {
    if (step >= STEPS.length) finish();
    else setStep(step + 1);
  }

  return (
    <div className={styles.shell}>
      <div className={styles.topBar}>
        <div className={styles.brandMark}>L</div>
        <span className={styles.brandTitle}>LoomAssist</span>
        <div className={styles.spacer} />
        <span className={styles.stepCount}>Step {step} of {STEPS.length}</span>
      </div>

      <div className={styles.stage}>
        <div className={styles.rail}>
          {STEPS.map((s, i) => {
            const isDone = s.n < step;
            const isActive = s.n === step;
            const dotClass = isDone ? styles.stepDotDone : isActive ? styles.stepDotActive : styles.stepDot;
            return (
              <div key={s.n} className={styles.step}>
                {i < STEPS.length - 1 && (
                  <div className={`${styles.stepLine} ${isDone ? styles.stepLineDone : ''}`} />
                )}
                <div className={`${styles.stepDot} ${dotClass}`}>
                  {isDone ? <Icon d={Icons.check} size={12} stroke="white" strokeWidth={2.4} /> : s.n}
                </div>
                <div className={`${styles.stepTitle} ${isActive ? styles.stepTitleActive : isDone ? styles.stepTitleDone : ''}`}>
                  {s.title}
                </div>
                <div className={styles.stepSub}>{s.sub}</div>
              </div>
            );
          })}
        </div>

        <div className={styles.content}>
          {step === 1 && <StepWelcome onContinue={next} onSkip={finish} />}
          {step === 2 && <StepAccount onContinue={next} onSkip={finish} onSignIn={signInOAuth} />}
          {step === 3 && <StepConnect onContinue={next} onSkip={finish} />}
          {step === 4 && <StepSubscribe onFinish={finish} />}
        </div>
      </div>
    </div>
  );
}

function StepWelcome({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  return (
    <>
      <h1 className={styles.heading}>Welcome to LoomAssist</h1>
      <p className={styles.lede}>
        LoomAssist works fully offline. The next steps are optional — add an account
        if you want to sync your sign-in across devices later, and connect a calendar
        if you want to mirror events to Google or iCloud.
      </p>
      <p className={styles.privacyLine}>
        <Icon d={Icons.user} size={11} /> All event data stays in local SQLite. We never see your calendar.
      </p>
      <div className={styles.fillSpacer} />
      <div className={styles.footer}>
        <div style={{ flex: 1 }} />
        <button className={styles.skipLink} onClick={onSkip}>Skip setup</button>
        <button className="loom-btn-primary" onClick={onContinue}>
          Continue <Icon d={Icons.chevronRight} size={12} />
        </button>
      </div>
    </>
  );
}

function StepAccount({
  onContinue, onSkip, onSignIn,
}: {
  onContinue: () => void;
  onSkip: () => void;
  onSignIn: (p: 'google' | 'apple' | 'microsoft') => Promise<void>;
}) {
  const navigate = useNavigate();
  return (
    <>
      <h1 className={styles.heading}>Sign in (optional)</h1>
      <p className={styles.lede}>
        Sign in to LoomAssist if you want your account preferences to follow you to
        another device. Sync of actual calendar data is a separate step.
      </p>
      <p className={styles.privacyLine}>
        <Icon d={Icons.user} size={11} /> We store your email, display name, and provider ID. Nothing else.
      </p>

      <div className={styles.providerBtnRow}>
        <button className={styles.providerLine} onClick={() => onSignIn('google')}>
          <Icon d={Icons.user} size={16} /> Continue with Google
        </button>
        <button className={styles.providerLine} onClick={() => onSignIn('apple')}>
          <Icon d={Icons.user} size={16} /> Continue with Apple
        </button>
        <button className={styles.providerLine} onClick={() => onSignIn('microsoft')}>
          <Icon d={Icons.user} size={16} /> Continue with Microsoft
        </button>
        <button className={styles.providerLine} onClick={() => navigate('/auth/sign-in')}>
          <Icon d={Icons.mail} size={16} /> Email & password
        </button>
        <button className={styles.continueLink} onClick={onContinue}>
          Continue without an account
        </button>
      </div>

      <div className={styles.fillSpacer} />
      <div className={styles.footer}>
        <div style={{ flex: 1 }} />
        <button className={styles.skipLink} onClick={onSkip}>Skip setup</button>
        <button className="loom-btn-primary" onClick={onContinue}>
          Continue <Icon d={Icons.chevronRight} size={12} />
        </button>
      </div>
    </>
  );
}

function StepConnect({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  return (
    <>
      <h1 className={styles.heading}>Connect a calendar</h1>
      <p className={styles.lede}>
        LoomAssist syncs <em>directly</em> from this device to your calendar provider —
        no LoomAssist server in between. Pick a provider to continue, or skip and
        add one later from Settings → Connections.
      </p>
      <p className={styles.privacyLine}>
        <Icon d={Icons.user} size={11} /> Tokens are stored in your macOS Keychain. Calendar data stays in local SQLite.
      </p>

      <div className={styles.providerGrid}>
        <ProviderCard icon={Icons.mail}    name="Google Calendar" sub="OAuth 2.0 · sync any of your Google calendars"  disabled />
        <ProviderCard icon={Icons.upload}  name="iCloud"          sub="CalDAV · requires an app-specific password"     disabled />
        <ProviderCard icon={Icons.doc}     name="Generic CalDAV"  sub="Fastmail, Nextcloud, Mailcow, anything CalDAV"  disabled />
        <ProviderCard icon={Icons.help}    name="Microsoft Outlook" sub="Coming soon" badge="Soon" disabled />
      </div>
      <p className={styles.privacyLine}>
        Provider connections ship in v3 Phase 2 — these cards will activate once that lands.
      </p>

      <div className={styles.fillSpacer} />
      <div className={styles.footer}>
        <div style={{ flex: 1 }} />
        <button className={styles.skipLink} onClick={onSkip}>Skip — finish later</button>
        <button className="loom-btn-primary" onClick={onContinue}>
          Continue <Icon d={Icons.chevronRight} size={12} />
        </button>
      </div>
    </>
  );
}

function StepSubscribe({ onFinish }: { onFinish: () => void }) {
  return (
    <>
      <h1 className={styles.heading}>You're all set</h1>
      <p className={styles.lede}>
        Calendar selection lands in v3 Phase 2 along with the connection providers
        themselves. For now, you can use LoomAssist offline with the full v2.0
        feature set — calendar, focus mode, task board, journal, and more.
      </p>
      <div className={styles.fillSpacer} />
      <div className={styles.footer}>
        <div style={{ flex: 1 }} />
        <button className="loom-btn-primary" onClick={onFinish}>
          Open LoomAssist <Icon d={Icons.chevronRight} size={12} />
        </button>
      </div>
    </>
  );
}

function ProviderCard({
  icon, name, sub, badge, disabled,
}: {
  icon: React.ReactNode;
  name: string;
  sub: string;
  badge?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={`${styles.providerCard} ${disabled ? styles.providerCardDisabled : ''}`}
      disabled={disabled}
      type="button"
    >
      <div className={styles.providerLogo}><Icon d={icon} size={20} /></div>
      <div style={{ flex: 1 }}>
        <div className={styles.providerName}>
          {name}
          {badge && <span className={styles.soonChip}>{badge}</span>}
        </div>
        <div className={styles.providerSub}>{sub}</div>
      </div>
      {!disabled && <Icon d={Icons.chevronRight} size={14} />}
    </button>
  );
}
