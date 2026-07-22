import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './ConfirmBar.module.css';
import { pushEscapeHandler } from '../lib/escapeStack';

/**
 * WS7 #1 — destructive confirmations live here, not in the transient toast
 * system. A fixed bottom-center bar with an explicit action sentence and
 * spatially-separated Cancel / Confirm buttons. No auto-dismiss: a bar survives
 * until the user answers it.
 */
export interface ConfirmBarItem {
  id: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

interface ConfirmBarProps {
  items: ConfirmBarItem[];
  onResolve: (id: string) => void;
}

function ConfirmRow({ item, onResolve, autoFocus }: {
  item: ConfirmBarItem;
  onResolve: (id: string) => void;
  autoFocus: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus) cancelRef.current?.focus();
  }, [autoFocus]);

  const confirm = useCallback(async () => {
    setBusy(true);
    try {
      await item.onConfirm();
      onResolve(item.id);
    } catch {
      // Leave the bar up so the user can retry the action.
      setBusy(false);
    }
  }, [item, onResolve]);

  const cancel = useCallback(() => {
    item.onCancel?.();
    onResolve(item.id);
  }, [item, onResolve]);

  return (
    <div className={styles.bar} role="alertdialog" aria-label={item.message}>
      <span className={styles.message}>{item.message}</span>
      <div className={styles.actions}>
        <button
          ref={cancelRef}
          type="button"
          className={styles.cancel}
          onClick={cancel}
          disabled={busy}
        >
          {item.cancelLabel ?? 'Cancel'}
        </button>
        <button
          type="button"
          className={`${styles.confirm} ${item.destructive ? styles.destructive : ''}`}
          onClick={confirm}
          disabled={busy}
        >
          {busy ? 'Working…' : (item.confirmLabel ?? 'Confirm')}
        </button>
      </div>
    </div>
  );
}

export function ConfirmBar({ items, onResolve }: ConfirmBarProps) {
  // Esc cancels the most-recent (top) bar via the shared escapeStack, so a
  // ConfirmBar sits above the calendar's clear-selection handler and dismisses
  // one layer per press instead of being swallowed by a capture-phase consumer.
  useEffect(() => {
    if (items.length === 0) return;
    return pushEscapeHandler(() => {
      const top = items[items.length - 1];
      top.onCancel?.();
      onResolve(top.id);
    });
  }, [items, onResolve]);

  if (items.length === 0) return null;

  return createPortal(
    <div className={styles.stack} role="region" aria-label="Pending confirmations">
      {items.map((item, i) => (
        <ConfirmRow
          key={item.id}
          item={item}
          onResolve={onResolve}
          autoFocus={i === items.length - 1}
        />
      ))}
    </div>,
    document.body,
  );
}
