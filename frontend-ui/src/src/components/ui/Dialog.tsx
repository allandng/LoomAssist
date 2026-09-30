import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import styles from './Dialog.module.css';
import { Button } from './Button';
import { Icon, Icons } from '../shared/Icon';
import { pushEscapeHandler } from '../../lib/escapeStack';
import { subscribeDialogs, getPendingDialog, getDialogQueueLength, popDialog, type PendingDialog } from './dialogStore';

/**
 * Host for the imperative confirm()/prompt() dialogs (see dialogStore.ts).
 * Mount once near the app root; it renders the head of the dialog queue.
 */
export function DialogHost() {
  const pending = useSyncExternalStore(subscribeDialogs, getPendingDialog, getPendingDialog);
  if (!pending) return null;
  return <DialogFrame key={getDialogQueueLength()} pending={pending} />;
}

const pop = popDialog;

function DialogFrame({ pending }: { pending: PendingDialog }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [value, setValue] = useState(pending.kind === 'prompt' ? (pending.opts.defaultValue ?? '') : '');
  const [error, setError] = useState<string | null>(null);
  const [invoker] = useState<HTMLElement | null>(() => document.activeElement as HTMLElement | null);

  function cancel() {
    if (pending.kind === 'confirm') pending.resolve(false); else pending.resolve(null);
    pop();
  }
  function ok() {
    if (pending.kind === 'confirm') { pending.resolve(true); pop(); return; }
    const err = pending.opts.validate?.(value);
    if (err) { setError(err); return; }
    pending.resolve(value);
    pop();
  }

  useEffect(() => {
    const popEsc = pushEscapeHandler(cancel);
    if (pending.kind === 'prompt') { inputRef.current?.focus(); inputRef.current?.select(); }
    else panelRef.current?.querySelector<HTMLButtonElement>('[data-confirm]')?.focus();
    return () => {
      popEsc();
      if (invoker && document.contains(invoker)) invoker.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !(pending.kind === 'prompt' && pending.opts.multiline && !e.metaKey && !e.ctrlKey)) {
      e.preventDefault();
      ok();
    }
    if (e.key === 'Tab') {
      const f = panelRef.current?.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex]:not([tabindex="-1"])') ?? [];
      const arr = Array.from(f).filter(el => !(el as HTMLButtonElement).disabled);
      if (!arr.length) return;
      const first = arr[0]!, last = arr[arr.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  const { title, description, confirmLabel, cancelLabel, icon } = pending.opts;
  const destructive = pending.kind === 'confirm' && pending.opts.destructive;

  return createPortal(
    <div className={styles.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) cancel(); }}>
      <div
        ref={panelRef}
        className={styles.panel}
        role={pending.kind === 'confirm' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="loom-dialog-title"
        aria-describedby={description ? 'loom-dialog-desc' : undefined}
        onKeyDown={onKey}
      >
        <div className={styles.body}>
          {(icon || destructive) && (
            <div className={[styles.icon, destructive ? styles.iconDanger : ''].join(' ')} aria-hidden="true">
              <Icon d={icon ?? Icons.warning} size={18} />
            </div>
          )}
          <div className={styles.text}>
            <h2 id="loom-dialog-title" className={styles.title}>{title}</h2>
            {description && <p id="loom-dialog-desc" className={styles.desc}>{description}</p>}
            {pending.kind === 'prompt' && (
              <div className={styles.promptField}>
                {pending.opts.label && <label className={styles.label} htmlFor="loom-dialog-input">{pending.opts.label}</label>}
                {pending.opts.multiline ? (
                  <textarea
                    id="loom-dialog-input"
                    ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                    className="loom-field"
                    rows={3}
                    value={value}
                    placeholder={pending.opts.placeholder}
                    onChange={e => { setValue(e.target.value); setError(null); }}
                    aria-invalid={error ? true : undefined}
                  />
                ) : (
                  <input
                    id="loom-dialog-input"
                    ref={inputRef as React.RefObject<HTMLInputElement>}
                    className="loom-field"
                    value={value}
                    placeholder={pending.opts.placeholder}
                    onChange={e => { setValue(e.target.value); setError(null); }}
                    aria-invalid={error ? true : undefined}
                  />
                )}
                {error && <div className={styles.error} role="alert">{error}</div>}
              </div>
            )}
          </div>
        </div>
        <div className={styles.footer}>
          <Button variant="ghost" onClick={cancel}>{cancelLabel ?? 'Cancel'}</Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={ok} data-confirm>
            {confirmLabel ?? (pending.kind === 'confirm' ? 'Confirm' : 'Save')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
