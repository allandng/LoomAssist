import type { ReactNode } from 'react';
import styles from './WarningStack.module.css';

interface WarningStackProps {
  children: ReactNode;
}

export function WarningStack({ children }: WarningStackProps) {
  return <div className={styles.stack}>{children}</div>;
}
