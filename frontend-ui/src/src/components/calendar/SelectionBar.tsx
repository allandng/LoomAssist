import { createPortal } from 'react-dom';
import styles from './SelectionBar.module.css';

interface SelectionBarProps {
  count: number;
  onDelete: () => void;
  onSnoozeDay: () => void;
  onSnoozeWeek: () => void;
  onClear: () => void;
}

/**
 * WS3 #7 — contextual action bar for multi-selected events. Fixed bottom-center;
 * appears whenever one or more event occurrences are selected. Wires to the
 * existing bulk-delete / snooze handlers on CalendarPage.
 */
export function SelectionBar({ count, onDelete, onSnoozeDay, onSnoozeWeek, onClear }: SelectionBarProps) {
  if (count < 1) return null;
  return createPortal(
    <div className={styles.bar} role="toolbar" aria-label={`${count} event${count === 1 ? '' : 's'} selected`}>
      <span className={styles.count}>{count} selected</span>
      <span className={styles.sep} aria-hidden="true">·</span>
      <button type="button" className={`${styles.action} ${styles.destructive}`} onClick={onDelete}>
        Delete
      </button>
      <button type="button" className={styles.action} onClick={onSnoozeDay}>
        Snooze +1d
      </button>
      <button type="button" className={styles.action} onClick={onSnoozeWeek}>
        Snooze +1w
      </button>
      <span className={styles.sep} aria-hidden="true">·</span>
      <button type="button" className={styles.clear} onClick={onClear}>
        <span className={styles.kbd}>Esc</span> to clear
      </button>
    </div>,
    document.body,
  );
}
