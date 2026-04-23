export interface KeybindDef {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  label: string;
  description: string;
}

export type KeybindAction =
  | 'sidebar_toggle'
  | 'focus_mode'
  | 'view_month'
  | 'view_week'
  | 'view_day'
  | 'view_agenda'
  | 'new_event'
  | 'today';

export const KEYBIND_DEFAULTS: Record<KeybindAction, KeybindDef> = {
  sidebar_toggle: { key: 'b',  label: 'B',  description: 'Toggle sidebar' },
  focus_mode:     { key: 'f',  label: 'F',  description: 'Go to Focus Mode' },
  view_month:     { key: '1',  label: '1',  description: 'Month view / go to Calendar' },
  view_week:      { key: '2',  label: '2',  description: 'Week view' },
  view_day:       { key: '3',  label: '3',  description: 'Day view' },
  view_agenda:    { key: '4',  label: '4',  description: 'Agenda view' },
  new_event:      { key: 'n',  label: 'N',  description: 'New event' },
  today:          { key: 't',  label: 'T',  description: 'Go to today' },
};

const LS_KEY = 'loom-keybinds';

export function loadKeybinds(): Record<KeybindAction, KeybindDef> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...KEYBIND_DEFAULTS };
    const saved = JSON.parse(raw) as Partial<Record<KeybindAction, Partial<KeybindDef>>>;
    const result = { ...KEYBIND_DEFAULTS };
    for (const action of Object.keys(KEYBIND_DEFAULTS) as KeybindAction[]) {
      if (saved[action]) {
        result[action] = { ...KEYBIND_DEFAULTS[action], ...saved[action] };
      }
    }
    return result;
  } catch {
    return { ...KEYBIND_DEFAULTS };
  }
}

export function saveKeybind(action: KeybindAction, def: Partial<KeybindDef>): void {
  const current = loadKeybinds();
  current[action] = { ...current[action], ...def };
  const toSave: Partial<Record<KeybindAction, Partial<KeybindDef>>> = {};
  for (const a of Object.keys(KEYBIND_DEFAULTS) as KeybindAction[]) {
    const d = KEYBIND_DEFAULTS[a];
    const c = current[a];
    if (c.key !== d.key || c.ctrl !== d.ctrl || c.meta !== d.meta || c.shift !== d.shift) {
      toSave[a] = { key: c.key, ctrl: c.ctrl, meta: c.meta, shift: c.shift, label: c.label };
    }
  }
  localStorage.setItem(LS_KEY, JSON.stringify(toSave));
  window.dispatchEvent(new CustomEvent('loom-keybinds-changed'));
}

export function resetKeybinds(): void {
  localStorage.removeItem(LS_KEY);
  window.dispatchEvent(new CustomEvent('loom-keybinds-changed'));
}

export function getKeybind(action: KeybindAction): KeybindDef {
  return loadKeybinds()[action];
}

export function formatKeyLabel(def: KeybindDef): string {
  const parts: string[] = [];
  if (def.ctrl)  parts.push('Ctrl');
  if (def.meta)  parts.push('⌘');
  if (def.shift) parts.push('Shift');
  parts.push(def.label || def.key.toUpperCase());
  return parts.join('+');
}
