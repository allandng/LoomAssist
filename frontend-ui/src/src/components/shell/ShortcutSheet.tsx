import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import styles from './ShortcutSheet.module.css';
import { Icon, Icons } from '../shared/Icon';
import { Kbd } from '../shared/Kbd';
import { Button, IconButton } from '../ui';
import {
  loadKeybinds, formatKeyLabel, formatKeyParts, KEYBIND_DEFAULTS,
  type KeybindAction, type KeybindContext,
} from '../../lib/keybindConfig';
import { modKey } from '../../lib/platform';
import { pushEscapeHandler } from '../../lib/escapeStack';

interface ShortcutSheetProps {
  onClose: () => void;
}

const CONTEXT_ORDER: KeybindContext[] = ['Global', 'Calendar'];

/** Not rebindable, handled directly by their surfaces; listed for completeness. */
const FIXED: { context: KeybindContext; description: string; parts: string[] }[] = [
  { context: 'Global',   description: 'Undo / redo',              parts: [`${modKey}Z`, `${modKey}⇧Z`] },
  { context: 'Global',   description: 'Close the top layer',      parts: ['Esc'] },
  { context: 'Calendar', description: 'Delete selected (alias)',  parts: ['⌫'] },
  { context: 'Calendar', description: 'Open the selected event',  parts: ['↵'] },
  { context: 'Calendar', description: 'Move selected event',      parts: [`${modKey}←`, `${modKey}→`] },
];

/**
 * `?` cheat sheet listing every keybind grouped by context. Reads live
 * overrides from loadKeybinds() so rebinds are reflected immediately, and
 * shows the platform modifier (Ctrl on Windows/Linux, ⌘ on Mac).
 */
export function ShortcutSheet({ onClose }: ShortcutSheetProps) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [binds, setBinds] = useState(loadKeybinds);
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
    const matches = (desc: string, label: string) => !f || desc.toLowerCase().includes(f) || label.toLowerCase().includes(f);
    return CONTEXT_ORDER.map(ctx => ({
      ctx,
      rows: [
        ...actions
          .filter(a => binds[a].context === ctx)
          .map(a => ({ key: a as string, description: binds[a].description, parts: formatKeyParts(binds[a]), label: formatKeyLabel(binds[a]) }))
          .filter(r => matches(r.description, r.label)),
        ...FIXED
          .filter(x => x.context === ctx)
          .map(x => ({ key: `fixed:${x.description}`, description: x.description, parts: x.parts, label: x.parts.join(' ') }))
          .filter(r => matches(r.description, r.label)),
      ],
    })).filter(g => g.rows.length > 0);
  }, [binds, filter]);

  return createPortal(
    <div className={styles.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="loom-shortcuts-title">
        <div className={styles.header}>
          <h2 id="loom-shortcuts-title" className={styles.title}>Keyboard shortcuts</h2>
          <div className={styles.search}>
            <Icon d={Icons.search} size={14} className={styles.searchIcon} />
            <input
              ref={inputRef}
              className={styles.searchInput}
              placeholder="Filter shortcuts…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              aria-label="Filter shortcuts"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <IconButton icon={Icons.x} label="Close" size="sm" onClick={onClose} />
        </div>

        <div className={styles.body}>
          {groups.length === 0 && <div className={styles.empty}>No shortcuts match “{filter}”.</div>}
          {groups.map(({ ctx, rows }) => (
            <section key={ctx} className={styles.group} aria-label={ctx}>
              <div className={styles.groupLabel}>{ctx}</div>
              <ul className={styles.rows}>
                {rows.map(r => (
                  <li key={r.key} className={styles.row}>
                    <span className={styles.rowDesc}>{r.description}</span>
                    <span className={styles.keys}>
                      {r.parts.map((p, i) => <Kbd key={`${p}-${i}`}>{p}</Kbd>)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className={styles.footer}>
          <span className={styles.footerHint}><Kbd small>esc</Kbd> close</span>
          <Button variant="subtle" size="sm" iconRight={Icons.arrowRight} onClick={() => { onClose(); navigate('/settings#keybindings'); }}>
            Rebind in Settings
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
