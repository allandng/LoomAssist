import styles from './WellnessToast.module.css';
import { IconButton, Icon, Icons } from '../ui';
import type { ProcrastinationWarning } from '../../types';

interface ProcrastinationToastProps {
  warning: ProcrastinationWarning;
  onDismiss: () => void;
}

export function ProcrastinationToast({ warning, onDismiss }: ProcrastinationToastProps) {
  const title = warning.course_name || warning.title;

  return (
    <div className={`${styles.toast} ${styles.warning}`} role="status">
      <span className={styles.icon} aria-hidden="true"><Icon d={Icons.alarm} size={14} /></span>
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        <div className={styles.message}>{warning.message}</div>
      </div>
      <IconButton size="sm" icon={Icons.x} label="Dismiss procrastination warning" onClick={onDismiss} />
    </div>
  );
}
