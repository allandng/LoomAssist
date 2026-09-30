// Hash ↔ section-id helpers shared by the Settings page and its nav.

/* Hash → element id. Legacy anchors keep working (#lan-sync, #cloud-sync, #data). */
const HASH_ALIASES: Record<string, string> = {
  keyboard: 'keybindings',
  shortcuts: 'keybindings',
  backup: 'data',
};

/* Which nav item a given hash belongs to (sub-anchors roll up to their section). */
export const HASH_TO_NAV: Record<string, string> = {
  appearance: 'appearance',
  keybindings: 'keybindings',
  notifications: 'notifications',
  data: 'data', logs: 'data',
  sync: 'sync', 'lan-sync': 'sync', 'cloud-sync': 'sync', subscriptions: 'sync',
  advanced: 'advanced', about: 'advanced',
};

export function resolveSettingsHash(hash: string): string {
  const h = hash.replace(/^#/, '');
  return HASH_ALIASES[h] ?? h;
}

export function scrollToSettingsHash(hash: string): void {
  const id = resolveSettingsHash(hash);
  if (!id) return;
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
