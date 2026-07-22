import { useState } from 'react';
import styles from './WellnessToast.module.css';
import { Icon, Icons } from '../shared/Icon';

interface WellnessToastProps {
  message: string;
  date: string;
}

// WS7 #7 — per-warning dismissal persisted to sessionStorage (mirrors
// ExamClusterBanner) so the toast doesn't reappear when CalendarPage remounts.
const DISMISS_PREFIX = 'loom_wellness_dismissed:';

export function wellnessDismissKey(date: string, message: string): string {
  return `${date}|${message}`;
}

export function isWellnessDismissed(date: string, message: string): boolean {
  if (!message) return false;
  return sessionStorage.getItem(DISMISS_PREFIX + wellnessDismissKey(date, message)) === '1';
}

export function markWellnessDismissed(date: string, message: string): void {
  if (!message) return;
  sessionStorage.setItem(DISMISS_PREFIX + wellnessDismissKey(date, message), '1');
}

export function WellnessToast({ message, date }: WellnessToastProps) {
  const [dismissed, setDismissed] = useState(() => isWellnessDismissed(date, message));
  if (dismissed) return null;

  const dismiss = () => {
    markWellnessDismissed(date, message);
    setDismissed(true);
  };

  return (
    <div className={styles.toast}>
      <span className={styles.icon}>⚠</span>
      <div className={styles.body}>
        <div className={styles.title}>Busy day ahead — {date}</div>
        <div className={styles.message}>{message}</div>
      </div>
      <button
        className={styles.dismiss}
        onClick={dismiss}
        aria-label="Dismiss wellness warning"
      >
        <Icon d={Icons.x} size={12} />
      </button>
    </div>
  );
}
