import type { ReactNode } from 'react';
import styles from './SectionLabel.module.css';

interface SectionLabelProps {
  children: ReactNode;
  right?: ReactNode;
}

export function SectionLabel({ children, right }: SectionLabelProps) {
  return (
    <div className={styles.wrapper}>
      <span className={styles.label}>{children}</span>
      {right}
    </div>
  );
}
