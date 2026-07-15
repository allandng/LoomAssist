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
 *
 * WS4 shell audit #5/#10 — negative-modifier matching. A binding declared
 * without meta/ctrl/shift/alt must REJECT events where those modifiers are
 * held, so ⌘F no longer fires the bare `f` (Focus) binding and Shift+→ no
 * longer double-triggers the bare `→`. Registration order stops being
 * load-bearing for modifier disambiguation.
 */
export function useShortcuts(
  shortcuts: Array<{
    key: string;
    meta?: boolean;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    force?: boolean;
    handler: ShortcutHandler;
  }>,
) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      for (const s of shortcuts) {
        const keyMatch = e.key === s.key || e.key.toLowerCase() === s.key.toLowerCase();
        if (!keyMatch) continue;

        // Positive checks — required modifiers must be present. `meta` accepts
        // either Cmd or Ctrl so a single binding works cross-platform.
        const wantsCmd = !!s.meta || !!s.ctrl;
        if (s.meta && !(e.metaKey || e.ctrlKey)) continue;
        if (s.ctrl && !e.ctrlKey) continue;
        if (s.shift && !e.shiftKey) continue;
        if (s.alt && !e.altKey) continue;

        // Negative checks — absent modifiers must NOT be held.
        if (!wantsCmd && (e.metaKey || e.ctrlKey)) continue;
        if (!s.alt && e.altKey) continue;
        // Only reject a held Shift for alphanumeric keys: punctuation such as
        // "?" (Shift+/) and named keys such as ArrowRight legitimately arrive
        // with Shift, and their disambiguation is handled by explicit
        // `shift: true` entries listed first.
        if (!s.shift && e.shiftKey && /^[a-z0-9]$/i.test(e.key)) continue;

        if (!s.force && isTyping()) continue;

        s.handler(e);
        break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts]);
}
