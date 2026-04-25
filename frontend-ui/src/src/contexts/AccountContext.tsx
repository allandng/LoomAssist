// Phase v3.0: Account state — identity-only.
//
// Local mode is a first-class state, NOT an error. AccountContext.status === 'local'
// just means: no Supabase user is signed in. The app is fully functional in this state.
//
// Per design doc §5: this provider wraps <App/> outside the router so route changes
// don't re-fetch identity.

import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import {
  type Account,
  getMe,
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

interface AccountContextValue {
  account: Account | null;
  status: AccountStatus;
  error: string | null;
  refresh: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string) => Promise<void>;
  resetEmail: (email: string) => Promise<void>;
  signInOAuth: (provider: 'google' | 'apple' | 'microsoft') => Promise<void>;
  completeOAuthFromFragment: () => Promise<boolean>;
  updateDisplayName: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

function readFragmentToken(): { access_token: string; refresh_token?: string } | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const access = params.get('access_token');
  if (!access) return null;
  const refresh = params.get('refresh_token') ?? undefined;
  return { access_token: access, refresh_token: refresh };
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

  // Boot: read /auth/me once. The setState happens inside the async refresh —
  // legitimate boot-time fetch, not a cascading render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // If the OAuth provider redirected back with #access_token=… in the URL,
  // exchange it for an Account and stash the token in the Keychain.
  const completeOAuthFromFragment = useCallback(async (): Promise<boolean> => {
    const tok = readFragmentToken();
    if (!tok) return false;
    try {
      const acc = await apiCompleteOAuth(tok.access_token, tok.refresh_token ?? null, 'google');
      await keychainSet(KeychainSlots.supabase, JSON.stringify(tok));
      setAccount(acc);
      setStatus('signedIn');
      // Strip the fragment from the URL so it isn't re-processed on a reload.
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
  }, []);

  const signUpEmail = useCallback(async (email: string, password: string) => {
    const acc = await apiEmailSignup(email, password);
    setAccount(acc);
    setStatus('signedIn');
  }, []);

  const resetEmail = useCallback(async (email: string) => {
    await apiEmailReset(email);
  }, []);

  const signInOAuth = useCallback(async (provider: 'google' | 'apple' | 'microsoft') => {
    const { auth_url } = await apiStartOAuth(provider);
    // tauri-plugin-opener exposes window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', …).
    // In browser preview, fall back to window.open.
    const inv = window.__TAURI_INTERNALS__?.invoke;
    if (inv) {
      try { await inv('plugin:opener|open_url', { url: auth_url }); return; } catch { /* fall through */ }
    }
    window.open(auth_url, '_blank');
  }, []);

  const updateDisplayName = useCallback(async (name: string) => {
    const acc = await apiUpdateMe(name);
    setAccount(acc);
  }, []);

  const signOut = useCallback(async () => {
    // Clear Keychain FIRST (so a backend failure doesn't leave a stale token).
    try { await keychainDelete(KeychainSlots.supabase); } catch { /* best-effort */ }
    await apiLogout();
    setAccount(null);
    setStatus('local');
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
