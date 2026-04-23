import type { ReactNode } from 'react';
import styles from './Kbd.module.css';

interface KbdProps {
  children: ReactNode;
  small?: boolean;
}

export function Kbd({ children, small }: KbdProps) {
  return (
    <kbd className={small ? `${styles.kbd} ${styles.small}` : styles.kbd}>
      {children}
    </kbd>
  );
}
