// Sign in — /auth/sign-in (renders outside the shell).
//
// Four ways in at equal weight (Google · Apple · Microsoft · email) plus
// "Continue without an account", which is never a lesser option. `?next=` says
// where to go afterwards (default /home).

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAccount } from '../contexts/AccountContext';
import { Badge, Button, Field, Input, Icon, Icons } from '../components/ui';
import { ProviderGlyph } from '../components/settings/ProviderGlyph';
import { errMessage } from '../components/settings/util';
import styles from './SignInPage.module.css';

type Mode = 'login' | 'signup' | 'reset';
type OAuthProvider = 'google' | 'apple' | 'microsoft';

const OAUTH: Array<{ id: OAuthProvider; label: string }> = [
  { id: 'google',    label: 'Continue with Google' },
  { id: 'apple',     label: 'Continue with Apple' },
  { id: 'microsoft', label: 'Continue with Microsoft' },
];

const HEADINGS: Record<Mode, string> = {
  login: 'Sign in',
  signup: 'Create an account',
  reset: 'Reset your password',
};

export function SignInPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rawNext = params.get('next') ?? '/home';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/home';

  const { account, status, signInEmail, signUpEmail, resetEmail, signInOAuth } = useAccount();

  const [mode, setMode]         = useState<Mode>('login');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [info, setInfo]         = useState<string | null>(null);

  function switchMode(m: Mode) { setMode(m); setError(null); setInfo(null); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null); setBusy('form');
    try {
      if (mode === 'login')       { await signInEmail(email, password); navigate(next); }
      else if (mode === 'signup') { await signUpEmail(email, password); navigate(next); }
      else                        { await resetEmail(email); setInfo('Password reset email sent. Check your inbox, then come back to sign in.'); }
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 202) setInfo('Check your email to confirm the account, then sign in.');
      else if (status === 503) setError('Cloud sign-in is not configured on this device. You can keep using LoomAssist without an account.');
      else setError(errMessage(err, 'Sign-in failed.'));
    } finally {
      setBusy(null);
    }
  }

  async function handleOAuth(provider: OAuthProvider) {
    setError(null); setInfo(null); setBusy(provider);
    try {
      await signInOAuth(provider);
      setInfo('Finish signing in with your browser. This page updates when you return.');
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(status === 503
        ? 'Cloud sign-in is not configured on this device. You can keep using LoomAssist without an account.'
        : errMessage(err, 'Could not start sign-in.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.shell}>
      <main className={styles.card} aria-labelledby="signin-heading">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">L</span>
          <span className={styles.brandName}>LoomAssist</span>
        </div>

        <div className={styles.intro}>
          <h1 id="signin-heading" className={styles.heading}>{HEADINGS[mode]}</h1>
          <p className={styles.lede}>
            LoomAssist works fully offline. Signing in is optional; it lets your display name and preferences follow you to another device.
          </p>
        </div>

        {status === 'signedIn' && account ? (
          <div className={styles.signedIn} role="status">
            <Badge tone="success" dot>Signed in</Badge>
            <span className={styles.signedInText}>{account.display_name || account.email}</span>
            <Button variant="primary" size="sm" onClick={() => navigate(next)}>Continue</Button>
          </div>
        ) : (
          <>
            <div className={styles.providers}>
              {OAUTH.map(p => (
                <Button
                  key={p.id}
                  variant="secondary"
                  size="lg"
                  block
                  icon={<ProviderGlyph id={p.id} size={16} />}
                  loading={busy === p.id}
                  disabled={busy !== null}
                  onClick={() => handleOAuth(p.id)}
                >
                  {p.label}
                </Button>
              ))}
            </div>

            <div className={styles.divider} aria-hidden="true"><span>or with email</span></div>

            <form className={styles.form} onSubmit={handleSubmit}>
              <Field label="Email" htmlFor="signin-email">
                <Input
                  id="signin-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  disabled={busy !== null}
                />
              </Field>
              {mode !== 'reset' && (
                <Field
                  label="Password"
                  htmlFor="signin-password"
                  labelRight={mode === 'login' && (
                    <button type="button" className={styles.link} onClick={() => switchMode('reset')}>Forgot password?</button>
                  )}
                >
                  <Input
                    id="signin-password"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    required
                    minLength={mode === 'signup' ? 8 : undefined}
                    disabled={busy !== null}
                  />
                </Field>
              )}

              {error && (
                <div className={`${styles.alert} ${styles.alertError}`} role="alert">
                  <Icon d={Icons.alertCircle} size={14} />
                  <span>{error}</span>
                </div>
              )}
              {info && !error && (
                <div className={`${styles.alert} ${styles.alertInfo}`} role="status">
                  <Icon d={Icons.info} size={14} />
                  <span>{info}</span>
                </div>
              )}

              <Button type="submit" variant="primary" size="lg" block loading={busy === 'form'} disabled={busy !== null && busy !== 'form'}>
                {mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset email' : 'Sign in'}
              </Button>
            </form>

            <div className={styles.modeRow}>
              {mode === 'login' && (
                <span>New here? <button type="button" className={styles.link} onClick={() => switchMode('signup')}>Create an account</button></span>
              )}
              {mode !== 'login' && (
                <button type="button" className={styles.link} onClick={() => switchMode('login')}>Back to sign in</button>
              )}
            </div>

            <Button variant="secondary" size="lg" block iconRight={Icons.arrowRight} disabled={busy !== null} onClick={() => navigate(next)}>
              Continue without an account
            </Button>
          </>
        )}

        <p className={styles.privacy}>
          <Icon d={Icons.lock} size={13} />
          <span>An account stores your email, display name and provider ID. Nothing about your calendar leaves this device.</span>
        </p>
      </main>
    </div>
  );
}
