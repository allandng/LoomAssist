/* Platform helpers for keyboard hints (DESIGN §5: ⌘ on Mac, Ctrl elsewhere). */

export const isMac: boolean =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? '');

/** Modifier-key prefix for keyboard hints, e.g. `${modKey()}↵` → "⌘↵" / "Ctrl+↵". */
export function modKey(): string {
  return isMac ? '⌘' : 'Ctrl+';
}
