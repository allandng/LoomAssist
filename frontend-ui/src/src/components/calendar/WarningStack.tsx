import type { ReactNode } from 'react';
import styles from './WarningStack.module.css';

interface WarningStackProps {
  children: ReactNode;
}

/**
 * Vertical column for the calendar's contextual warnings (exam clusters,
 * wellness, procrastination radar, lecture takeaway). Positioned by the
 * grid's bottom-center dock in CalendarPage so it never overlaps the app
 * Toaster at bottom-right.
 */
export function WarningStack({ children }: WarningStackProps) {
  return <div className={styles.stack} role="region" aria-label="Calendar warnings">{children}</div>;
}
