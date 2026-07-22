import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ShortcutSheet.module.css';
import {
  loadKeybinds, formatKeyLabel, KEYBIND_DEFAULTS,
  type KeybindAction, type KeybindContext,
} from '../../lib/keybindConfig';
import { pushEscapeHandler } from '../../lib/escapeStack';

interface ShortcutSheetProps {
  onClose: () => void;
}

const CONTEXT_ORDER: KeybindContext[] = ['Global', 'Calendar'];

/**
 * WS4 #8 — a `?`-triggered, searchable cheat sheet listing every keybind
 * grouped by context. Reads live overrides from loadKeybinds() so rebinds are
 * reflected immediately.
 */
export function ShortcutSheet({ onClose }: ShortcutSheetProps) {
  const [filter, setFilter] = useState('');
  const [binds, setBinds] = useState(loadKeybinds);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onChanged = () => setBinds(loadKeybinds());
    window.addEventListener('loom-keybinds-changed', onChanged);
    return () => window.removeEventListener('loom-keybinds-changed', onChanged);
  }, []);

  useEffect(() => {
    const pop = pushEscapeHandler(() => onClose());
    requestAnimationFrame(() => inputRef.current?.focus());
    return pop;
  }, [onClose]);

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const actions = Object.keys(KEYBIND_DEFAULTS) as KeybindAction[];
    return CONTEXT_ORDER.map(ctx => ({
      ctx,
      rows: actions
        .filter(a => binds[a].context === ctx)
        .map(a => ({ action: a, def: binds[a] }))
        .filter(({ def }) =>
          !f ||
          def.description.toLowerCase().includes(f) ||
          formatKeyLabel(def).toLowerCase().includes(f)),
    })).filter(g => g.rows.length > 0);
  }, [binds, filter]);

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.title}>Keyboard shortcuts</span>
          <input
            ref={inputRef}
            className={styles.search}
            placeholder="Filter…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            aria-label="Filter shortcuts"
          />
        </div>
        <div className={styles.body}>
          {groups.length === 0 && <div className={styles.empty}>No matching shortcuts.</div>}
          {groups.map(({ ctx, rows }) => (
            <div key={ctx} className={styles.group}>
              <div className={styles.groupLabel}>{ctx}</div>
              {rows.map(({ action, def }) => (
                <div key={action} className={styles.row}>
                  <span className={styles.rowDesc}>{def.description}</span>
                  <kbd className={styles.key}>{formatKeyLabel(def)}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className={styles.footer}>
          <span>Press <kbd className={styles.key}>Esc</kbd> to close · rebind in Settings → Keybindings</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
