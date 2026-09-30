import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Menu.module.css';
import { Icon } from '../shared/Icon';
import { pushEscapeHandler } from '../../lib/escapeStack';

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  kbd?: string;
  /** Renders red. */
  danger?: boolean;
  disabled?: boolean;
  /** Shows a check mark (for toggles / current choice). */
  checked?: boolean;
  onSelect?: () => void;
}

export type MenuEntry = MenuItem | { separator: true } | { heading: ReactNode };

export interface MenuProps {
  /** The trigger. Receives `open` state and toggle props. */
  trigger: (props: { open: boolean; toggle: () => void; ref: React.RefObject<HTMLButtonElement | null>; 'aria-haspopup': 'menu'; 'aria-expanded': boolean }) => ReactNode;
  items: MenuEntry[];
  align?: 'start' | 'end';
  side?: 'bottom' | 'top';
  width?: number;
}

function isSeparator(e: MenuEntry): e is { separator: true } { return 'separator' in e; }
function isHeading(e: MenuEntry): e is { heading: ReactNode } { return 'heading' in e; }

/**
 * Dropdown menu anchored to a trigger. Portalled, keyboard navigable
 * (↑ ↓ Home End Enter Esc), closes on outside click / scroll / Escape.
 */
export function Menu({ trigger, items, align = 'start', side = 'bottom', width = 220 }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [activeIdx, setActiveIdx] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const selectable = items
    .map((e, i) => (!isSeparator(e) && !isHeading(e) && !e.disabled ? i : -1))
    .filter(i => i >= 0);

  const close = useCallback(() => { setOpen(false); setActiveIdx(-1); }, []);
  const toggle = useCallback(() => setOpen(o => !o), []);

  useLayoutEffect(() => {
    if (!open) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuH = menuRef.current?.offsetHeight ?? 0;
    let top = side === 'bottom' ? r.bottom + 4 : r.top - menuH - 4;
    let left = align === 'start' ? r.left : r.right - width;
    // Keep on screen
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (left < 8) left = 8;
    if (top + menuH > window.innerHeight - 8) top = Math.max(8, r.top - menuH - 4);
    setPos({ left, top });
  }, [open, align, side, width]);

  useEffect(() => {
    if (!open) return;
    const pop = pushEscapeHandler(() => { close(); triggerRef.current?.focus(); });
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close();
    }
    function onScroll() { close(); }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      pop();
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) {
      // Focus the first item for keyboard users.
      const first = selectable[0] ?? -1;
      setActiveIdx(first);
      window.setTimeout(() => menuRef.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (selectable.length === 0) return;
    const cur = selectable.indexOf(activeIdx);
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(selectable[(cur + 1) % selectable.length]!); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(selectable[(cur - 1 + selectable.length) % selectable.length]!); }
    else if (e.key === 'Home') { e.preventDefault(); setActiveIdx(selectable[0]!); }
    else if (e.key === 'End') { e.preventDefault(); setActiveIdx(selectable[selectable.length - 1]!); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const item = items[activeIdx];
      if (item && !isSeparator(item) && !isHeading(item)) { item.onSelect?.(); close(); triggerRef.current?.focus(); }
    } else if (e.key === 'Tab') { close(); }
  }

  return (
    <>
      {trigger({ open, toggle, ref: triggerRef, 'aria-haspopup': 'menu', 'aria-expanded': open })}
      {open && createPortal(
        <div
          ref={menuRef}
          id={id}
          role="menu"
          tabIndex={-1}
          className={styles.menu}
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width, visibility: pos ? 'visible' : 'hidden' }}
          onKeyDown={onKey}
        >
          {items.map((entry, i) => {
            if (isSeparator(entry)) return <div key={`sep-${i}`} className={styles.separator} role="separator" />;
            if (isHeading(entry)) return <div key={`h-${i}`} className={styles.heading}>{entry.heading}</div>;
            const active = i === activeIdx;
            return (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                className={[styles.item, active ? styles.itemActive : '', entry.danger ? styles.itemDanger : ''].join(' ')}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => { entry.onSelect?.(); close(); }}
              >
                {entry.icon && <span className={styles.itemIcon}><Icon d={entry.icon} size={14} /></span>}
                <span className={styles.itemLabel}>{entry.label}</span>
                {entry.checked && <span className={styles.itemCheck}>✓</span>}
                {entry.kbd && <kbd className={styles.itemKbd}>{entry.kbd}</kbd>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ── Popover (generic anchored surface) ──────────────────────────────────── */
export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  children: ReactNode;
  align?: 'start' | 'end' | 'center';
  width?: number;
  className?: string;
  /** Accessible label for the surface. */
  label?: string;
}

/** Anchored floating panel (filters, pickers). Closes on outside click / Esc. */
export function Popover({ open, onClose, anchor, children, align = 'start', width, className, label }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = width ?? ref.current?.offsetWidth ?? 280;
    const h = ref.current?.offsetHeight ?? 0;
    let left = align === 'start' ? r.left : align === 'end' ? r.right - w : r.left + r.width / 2 - w / 2;
    let top = r.bottom + 6;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    setPos({ left, top });
  }, [open, anchor, align, width]);

  useEffect(() => {
    if (!open) return;
    const pop = pushEscapeHandler(onClose);
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => { pop(); document.removeEventListener('mousedown', onDown); };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={[styles.popover, className ?? ''].join(' ')}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}
