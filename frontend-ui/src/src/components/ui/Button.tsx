import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './Button.module.css';
import { Icon, Icons } from '../shared/Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'subtle' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (an `Icons.*` fragment). */
  icon?: ReactNode;
  /** Trailing icon. */
  iconRight?: ReactNode;
  loading?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
  /** Optional keyboard hint rendered after the label, e.g. "N" or "⌘K". */
  kbd?: string;
}

/**
 * The one button. Five variants share one box model so mixed rows line up:
 *   primary   — the single most important action on a surface
 *   secondary — filled neutral, for second-tier actions
 *   ghost     — outlined, for toolbars and footers
 *   subtle    — text-only, for tertiary / inline actions
 *   danger    — destructive confirmation
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading = false, block, kbd, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const iconSize = size === 'sm' ? 13 : size === 'lg' ? 17 : 15;
  return (
    <button
      ref={ref}
      type={type}
      className={[styles.btn, styles[variant], styles[size], block ? styles.block : '', loading ? styles.loading : '', className ?? ''].join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Icon d={Icons.loader} size={iconSize} className={styles.spinner} />
      ) : icon ? (
        <Icon d={icon} size={iconSize} />
      ) : null}
      {children != null && <span className={styles.label}>{children}</span>}
      {kbd && <kbd className={styles.kbd}>{kbd}</kbd>}
      {iconRight && !loading && <Icon d={iconRight} size={iconSize} />}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  /** Required: the accessible name. Also used as the tooltip. */
  label: string;
  size?: ButtonSize;
  /** Highlighted state (e.g. a toggled filter). */
  active?: boolean;
  variant?: 'subtle' | 'ghost';
  iconSize?: number;
}

/** Square icon-only button. Always labelled. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', active, variant = 'subtle', iconSize, className, type = 'button', ...rest },
  ref,
) {
  const px = iconSize ?? (size === 'sm' ? 14 : size === 'lg' ? 18 : 16);
  return (
    <button
      ref={ref}
      type={type}
      className={[styles.iconBtn, styles[`icon_${size}`], variant === 'ghost' ? styles.iconGhost : '', active ? styles.iconActive : '', className ?? ''].join(' ')}
      aria-label={label}
      title={label}
      aria-pressed={active}
      {...rest}
    >
      <Icon d={icon} size={px} />
    </button>
  );
});
