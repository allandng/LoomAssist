import type { ReactNode } from 'react';

/**
 * Imperative confirm / prompt dialogs — the store half.
 *
 *   const ok = await confirm({ title: 'Delete "Physics"?', description: '…', destructive: true, confirmLabel: 'Delete' });
 *   const name = await prompt({ title: 'Rename timeline', defaultValue: tl.name });
 *
 * `<DialogHost />` (Dialog.tsx) is mounted once in App and renders the head of
 * this queue. These replace every `window.confirm` and `window.prompt`: same
 * await-style call, but themed, keyboard-correct (Enter confirms, Esc cancels
 * via the escape stack) and focus-restoring.
 */

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button. */
  destructive?: boolean;
  icon?: ReactNode;
}

export interface PromptOptions extends Omit<ConfirmOptions, 'destructive'> {
  defaultValue?: string;
  placeholder?: string;
  label?: ReactNode;
  /** Multi-line input. */
  multiline?: boolean;
  /** Return a string to show as an error and keep the dialog open. */
  validate?: (value: string) => string | null | undefined;
}

export type PendingDialog =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (value: string | null) => void };

let queue: PendingDialog[] = [];
const listeners = new Set<() => void>();
function emit() { listeners.forEach(l => l()); }

export function subscribeDialogs(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function getPendingDialog(): PendingDialog | null { return queue[0] ?? null; }
export function getDialogQueueLength(): number { return queue.length; }
export function popDialog() { queue = queue.slice(1); emit(); }

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => { queue = [...queue, { kind: 'confirm', opts, resolve }]; emit(); });
}

export function prompt(opts: PromptOptions): Promise<string | null> {
  return new Promise(resolve => { queue = [...queue, { kind: 'prompt', opts, resolve }]; emit(); });
}
