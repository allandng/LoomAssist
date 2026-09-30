import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import { Card, CardHeader, CardBody, Button, Badge, Kbd } from '../ui';
import {
  loadKeybinds, saveKeybind, resetKeybinds, KEYBIND_DEFAULTS,
  type KeybindAction, type KeybindDef, type KeybindContext,
} from '../../lib/keybindConfig';
import { modKey } from './util';
import styles from './settings.module.css';

const CONTEXTS: KeybindContext[] = ['Global', 'Calendar'];
const ALL_ACTIONS = Object.keys(KEYBIND_DEFAULTS) as KeybindAction[];

const KEY_LABELS: Record<string, string> = {
  arrowright: '→', arrowleft: '←', arrowup: '↑', arrowdown: '↓',
  ' ': 'Space', delete: 'Del', backspace: '⌫', escape: 'Esc', enter: '↵', tab: 'Tab',
};

function keyParts(def: KeybindDef): string[] {
  const parts: string[] = [];
  if (def.ctrl)  parts.push('Ctrl');
  if (def.meta)  parts.push(modKey());
  if (def.shift) parts.push('Shift');
  const k = def.key.toLowerCase();
  parts.push(KEY_LABELS[k] ?? def.label ?? def.key.toUpperCase());
  return parts;
}

function signature(def: KeybindDef): string {
  return `${def.ctrl ? 'c' : ''}${def.meta ? 'm' : ''}${def.shift ? 's' : ''}|${def.key.toLowerCase()}`;
}

/** Actions whose bindings collide. Global bindings collide with everything; Calendar only with Calendar. */
function findConflicts(binds: Record<KeybindAction, KeybindDef>): Map<KeybindAction, KeybindAction[]> {
  const out = new Map<KeybindAction, KeybindAction[]>();
  for (const a of ALL_ACTIONS) {
    for (const b of ALL_ACTIONS) {
      if (a === b) continue;
      const da = binds[a], db = binds[b];
      if (signature(da) !== signature(db)) continue;
      if (da.context !== db.context && da.context !== 'Global' && db.context !== 'Global') continue;
      out.set(a, [...(out.get(a) ?? []), b]);
    }
  }
  return out;
}

/** Settings → Keyboard: every rebindable action, live key capture, conflict warnings. */
export function KeyboardSection() {
  const [keybinds, setKeybinds] = useState(loadKeybinds);
  const [capturing, setCapturing] = useState<KeybindAction | null>(null);

  const refresh = useCallback(() => setKeybinds(loadKeybinds()), []);
  useEffect(() => {
    window.addEventListener('loom-keybinds-changed', refresh);
    return () => window.removeEventListener('loom-keybinds-changed', refresh);
  }, [refresh]);

  useEffect(() => {
    if (!capturing) return;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(null); return; }
      if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;
      const lower = e.key.toLowerCase();
      const label = KEY_LABELS[lower] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
      const def: Partial<KeybindDef> = {
        key: lower,
        label,
        ctrl:  e.ctrlKey  || undefined,
        meta:  e.metaKey  || undefined,
        shift: e.shiftKey || undefined,
      };
      if (capturing) saveKeybind(capturing, def);
      setCapturing(null);
    }
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [capturing]);

  const conflicts = useMemo(() => findConflicts(keybinds), [keybinds]);
  const changedCount = ALL_ACTIONS.filter(a => signature(keybinds[a]) !== signature(KEYBIND_DEFAULTS[a])).length;

  return (
    <Card as="section" id="keybindings" flush aria-labelledby="settings-keyboard-title">
      <CardHeader
        title={<span id="settings-keyboard-title">Keyboard shortcuts</span>}
        description="Choose Change, then press the new key combination. Escape cancels."
        actions={
          <>
            {conflicts.size > 0 && <Badge tone="warning" dot>{conflicts.size} conflicting</Badge>}
            <Button size="sm" variant="ghost" disabled={changedCount === 0} onClick={() => { resetKeybinds(); setCapturing(null); }}>
              Reset to defaults
            </Button>
          </>
        }
      />
      <CardBody>
        {CONTEXTS.map(ctx => (
          <Fragment key={ctx}>
            <div className={styles.kbGroup}>{ctx === 'Global' ? 'Everywhere' : 'Calendar'}</div>
            {ALL_ACTIONS.filter(a => KEYBIND_DEFAULTS[a].context === ctx).map(action => {
              const def = keybinds[action];
              const isCapturing = capturing === action;
              const clash = conflicts.get(action);
              return (
                <div key={action} className={styles.kbRow}>
                  <div className={styles.kbDesc}>
                    <span className={styles.kbLabel}>{KEYBIND_DEFAULTS[action].description}</span>
                    {clash && clash.length > 0 && (
                      <span>
                        <Badge tone="warning" size="sm" dot>
                          Also bound to {clash.map(c => KEYBIND_DEFAULTS[c].description).join(', ')}
                        </Badge>
                      </span>
                    )}
                  </div>
                  <div className={styles.kbKeys} aria-live={isCapturing ? 'polite' : undefined}>
                    {isCapturing ? (
                      <span className={styles.kbCapture}>Press a key…</span>
                    ) : (
                      keyParts(def).map((p, i) => (
                        <Fragment key={i}>
                          {i > 0 && <span className={styles.kbPlus} aria-hidden="true">+</span>}
                          <Kbd>{p}</Kbd>
                        </Fragment>
                      ))
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={isCapturing ? 'secondary' : 'subtle'}
                    aria-label={`${isCapturing ? 'Cancel changing' : 'Change'} shortcut for ${KEYBIND_DEFAULTS[action].description}`}
                    onClick={() => setCapturing(isCapturing ? null : action)}
                  >
                    {isCapturing ? 'Cancel' : 'Change'}
                  </Button>
                </div>
              );
            })}
          </Fragment>
        ))}
      </CardBody>
    </Card>
  );
}
