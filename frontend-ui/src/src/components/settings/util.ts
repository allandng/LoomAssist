// Local helpers for the Settings / Sync / Onboarding surfaces.
//
// `lib/time.ts` (relativeTime) and `lib/platform.ts` (isMac, modKey) are being
// added by the shell workstream; until they land these mirror the same
// contracts so this area type-checks on its own. Swap the imports when the
// shared modules exist.

/** True on macOS / iOS — decides ⌘ vs Ctrl in keyboard hints. */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const p = navigator.platform ?? '';
  const ua = navigator.userAgent ?? '';
  return /Mac|iPhone|iPad|iPod/i.test(p) || /Mac OS X/i.test(ua);
}

/** The primary modifier label for the current platform. */
export function modKey(): string {
  return isMac() ? '⌘' : 'Ctrl';
}

/** Human platform name for the About card. */
export function platformLabel(): string {
  if (typeof navigator === 'undefined') return 'Unknown';
  const ua = navigator.userAgent ?? '';
  const p = navigator.platform ?? '';
  if (/Windows/i.test(ua) || /Win/i.test(p)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua) || /Mac/i.test(p)) return 'macOS';
  if (/Linux/i.test(ua) || /Linux/i.test(p)) return 'Linux';
  return p || 'Unknown';
}

/** "just now" / "4 min ago" / "3 h ago" / "2 d ago" / "Never". */
export function relativeTime(iso: string | null | undefined, never = 'Never'): string {
  if (!iso) return never;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return never;
  const ms = Date.now() - t;
  if (ms < 0) return 'just now';
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h ago`;
  if (ms < 7 * 86_400_000) return `${Math.round(ms / 86_400_000)} d ago`;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Absolute, short: "Sep 30, 2:15 PM". */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Open a URL in the system browser (Tauri opener) with a window.open fallback. */
export async function openExternal(url: string): Promise<void> {
  const inv = window.__TAURI_INTERNALS__?.invoke;
  if (inv) {
    try { await inv('plugin:opener|open_url', { url }); return; } catch { /* fall through */ }
  }
  window.open(url, '_blank', 'noopener');
}

/** Error → readable message for toasts and inline badges. */
export function errMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return fallback;
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
