import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './ConfirmBar.module.css';
import { Icon, Icons } from './shared/Icon';
import { Button } from './ui';
import { pushEscapeHandler } from '../lib/escapeStack';

/**
 * WS7 #1 — confirmations for voice / AI intents live here, not in the
 * transient toast system. A floating top-center bar with an explicit action
 * sentence and spatially separated Cancel / Confirm buttons. No auto-dismiss:
 * a bar survives until the user answers it.
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
    <div className={[styles.bar, item.destructive ? styles.destructive : ''].join(' ')} role="alertdialog" aria-label={item.message}>
      <span className={styles.icon} aria-hidden="true">
        <Icon d={item.destructive ? Icons.warning : Icons.sparkles} size={15} />
      </span>
      <span className={styles.message}>{item.message}</span>
      <div className={styles.actions}>
        <Button ref={cancelRef} variant="ghost" size="sm" onClick={cancel} disabled={busy}>
          {item.cancelLabel ?? 'Cancel'}
        </Button>
        <Button variant={item.destructive ? 'danger' : 'primary'} size="sm" onClick={confirm} loading={busy}>
          {item.confirmLabel ?? 'Confirm'}
        </Button>
      </div>
    </div>
  );
}

export function ConfirmBar({ items, onResolve }: ConfirmBarProps) {
  // Esc cancels the most-recent (top) bar via the shared escapeStack, so a
  // ConfirmBar sits above the calendar's clear-selection handler and dismisses
  // one level per press.
  const top = items[items.length - 1];

  useEffect(() => {
    if (!top) return;
    return pushEscapeHandler(() => {
      top.onCancel?.();
      onResolve(top.id);
    });
  }, [top, onResolve]);

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
