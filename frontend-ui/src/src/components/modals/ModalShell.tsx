import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './ModalShell.module.css';
import { Icon, Icons } from '../shared/Icon';
import { pushEscapeHandler } from '../../lib/escapeStack';
import { useModalOptional } from '../../contexts/ModalContext';

interface ModalShellProps {
  title: string;
  width?: number;
  children: ReactNode;
  onClose: () => void;
  /**
   * WS5 #2 — when true, a backdrop click / Escape does not close immediately;
   * it surfaces an inline "Discard changes?" bar so a half-filled form isn't
   * lost to a stray click. EventEditor sets this whenever a field is dirty.
   */
  confirmOnClose?: boolean;
}

const TEXT_ENTRY = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (TEXT_ENTRY.has(el.tagName)) {
    // Buttons/checkboxes reuse <input>; only blur genuine text-entry controls.
    if (el.tagName === 'INPUT') {
      const type = (el as HTMLInputElement).type;
      return !['button', 'submit', 'checkbox', 'radio', 'reset'].includes(type);
    }
    return true;
  }
  return (el as HTMLElement).isContentEditable;
}

export function ModalShell({ title, width = 520, children, onClose, confirmOnClose = false }: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const modalCtx = useModalOptional();
  const [showDiscard, setShowDiscard] = useState(false);

  // Capture the invoker on mount — before React commits, document.activeElement
  // is still the element that opened the dialog. Prefer ModalContext's capture
  // (taken synchronously at open() time) and fall back to a live read. useState's
  // lazy initializer runs exactly once, so this is stable.
  const [invoker] = useState<HTMLElement | null>(
    () => modalCtx?.modal.invoker ?? (document.activeElement as HTMLElement | null),
  );

  // Keep the latest confirm/close intent readable from the (mount-only) effects.
  const confirmRef = useRef(confirmOnClose);
  const showDiscardRef = useRef(showDiscard);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    confirmRef.current = confirmOnClose;
    showDiscardRef.current = showDiscard;
    onCloseRef.current = onClose;
  });

  const requestClose = useCallback(() => {
    if (confirmOnClose) setShowDiscard(true);
    else onClose();
  }, [confirmOnClose, onClose]);

  // Focus discipline + Tab trap + Escape (via the shared stack). Mount-only so
  // the trap is stable; intent is read through refs.
  useEffect(() => {
    const panel = panelRef.current;
    // Move focus in: first [data-autofocus], else leave native autoFocus alone,
    // else focus the dialog container so Tab starts inside the trap.
    const auto = panel?.querySelector<HTMLElement>('[data-autofocus]');
    if (auto) auto.focus();
    else if (panel && !panel.contains(document.activeElement)) panel.focus();

    const popEscape = pushEscapeHandler(() => {
      if (showDiscardRef.current) { onCloseRef.current(); return; }
      const ae = document.activeElement;
      if (panelRef.current?.contains(ae) && ae !== panelRef.current && isTextEntry(ae)) {
        (ae as HTMLElement).blur();
        return;
      }
      if (confirmRef.current) setShowDiscard(true);
      else onCloseRef.current();
    });

    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ?? [];
      const arr = Array.from(focusables).filter(
        el => !(el as HTMLButtonElement).disabled && el.offsetParent !== null,
      );
      if (arr.length === 0) { e.preventDefault(); panelRef.current?.focus(); return; }
      const first = arr[0], last = arr[arr.length - 1];
      const ae = document.activeElement;
      if (e.shiftKey && (ae === first || !panelRef.current?.contains(ae))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (ae === last || !panelRef.current?.contains(ae))) { e.preventDefault(); first.focus(); }
    }
    window.addEventListener('keydown', onKey);

    return () => {
      popEscape();
      window.removeEventListener('keydown', onKey);
      // Return focus to the invoker; fall back to the calendar surface if it's gone.
      if (invoker && document.contains(invoker)) invoker.focus();
      else document.querySelector<HTMLElement>('.fc')?.focus?.();
    };
  }, [invoker]);

  return createPortal(
    <div className={styles.backdrop} onClick={e => { if (e.target === e.currentTarget) requestClose(); }}>
      <div
        ref={panelRef}
        className={styles.panel}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button className={styles.closeBtn} onClick={requestClose} aria-label="Close">
            <Icon d={Icons.x} size={14} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {showDiscard && (
          <div className={styles.discardBar} role="alertdialog" aria-label="Discard changes?">
            <span className={styles.discardText}>Discard changes?</span>
            <div className={styles.discardActions}>
              <button className="loom-btn-ghost" onClick={() => setShowDiscard(false)}>Keep editing</button>
              <button className={styles.discardConfirm} onClick={onClose}>Discard</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <div className={styles.fieldLabel}>{children}</div>;
}
