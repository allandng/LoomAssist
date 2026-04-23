import { useState } from 'react';
import styles from './WellnessToast.module.css';
import { Icon, Icons } from '../shared/Icon';

interface WellnessToastProps {
  message: string;
  date: string;
}

export function WellnessToast({ message, date }: WellnessToastProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className={styles.toast}>
      <span className={styles.icon}>⚠</span>
      <div className={styles.body}>
        <div className={styles.title}>Busy day ahead — {date}</div>
        <div className={styles.message}>{message}</div>
      </div>
      <button
        className={styles.dismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss wellness warning"
      >
        <Icon d={Icons.x} size={12} />
      </button>
    </div>
  );
}
