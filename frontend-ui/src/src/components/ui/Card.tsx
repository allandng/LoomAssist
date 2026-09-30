import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Remove the default body padding (e.g. for tables / lists that go edge to edge). */
  flush?: boolean;
  /** Elevated look with a soft shadow instead of a flat panel. */
  elevated?: boolean;
  /** Interactive card: hover ring + pointer. */
  interactive?: boolean;
  as?: 'div' | 'section' | 'article';
}

/** Panel surface. Compose with `CardHeader` for a titled section. */
export function Card({ flush, elevated, interactive, as: Tag = 'div', className, children, ...rest }: CardProps) {
  return (
    <Tag
      className={[styles.card, flush ? styles.flush : '', elevated ? styles.elevated : '', interactive ? styles.interactive : '', className ?? ''].join(' ')}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned actions (buttons, links, a badge). */
  actions?: ReactNode;
  /** Leading icon or swatch. */
  icon?: ReactNode;
  /** Smaller, uppercase-free header for dense widgets. */
  compact?: boolean;
}

export function CardHeader({ title, description, actions, icon, compact }: CardHeaderProps) {
  return (
    <header className={[styles.header, compact ? styles.compact : ''].join(' ')}>
      <div className={styles.headerText}>
        <div className={styles.titleRow}>
          {icon && <span className={styles.icon}>{icon}</span>}
          <h2 className={styles.title}>{title}</h2>
        </div>
        {description && <p className={styles.desc}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.body, className ?? ''].join(' ')}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.footer, className ?? ''].join(' ')}>{children}</div>;
}
