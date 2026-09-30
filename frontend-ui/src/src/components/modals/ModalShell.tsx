import { useEffect, useRef, useState, useCallback, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './ModalShell.module.css';
import { Button, IconButton, Icons } from '../ui';
import { pushEscapeHandler } from '../../lib/escapeStack';
import { useModalOptional } from '../../contexts/ModalContext';

export type ModalVariant = 'dialog' | 'sheet';
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_PX: Record<ModalSize, number> = { sm: 400, md: 520, lg: 680, xl: 880 };

export interface ModalShellProps {
  title: ReactNode;
  /** Secondary line under the title (context, e.g. the connection name). */
  subtitle?: ReactNode;
  /** Slot between the title block and the close button (badges, small actions). */
  headerActions?: ReactNode;
  /** `dialog` (centered, default) or `sheet` (right-side panel; the page stays readable). */
  variant?: ModalVariant;
  /** Width preset for dialogs: sm 400 · md 520 · lg 680 · xl 880. */
  size?: ModalSize;
  /** Explicit width in px — overrides `size` (and `--sheet-w` for sheets). */
  width?: number;
  /** Remove the body padding (edge-to-edge tables / lists). */
  flush?: boolean;
  /** Accessible name when `title` is not a plain string. */
  'aria-label'?: string;
  children: ReactNode;
  onClose: () => void;
  /**
   * When true, a scrim click / Escape does not close immediately; it surfaces
   * an inline "Discard changes?" bar so a half-filled form isn't lost to a
   * stray click. EventEditor sets this whenever a field is dirty.
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

export function ModalShell({
  title,
  subtitle,
  headerActions,
  variant = 'dialog',
  size = 'md',
  width,
  flush = false,
  'aria-label': ariaLabel,
  children,
  onClose,
  confirmOnClose = false,
}: ModalShellProps) {
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

  const isSheet = variant === 'sheet';
  const px = width ?? (isSheet ? undefined : SIZE_PX[size]);
  const panelStyle = px != null ? ({ '--modal-w': `${px}px` } as CSSProperties) : undefined;
  const label = ariaLabel ?? (typeof title === 'string' ? title : undefined);

  const panel = (
    <div
      ref={panelRef}
      className={[styles.panel, isSheet ? styles.sheet : styles.dialog].join(' ')}
      style={panelStyle}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
    >
      <div className={styles.header}>
        <div className={styles.headerText}>
          <h2 className={styles.title}>{title}</h2>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
        {headerActions && <div className={styles.headerActions}>{headerActions}</div>}
        <IconButton icon={Icons.x} label="Close" size="sm" onClick={requestClose} />
      </div>
      <div className={[styles.body, flush ? styles.flush : ''].join(' ')}>{children}</div>
      {showDiscard && (
        <div className={styles.discardBar} role="alertdialog" aria-label="Discard changes?">
          <span className={styles.discardText}>Discard changes?</span>
          <div className={styles.discardActions}>
            <Button variant="ghost" size="sm" onClick={() => setShowDiscard(false)}>Keep editing</Button>
            <Button variant="danger" size="sm" onClick={onClose}>Discard</Button>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(
    isSheet ? (
      <div className={styles.sheetRoot}>
        <div className={styles.sheetScrim} onClick={requestClose} aria-hidden="true" />
        {panel}
      </div>
    ) : (
      <div className={styles.backdrop} onClick={e => { if (e.target === e.currentTarget) requestClose(); }}>
        {panel}
      </div>
    ),
    document.body,
  );
}

/* ── Footer: right-aligned actions, optional `left` slot for destructive / secondary ── */
export function ModalFooter({ children, left, className }: { children?: ReactNode; left?: ReactNode; className?: string }) {
  return (
    <div className={[styles.footer, className ?? ''].join(' ')}>
      {left && <div className={styles.footerLeft}>{left}</div>}
      <div className={styles.footerRight}>{children}</div>
    </div>
  );
}

/* ── FieldLabel: thin label matching the Field primitive's look ─────────── */
export function FieldLabel({ children, htmlFor, right }: { children: ReactNode; htmlFor?: string; right?: ReactNode }) {
  return (
    <div className={styles.fieldLabelRow}>
      <label className={styles.fieldLabel} htmlFor={htmlFor}>{children}</label>
      {right}
    </div>
  );
}

/* ── Shared building blocks for modal bodies ────────────────────────────── */

/** Vertical stack of fields with the standard gap. */
export function ModalStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.stack, className ?? ''].join(' ')}>{children}</div>;
}

/** Inline notice (warning / error / info) inside a modal body. */
export function ModalNotice({ tone = 'info', icon, children }: { tone?: 'info' | 'warning' | 'error' | 'success'; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={[styles.notice, styles[`notice_${tone}`]].join(' ')} role={tone === 'error' ? 'alert' : 'status'}>
      {icon}
      <div className={styles.noticeText}>{children}</div>
    </div>
  );
}
