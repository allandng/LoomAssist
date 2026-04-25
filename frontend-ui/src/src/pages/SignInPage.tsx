// Phase v3.0 SignInPage — pre-shell route. App drawer hidden, no top bar.
// Four sign-in methods at parity (Google · Apple · Microsoft · email/password)
// plus a "Continue without an account" link of equal visual weight.
//
// Per design doc §10 Q1: account is ALWAYS optional.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../contexts/AccountContext';
import { Icon, Icons } from '../components/shared/Icon';
import styles from './SignInPage.module.css';

type Mode = 'login' | 'signup' | 'reset';

export function SignInPage() {
  const navigate = useNavigate();
  const { signInEmail, signUpEmail, resetEmail, signInOAuth } = useAccount();

  const [mode, setMode]         = useState<Mode>('login');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [info, setInfo]         = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'login')      { await signInEmail(email, password); navigate('/calendar'); }
      else if (mode === 'signup'){ await signUpEmail(email, password); navigate('/calendar'); }
      else                       { await resetEmail(email); setInfo('Password reset email sent. Check your inbox.'); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleOAuth(provider: 'google' | 'apple' | 'microsoft') {
    setErr(null);
    setBusy(true);
    try {
      await signInOAuth(provider);
      // The browser opens externally; this page stays mounted until the user
      // returns. Once they do, AccountContext.completeOAuthFromFragment() picks
      // up the access_token from the URL fragment and switches to signedIn.
      setInfo('Complete the sign-in in your browser, then return here.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function continueLocal() {
    navigate('/calendar');
  }

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>L</div>
          <div>
            <div className={styles.brandTitle}>LoomAssist</div>
            <div className={styles.brandSub}>v3 · sign in</div>
          </div>
        </div>

        <div>
          <h1 className={styles.heading}>
            {mode === 'signup' ? 'Create an account' : mode === 'reset' ? 'Reset password' : 'Sign in'}
          </h1>
          <p className={styles.lede}>
            LoomAssist works fully offline. Signing in is optional — it lets you sync
            your account across devices later.
          </p>
        </div>

        <div className={styles.providers}>
          <button className={styles.providerBtn} onClick={() => handleOAuth('google')} disabled={busy}>
            <span className={styles.providerLogo}><Icon d={Icons.user} size={16} /></span>
            Continue with Google
          </button>
          <button className={styles.providerBtn} onClick={() => handleOAuth('apple')} disabled={busy}>
            <span className={styles.providerLogo}><Icon d={Icons.user} size={16} /></span>
            Continue with Apple
          </button>
          <button className={styles.providerBtn} onClick={() => handleOAuth('microsoft')} disabled={busy}>
            <span className={styles.providerLogo}><Icon d={Icons.user} size={16} /></span>
            Continue with Microsoft
          </button>
        </div>

        <div className={styles.divider}>
          <div className={styles.dividerLine} />
          <span>or</span>
          <div className={styles.dividerLine} />
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.fieldStack}>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor="signin-email">Email</label>
              <input
                id="signin-email"
                className="loom-field"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                disabled={busy}
              />
            </div>
            {mode !== 'reset' && (
              <div className={styles.fieldRow}>
                <label className={styles.fieldLabel} htmlFor="signin-pw">Password</label>
                <input
                  id="signin-pw"
                  className="loom-field"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  disabled={busy}
                />
              </div>
            )}
          </div>

          {err  && <div className={styles.errorBox} style={{ marginTop: 14 }}>{err}</div>}
          {info && <div className={styles.errorBox} style={{ marginTop: 14, borderLeftColor: 'var(--accent)' }}>{info}</div>}

          <div className={styles.actions} style={{ marginTop: 18 }}>
            <button type="submit" className="loom-btn-primary" disabled={busy}>
              {mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset email' : 'Sign in'}
            </button>
          </div>
        </form>

        <div className={styles.linkRow}>
          {mode === 'login' && (
            <>
              <button className={styles.link} type="button" onClick={() => { setMode('signup'); setErr(null); setInfo(null); }}>
                Create an account
              </button>
              <button className={styles.link} type="button" onClick={() => { setMode('reset'); setErr(null); setInfo(null); }}>
                Forgot password?
              </button>
            </>
          )}
          {mode !== 'login' && (
            <button className={styles.link} type="button" onClick={() => { setMode('login'); setErr(null); setInfo(null); }}>
              Back to sign in
            </button>
          )}
        </div>

        <button className={styles.skipLink} type="button" onClick={continueLocal}>
          Continue without an account
        </button>

        <div className={styles.privacy}>
          <Icon d={Icons.user} size={13} />
          <span>
            We store your email, display name, and provider ID. Nothing about your
            calendar leaves this device.
          </span>
        </div>
      </div>
    </div>
  );
}
