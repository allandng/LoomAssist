import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Controls.module.css';
import { Icon } from '../shared/Icon';

/* ── Segmented control ───────────────────────────────────────────────────── */
export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  kbd?: string;
  /** Icon-only option; label becomes the tooltip. */
  iconOnly?: boolean;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (next: T) => void;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}

/** Exclusive choice among 2–6 options. Arrow keys move the selection. */
export function Segmented<T extends string>({ value, options, onChange, size = 'md', 'aria-label': ariaLabel }: SegmentedProps<T>) {
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = options.findIndex(o => o.value === value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onChange(options[(i + 1) % options.length].value); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onChange(options[(i - 1 + options.length) % options.length].value); }
  }
  return (
    <div className={[styles.segmented, size === 'sm' ? styles.segmentedSm : ''].join(' ')} role="radiogroup" aria-label={ariaLabel} onKeyDown={onKey}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={[styles.segment, active ? styles.segmentActive : ''].join(' ')}
            onClick={() => onChange(o.value)}
            title={o.iconOnly ? String(o.label) : undefined}
            aria-label={o.iconOnly ? String(o.label) : undefined}
          >
            {o.icon && <Icon d={o.icon} size={size === 'sm' ? 13 : 14} />}
            {!o.iconOnly && <span>{o.label}</span>}
            {o.kbd && <kbd className={styles.segKbd}>{o.kbd}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */
export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
}

export interface TabsProps<T extends string> {
  value: T;
  items: TabItem<T>[];
  onChange: (next: T) => void;
  'aria-label'?: string;
}

/** Underlined tabs for switching sub-views inside a page. */
export function Tabs<T extends string>({ value, items, onChange, 'aria-label': ariaLabel }: TabsProps<T>) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={ariaLabel}>
      {items.map(t => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={[styles.tab, active ? styles.tabActive : ''].join(' ')}
            onClick={() => onChange(t.value)}
          >
            {t.icon && <Icon d={t.icon} size={14} />}
            <span>{t.label}</span>
            {t.count != null && <span className={styles.tabCount}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── Badge ───────────────────────────────────────────────────────────────── */
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error' | 'info';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /** Custom color (e.g. a timeline hue) — overrides tone. */
  color?: string;
  /** Leading status dot. */
  dot?: boolean;
  icon?: ReactNode;
  size?: 'sm' | 'md';
  /** Outlined instead of filled. */
  outline?: boolean;
  className?: string;
  title?: string;
}

/** Small status / category label. Never clickable — use a Button for that. */
export function Badge({ children, tone = 'neutral', color, dot, icon, size = 'md', outline, className, title }: BadgeProps) {
  const style = color
    ? ({ '--badge-color': color } as CSSProperties)
    : undefined;
  return (
    <span
      className={[styles.badge, styles[`badge_${color ? 'custom' : tone}`], size === 'sm' ? styles.badgeSm : '', outline ? styles.badgeOutline : '', className ?? ''].join(' ')}
      style={style}
      title={title}
    >
      {dot && <span className={styles.badgeDot} aria-hidden="true" />}
      {icon && <Icon d={icon} size={size === 'sm' ? 10 : 12} />}
      {children}
    </span>
  );
}

/* ── Avatar ──────────────────────────────────────────────────────────────── */
export interface AvatarProps {
  name?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
}

export function Avatar({ name, src, size = 28, className }: AvatarProps) {
  const initials = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]!.toUpperCase())
    .join('') || '·';
  return (
    <span className={[styles.avatar, className ?? ''].join(' ')} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {src ? <img src={src} alt="" className={styles.avatarImg} /> : initials}
    </span>
  );
}

/* ── Progress ring (SVG) ─────────────────────────────────────────────────── */
export interface ProgressRingProps {
  /** 0..1 */
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  children?: ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function ProgressRing({ value, size = 120, stroke = 8, color = 'var(--accent)', trackColor = 'var(--bg-subtle)', children, className, 'aria-label': ariaLabel }: ProgressRingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className={[styles.ring, className ?? ''].join(' ')} style={{ width: size, height: size }} role={ariaLabel ? 'progressbar' : undefined} aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={styles.ringFill}
        />
      </svg>
      {children && <div className={styles.ringContent}>{children}</div>}
    </div>
  );
}

/* ── Linear progress ─────────────────────────────────────────────────────── */
export function ProgressBar({ value, color, height = 6, className, 'aria-label': ariaLabel }: { value: number; color?: string; height?: number; className?: string; 'aria-label'?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={[styles.bar, className ?? ''].join(' ')} style={{ height }} role="progressbar" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div className={styles.barFill} style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ── Spinner & Skeleton ──────────────────────────────────────────────────── */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span className={[styles.spinner, className ?? ''].join(' ')} style={{ width: size, height: size }} role="status" aria-label="Loading" />
  );
}

export function Skeleton({ width, height = 14, radius, className, style }: { width?: number | string; height?: number | string; radius?: number; className?: string; style?: CSSProperties }) {
  return <span className={[styles.skeleton, className ?? ''].join(' ')} style={{ width, height, borderRadius: radius, ...style }} aria-hidden="true" />;
}

/* ── Tooltip ─────────────────────────────────────────────────────────────── */
export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Delay before showing, ms. */
  delay?: number;
}

/**
 * Lightweight hover/focus tooltip. Wraps a single focusable child; the child
 * must still carry its own accessible name (tooltips are supplemental).
 */
export function Tooltip({ content, children, side = 'top', delay = 350 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const id = useId();

  function show() {
    timer.current = window.setTimeout(() => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      const x = side === 'left' ? r.left : side === 'right' ? r.right : r.left + r.width / 2;
      const y = side === 'top' ? r.top : side === 'bottom' ? r.bottom : r.top + r.height / 2;
      setPos({ x, y });
      setOpen(true);
    }, delay);
  }
  function hide() {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  }
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return (
    <span ref={wrapRef} className={styles.tipWrap} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} aria-describedby={open ? id : undefined}>
      {children}
      {open && pos && createPortal(
        <span id={id} role="tooltip" className={[styles.tip, styles[`tip_${side}`]].join(' ')} style={{ left: pos.x, top: pos.y }}>
          {content}
        </span>,
        document.body,
      )}
    </span>
  );
}
