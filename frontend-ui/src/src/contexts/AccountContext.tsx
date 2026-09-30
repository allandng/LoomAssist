// Account state — identity only.
//
// Local mode is a first-class state, NOT an error. `status === 'local'` just
// means no cloud user is signed in; the app is fully functional. Wraps <App/>
// outside the router so route changes don't re-fetch identity.
//
// OAuth: the chosen provider is remembered (sessionStorage) before the system
// browser opens, so the completion step reports the real provider instead of
// assuming Google. A `provider` key in the returning URL fragment wins if present.

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  type Account,
  getMe,
  getOAuthStatus,
  emailLogin as apiEmailLogin,
  emailSignup as apiEmailSignup,
  emailReset as apiEmailReset,
  startOAuth as apiStartOAuth,
  completeOAuth as apiCompleteOAuth,
  updateMe as apiUpdateMe,
  logout as apiLogout,
} from '../api';
import { keychainSet, keychainDelete, KeychainSlots } from '../lib/keychain';

export type AccountStatus = 'loading' | 'signedIn' | 'local' | 'error';
export type OAuthProvider = 'google' | 'apple' | 'microsoft';

const PENDING_PROVIDER_KEY = 'loom:oauth:provider';
const OAUTH_PROVIDERS: readonly OAuthProvider[] = ['google', 'apple', 'microsoft'];
// The system browser finishes OAuth via GET /auth/oauth/callback; the desktop
// window never sees that redirect, so it polls /auth/oauth/status for a while.
const OAUTH_POLL_MS = 2000;
const OAUTH_POLL_LIMIT_MS = 3 * 60_000;

interface AccountContextValue {
  account: Account | null;
  status: AccountStatus;
  error: string | null;
  refresh: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string) => Promise<void>;
  resetEmail: (email: string) => Promise<void>;
  signInOAuth: (provider: OAuthProvider) => Promise<void>;
  completeOAuthFromFragment: () => Promise<boolean>;
  updateDisplayName: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

function isOAuthProvider(v: string | null | undefined): v is OAuthProvider {
  return !!v && (OAUTH_PROVIDERS as readonly string[]).includes(v);
}

function readFragmentToken(): { access_token: string; refresh_token?: string; provider?: OAuthProvider } | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const access = params.get('access_token');
  if (!access) return null;
  const refresh = params.get('refresh_token') ?? undefined;
  const provider = params.get('provider');
  return { access_token: access, refresh_token: refresh, provider: isOAuthProvider(provider) ? provider : undefined };
}

function readPendingProvider(): OAuthProvider | null {
  try {
    const v = sessionStorage.getItem(PENDING_PROVIDER_KEY);
    return isOAuthProvider(v) ? v : null;
  } catch {
    return null;
  }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [status, setStatus]   = useState<AccountStatus>('loading');
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const a = await getMe();
      setAccount(a);
      setStatus(a ? 'signedIn' : 'local');
      setError(null);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Boot: read /auth/me once (204 = local mode, not an error).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // If the OAuth provider redirected back with #access_token=… in the URL,
  // exchange it for an Account and stash the token in the keychain.
  const completeOAuthFromFragment = useCallback(async (): Promise<boolean> => {
    const tok = readFragmentToken();
    if (!tok) return false;
    const provider: OAuthProvider = tok.provider ?? readPendingProvider() ?? 'google';
    try {
      const acc = await apiCompleteOAuth(tok.access_token, tok.refresh_token ?? null, provider);
      await keychainSet(KeychainSlots.supabase, JSON.stringify({ access_token: tok.access_token, refresh_token: tok.refresh_token }));
      setAccount(acc);
      setStatus('signedIn');
      setError(null);
      try { sessionStorage.removeItem(PENDING_PROVIDER_KEY); } catch { /* ignore */ }
      // Strip the fragment so it isn't re-processed on reload.
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    completeOAuthFromFragment();
  }, [completeOAuthFromFragment]);

  const signInEmail = useCallback(async (email: string, password: string) => {
    const acc = await apiEmailLogin(email, password);
    setAccount(acc);
    setStatus('signedIn');
    setError(null);
  }, []);

  const signUpEmail = useCallback(async (email: string, password: string) => {
    const acc = await apiEmailSignup(email, password);
    setAccount(acc);
    setStatus('signedIn');
    setError(null);
  }, []);

  const resetEmail = useCallback(async (email: string) => {
    await apiEmailReset(email);
  }, []);

  // Poll the backend after handing off to the system browser; stops on success,
  // on timeout, on a new attempt, or on unmount.
  const pollRef = useRef<number | null>(null);
  const stopPolling = useCallback(() => {
    if (pollRef.current != null) { window.clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const watchOAuthCompletion = useCallback((baseline: string | null) => {
    stopPolling();
    const startedAt = Date.now();
    pollRef.current = window.setInterval(async () => {
      if (Date.now() - startedAt > OAUTH_POLL_LIMIT_MS) { stopPolling(); return; }
      try {
        const s = await getOAuthStatus();
        if (s.completed_at && s.completed_at !== baseline) {
          stopPolling();
          try { sessionStorage.removeItem(PENDING_PROVIDER_KEY); } catch { /* ignore */ }
          await refresh();
        }
      } catch { /* backend restarting — keep trying until the limit */ }
    }, OAUTH_POLL_MS);
  }, [refresh, stopPolling]);

  const signInOAuth = useCallback(async (provider: OAuthProvider) => {
    const { auth_url } = await apiStartOAuth(provider);
    try { sessionStorage.setItem(PENDING_PROVIDER_KEY, provider); } catch { /* ignore */ }
    const baseline = await getOAuthStatus().then(s => s.completed_at).catch(() => null);
    watchOAuthCompletion(baseline);
    // tauri-plugin-opener exposes window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', …).
    // In browser preview, fall back to window.open.
    const inv = window.__TAURI_INTERNALS__?.invoke;
    if (inv) {
      try { await inv('plugin:opener|open_url', { url: auth_url }); return; } catch { /* fall through */ }
    }
    window.open(auth_url, '_blank', 'noopener');
  }, [watchOAuthCompletion]);

  const updateDisplayName = useCallback(async (name: string) => {
    const acc = await apiUpdateMe(name);
    setAccount(acc);
  }, []);

  const signOut = useCallback(async () => {
    // Clear the keychain FIRST so a backend failure can't leave a stale token.
    try { await keychainDelete(KeychainSlots.supabase); } catch { /* best-effort */ }
    await apiLogout();
    setAccount(null);
    setStatus('local');
    setError(null);
  }, []);

  const value = useMemo<AccountContextValue>(() => ({
    account, status, error, refresh,
    signInEmail, signUpEmail, resetEmail,
    signInOAuth, completeOAuthFromFragment,
    updateDisplayName, signOut,
  }), [account, status, error, refresh, signInEmail, signUpEmail, resetEmail,
       signInOAuth, completeOAuthFromFragment, updateDisplayName, signOut]);

  return <AccountContext value={value}>{children}</AccountContext>;
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used inside AccountProvider');
  return ctx;
}
