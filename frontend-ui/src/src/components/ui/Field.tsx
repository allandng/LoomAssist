import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import styles from './Field.module.css';
import { Icon, Icons } from '../shared/Icon';

/* ── Field wrapper: label + control + hint/error ─────────────────────────── */
export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Renders the label inline to the left (settings rows). */
  inline?: boolean;
  /** Optional trailing element next to the label (e.g. a "Suggested" badge). */
  labelRight?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, inline, labelRight, htmlFor, children, className }: FieldProps) {
  return (
    <div className={[styles.field, inline ? styles.inline : '', className ?? ''].join(' ')}>
      {(label || labelRight) && (
        <div className={styles.labelRow}>
          {label && <label className={styles.label} htmlFor={htmlFor}>{label}</label>}
          {labelRight}
        </div>
      )}
      <div className={styles.control}>
        {children}
        {error ? (
          <div className={styles.error} role="alert">{error}</div>
        ) : hint ? (
          <div className={styles.hint}>{hint}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Input ───────────────────────────────────────────────────────────────── */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Leading icon inside the input. */
  icon?: ReactNode;
  invalid?: boolean;
  /** Visually smaller control for dense toolbars. */
  size?: 'sm' | 'md';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, invalid, size = 'md', className, ...rest },
  ref,
) {
  const inner = (
    <input
      ref={ref}
      className={[styles.input, size === 'sm' ? styles.sm : '', icon ? styles.withIcon : '', className ?? ''].join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
  if (!icon) return inner;
  return (
    <div className={styles.iconWrap}>
      <Icon d={icon} size={14} className={styles.leadingIcon} />
      {inner}
    </div>
  );
});

/* ── Textarea ────────────────────────────────────────────────────────────── */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={[styles.input, styles.textarea, className ?? ''].join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

/* ── Select (native, styled) ─────────────────────────────────────────────── */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  invalid?: boolean;
  /** Visually smaller control for dense toolbars. */
  size?: 'sm' | 'md';
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, size, className, children, ...rest },
  ref,
) {
  const dense = size === 'sm';
  return (
    <div className={styles.selectWrap}>
      <select
        ref={ref}
        className={[styles.input, styles.select, dense ? styles.sm : '', className ?? ''].join(' ')}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {children}
      </select>
      <Icon d={Icons.chevronDown} size={13} className={styles.selectChevron} />
    </div>
  );
});

/* ── Switch ──────────────────────────────────────────────────────────────── */
export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  size?: 'sm' | 'md';
}

export function Switch({ checked, onChange, label, description, disabled, id, size = 'md' }: SwitchProps) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const control = (
    <button
      id={switchId}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={[styles.switch, size === 'sm' ? styles.switchSm : '', checked ? styles.switchOn : ''].join(' ')}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.thumb} />
    </button>
  );
  if (!label && !description) return control;
  return (
    <div className={styles.switchRow}>
      <div className={styles.switchText}>
        {label && <label htmlFor={switchId} className={styles.switchLabel}>{label}</label>}
        {description && <div className={styles.switchDesc}>{description}</div>}
      </div>
      {control}
    </div>
  );
}

/* ── Checkbox ────────────────────────────────────────────────────────────── */
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode;
  /** Renders as a circular "task done" toggle. */
  round?: boolean;
  /** Tint the checked state (e.g. a timeline color). */
  color?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, round, color, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const cbId = id ?? autoId;
  return (
    <label htmlFor={cbId} className={[styles.checkbox, round ? styles.round : '', className ?? ''].join(' ')}>
      <input ref={ref} id={cbId} type="checkbox" className={styles.checkboxInput} {...rest} />
      <span className={styles.box} style={color ? ({ '--cb-color': color } as React.CSSProperties) : undefined}>
        <Icon d={Icons.check} size={11} strokeWidth={3} />
      </span>
      {label && <span className={styles.checkboxLabel}>{label}</span>}
    </label>
  );
});
