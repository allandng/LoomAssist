// Phase v3.0: Wrapper for the Tauri Keychain commands defined in src-tauri/src/lib.rs.
// Slots are namespaced as `com.loomassist.{kind}` on the Rust side; the slot
// passed here is the suffix (e.g. "supabase" or "connection.{uuid}").
//
// Falls back to a no-op when running in the Vite browser preview (no Tauri).

const KEYCHAIN_FALLBACK_PREFIX = 'loom_keychain_fallback:';

function tauriInvoke<T = unknown>(cmd: string, args: Record<string, unknown>): Promise<T> | null {
  const inv = window.__TAURI_INTERNALS__?.invoke;
  if (!inv) return null;
  return inv(cmd, args) as Promise<T>;
}

export async function keychainSet(slot: string, value: string): Promise<void> {
  const r = tauriInvoke<void>('keychain_set', { slot, value });
  if (r) return r;
  // Browser preview fallback — sessionStorage so it doesn't survive a tab reload.
  sessionStorage.setItem(KEYCHAIN_FALLBACK_PREFIX + slot, value);
}

export async function keychainGet(slot: string): Promise<string | null> {
  const r = tauriInvoke<string | null>('keychain_get', { slot });
  if (r) return r;
  return sessionStorage.getItem(KEYCHAIN_FALLBACK_PREFIX + slot);
}

export async function keychainDelete(slot: string): Promise<void> {
  const r = tauriInvoke<void>('keychain_delete', { slot });
  if (r) return r;
  sessionStorage.removeItem(KEYCHAIN_FALLBACK_PREFIX + slot);
}

export const KeychainSlots = {
  supabase: 'supabase',
  connection: (uuid: string) => `connection.${uuid}`,
} as const;
