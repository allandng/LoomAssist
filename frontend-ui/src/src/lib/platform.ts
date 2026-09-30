/**
 * Platform helpers — the app runs on Windows, macOS and Linux, so every
 * keyboard hint must pick the right modifier glyph at runtime.
 *
 *   modKey            → '⌘' on Mac, 'Ctrl' elsewhere
 *   modLabel(binding) → 'Ctrl+Shift+K' / '⌘⇧K'-style label for a binding
 */

interface NavigatorUAData { platform?: string }

function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  const platform = ua?.platform || navigator.platform || '';
  if (/mac|iphone|ipad|ipod/i.test(platform)) return true;
  // Some WebViews report an empty platform; fall back to the UA string.
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent ?? '');
}

export const isMac: boolean = detectMac();

export const modKey: '⌘' | 'Ctrl' = isMac ? '⌘' : 'Ctrl';

export interface ModLabelBinding {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Display label for the key itself (e.g. 'K', '→', 'Del'). Falls back to `key`. */
  label?: string;
}

const KEY_NAMES: Record<string, string> = {
  arrowright: '→', arrowleft: '←', arrowup: '↑', arrowdown: '↓',
  enter: '↵', escape: 'Esc', backspace: '⌫', delete: 'Del', ' ': 'Space', space: 'Space', tab: 'Tab',
};

/** Human label for a key without modifiers. */
export function keyLabel(binding: Pick<ModLabelBinding, 'key' | 'label'>): string {
  if (binding.label) return binding.label;
  const k = binding.key;
  const named = KEY_NAMES[k.toLowerCase()];
  if (named) return named;
  return k.length === 1 ? k.toUpperCase() : k;
}

/**
 * Cross-platform label for a binding. `meta` means "the platform command key"
 * (⌘ on Mac, Ctrl elsewhere); `ctrl` is always Ctrl. On Mac the parts are
 * joined without separators (⌘⇧K); elsewhere with `+` (Ctrl+Shift+K).
 */
export function modLabel(binding: ModLabelBinding): string {
  const parts: string[] = [];
  if (binding.meta) parts.push(modKey);
  if (binding.ctrl && !(binding.meta && !isMac)) parts.push('Ctrl');
  if (binding.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (binding.shift) parts.push(isMac ? '⇧' : 'Shift');
  parts.push(keyLabel(binding));
  return parts.join(isMac ? '' : '+');
}

/** Parts of a binding label, for rendering each as its own <Kbd>. */
export function modParts(binding: ModLabelBinding): string[] {
  const parts: string[] = [];
  if (binding.meta) parts.push(modKey);
  if (binding.ctrl && !(binding.meta && !isMac)) parts.push('Ctrl');
  if (binding.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (binding.shift) parts.push(isMac ? '⇧' : 'Shift');
  parts.push(keyLabel(binding));
  return parts;
}
