import styles from './WellnessToast.module.css';
import { Icon, Icons } from '../shared/Icon';
import type { ProcrastinationWarning } from '../../types';

interface ProcrastinationToastProps {
  warning: ProcrastinationWarning;
  onDismiss: () => void;
}

export function ProcrastinationToast({ warning, onDismiss }: ProcrastinationToastProps) {
  const title = warning.course_name || warning.title;

  return (
    <div className={styles.toast}>
      <span className={styles.icon}>⚠</span>
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        <div className={styles.message}>{warning.message}</div>
      </div>
      <button
        className={styles.dismiss}
        onClick={onDismiss}
        aria-label="Dismiss procrastination warning"
      >
        <Icon d={Icons.x} size={12} />
      </button>
    </div>
  );
}
