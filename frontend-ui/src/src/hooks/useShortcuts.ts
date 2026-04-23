import { useEffect } from 'react';

type ShortcutHandler = (e: KeyboardEvent) => void;

function isTyping(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = (el as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * Register global keyboard shortcuts. Handlers receive the KeyboardEvent.
 * Shortcuts are automatically skipped when the user is typing in an input.
 * Pass `force: true` per entry to bypass the typing guard (used for Ctrl+Z etc.).
 */
export function useShortcuts(
  shortcuts: Array<{
    key: string;
    meta?: boolean;
    ctrl?: boolean;
    shift?: boolean;
    force?: boolean;
    handler: ShortcutHandler;
  }>,
) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      for (const s of shortcuts) {
        const keyMatch = e.key === s.key || e.key.toLowerCase() === s.key.toLowerCase();
        const metaMatch = s.meta ? (e.metaKey || e.ctrlKey) : true;

        if (!keyMatch) continue;
        if (s.meta && !metaMatch) continue;
        if (s.ctrl && !e.ctrlKey) continue;
        if (s.shift && !e.shiftKey) continue;

        // Ignore modifier-only checks we already handled above
        if (!s.force && isTyping()) continue;

        s.handler(e);
        break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts]);
}
