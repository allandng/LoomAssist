import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Layout.module.css';
import { Icon } from '../shared/Icon';
import { Button } from './Button';

/* ── Page ────────────────────────────────────────────────────────────────── */
export interface PageProps extends HTMLAttributes<HTMLDivElement> {
  /** Centered column with a max width (dashboards, settings, journal). */
  narrow?: boolean | 'md' | 'lg';
  /** No padding: the page manages its own layout (calendar, focus). */
  bare?: boolean;
}

/** Scrollable page canvas. Every route renders inside one of these. */
export function Page({ narrow, bare, className, children, ...rest }: PageProps) {
  const width = narrow === true || narrow === 'md' ? styles.narrowMd : narrow === 'lg' ? styles.narrowLg : '';
  return (
    <div className={[styles.page, bare ? styles.bare : '', className ?? ''].join(' ')} {...rest}>
      {width ? <div className={width}>{children}</div> : children}
    </div>
  );
}

/* ── PageHeader ──────────────────────────────────────────────────────────── */
export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Small label rendered above the title (breadcrumb / section). */
  eyebrow?: ReactNode;
  actions?: ReactNode;
  /** Content rendered below the header row (tabs, filters). */
  children?: ReactNode;
}

export function PageHeader({ title, description, eyebrow, actions, children }: PageHeaderProps) {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.pageHeaderRow}>
        <div className={styles.pageHeaderText}>
          {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
          <h1 className={styles.pageTitle}>{title}</h1>
          {description && <p className={styles.pageDesc}>{description}</p>}
        </div>
        {actions && <div className={styles.pageActions}>{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/* ── Section heading (inside a page or panel) ────────────────────────────── */
export interface SectionProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Small caps label style for sidebars and dense panels. */
  small?: boolean;
}

export function Section({ title, description, actions, children, className, small }: SectionProps) {
  return (
    <section className={[styles.section, className ?? ''].join(' ')}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={small ? styles.sectionTitleSmall : styles.sectionTitle}>{title}</h2>
          {description && <p className={styles.sectionDesc}>{description}</p>}
        </div>
        {actions && <div className={styles.sectionActions}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/* ── EmptyState ──────────────────────────────────────────────────────────── */
export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary call to action. */
  action?: { label: string; onClick: () => void; icon?: ReactNode; kbd?: string };
  secondary?: { label: string; onClick: () => void };
  /** Compact variant for inside cards / sidebars. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon, title, description, action, secondary, compact, className }: EmptyStateProps) {
  return (
    <div className={[styles.empty, compact ? styles.emptyCompact : '', className ?? ''].join(' ')} role="status">
      {icon && (
        <div className={styles.emptyIcon} aria-hidden="true">
          <Icon d={icon} size={compact ? 18 : 24} strokeWidth={1.5} />
        </div>
      )}
      <div className={styles.emptyTitle}>{title}</div>
      {description && <div className={styles.emptyDesc}>{description}</div>}
      {(action || secondary) && (
        <div className={styles.emptyActions}>
          {action && (
            <Button variant="primary" size={compact ? 'sm' : 'md'} icon={action.icon} kbd={action.kbd} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondary && (
            <Button variant="subtle" size={compact ? 'sm' : 'md'} onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Toolbar ─────────────────────────────────────────────────────────────── */
export function Toolbar({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.toolbar, className ?? ''].join(' ')} {...rest}>{children}</div>;
}
export function ToolbarSpacer() {
  return <div className={styles.spacer} aria-hidden="true" />;
}
export function ToolbarDivider() {
  return <div className={styles.vdivider} aria-hidden="true" />;
}

/* ── Stat tile ───────────────────────────────────────────────────────────── */
export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Secondary line under the value (e.g. "+2 vs last week"). */
  sub?: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'error';
  icon?: ReactNode;
  onClick?: () => void;
}

export function StatTile({ label, value, sub, tone = 'neutral', icon, onClick }: StatTileProps) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={[styles.stat, styles[`tone_${tone}`], onClick ? styles.statClickable : ''].join(' ')} onClick={onClick} type={onClick ? 'button' : undefined}>
      <div className={styles.statTop}>
        <span className={styles.statLabel}>{label}</span>
        {icon && <span className={styles.statIcon}><Icon d={icon} size={14} /></span>}
      </div>
      <div className={styles.statValue}>{value}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </Tag>
  );
}

/* ── Key/value row (settings, detail panes) ──────────────────────────────── */
export interface RowProps {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  /** Draw a divider under the row. */
  divider?: boolean;
  /** Align the control to the top for tall content. */
  top?: boolean;
}

export function Row({ label, description, children, icon, divider = true, top }: RowProps) {
  return (
    <div className={[styles.row, divider ? styles.rowDivider : '', top ? styles.rowTop : ''].join(' ')}>
      {icon && <span className={styles.rowIcon}><Icon d={icon} size={15} /></span>}
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        {description && <div className={styles.rowDesc}>{description}</div>}
      </div>
      {children && <div className={styles.rowControl}>{children}</div>}
    </div>
  );
}
