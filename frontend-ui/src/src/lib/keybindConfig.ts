export type KeybindContext = 'Global' | 'Calendar';

export interface KeybindDef {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  label: string;
  description: string;
  context: KeybindContext;
}

export type KeybindAction =
  | 'sidebar_toggle'
  | 'focus_mode'
  | 'view_month'
  | 'view_week'
  | 'view_day'
  | 'view_year'
  | 'view_agenda'
  | 'new_event'
  | 'today'
  | 'prev_period'
  | 'next_period'
  | 'delete_selected'
  | 'snooze_day'
  | 'snooze_week'
  | 'search'
  | 'inbox'
  | 'jump_date'
  | 'shortcut_sheet'
  | 'command_palette';

// WS4 shell audit #7 — the number keys must match the TopBar view-switcher
// order exactly: 1=Month, 2=Week, 3=Day, 4=Year, 5=Agenda.
export const KEYBIND_DEFAULTS: Record<KeybindAction, KeybindDef> = {
  sidebar_toggle:  { key: 'b',          label: 'B',   description: 'Toggle sidebar',                context: 'Global' },
  focus_mode:      { key: 'f',          label: 'F',   description: 'Go to Focus Mode',              context: 'Global' },
  new_event:       { key: 'n',          label: 'N',   description: 'New event',                     context: 'Global' },
  search:          { key: '/',          label: '/',   description: 'Focus search',                  context: 'Global' },
  inbox:           { key: 'i',          label: 'I',   description: 'Toggle inbox',                  context: 'Global' },
  jump_date:       { key: 'g',          label: 'G',   description: 'Jump to date',                  context: 'Global' },
  shortcut_sheet:  { key: '?', shift: true, label: '?', description: 'Show keyboard shortcuts',     context: 'Global' },
  command_palette: { key: 'k', meta: true,  label: 'K', description: 'Open command palette',        context: 'Global' },
  view_month:      { key: '1',          label: '1',   description: 'Month view / go to Calendar',   context: 'Calendar' },
  view_week:       { key: '2',          label: '2',   description: 'Week view',                     context: 'Calendar' },
  view_day:        { key: '3',          label: '3',   description: 'Day view',                      context: 'Calendar' },
  view_year:       { key: '4',          label: '4',   description: 'Year view',                     context: 'Calendar' },
  view_agenda:     { key: '5',          label: '5',   description: 'Agenda view',                   context: 'Calendar' },
  today:           { key: 't',          label: 'T',   description: 'Go to today',                   context: 'Calendar' },
  prev_period:     { key: '[',          label: '[',   description: 'Previous period',               context: 'Calendar' },
  next_period:     { key: ']',          label: ']',   description: 'Next period',                   context: 'Calendar' },
  delete_selected: { key: 'Delete',     label: 'Del', description: 'Delete selected event(s)',      context: 'Calendar' },
  snooze_day:      { key: 'arrowright', label: '→',   description: 'Snooze selected event +1 day',  context: 'Calendar' },
  snooze_week:     { key: 'arrowright', shift: true, label: '→', description: 'Snooze selected event +1 week', context: 'Calendar' },
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
