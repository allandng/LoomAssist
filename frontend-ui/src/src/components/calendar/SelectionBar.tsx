import styles from './SelectionBar.module.css';
import { Button, Kbd } from '../ui';

interface SelectionBarProps {
  count: number;
  onDelete: () => void;
  onSnoozeDay: () => void;
  onSnoozeWeek: () => void;
  onClear: () => void;
}

/**
 * Contextual action bar for multi-selected events. Rendered inside the grid's
 * bottom-center dock (see CalendarPage) whenever one or more occurrences are
 * selected; wires to the bulk-delete / snooze handlers on CalendarPage.
 */
export function SelectionBar({ count, onDelete, onSnoozeDay, onSnoozeWeek, onClear }: SelectionBarProps) {
  if (count < 1) return null;
  return (
    <div className={styles.bar} role="toolbar" aria-label={`${count} event${count === 1 ? '' : 's'} selected`}>
      <span className={styles.count}>{count} selected</span>
      <span className={styles.sep} aria-hidden="true" />
      <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button>
      <Button size="sm" variant="ghost" onClick={onSnoozeDay}>Snooze +1d</Button>
      <Button size="sm" variant="ghost" onClick={onSnoozeWeek}>Snooze +1w</Button>
      <span className={styles.sep} aria-hidden="true" />
      <Button size="sm" variant="subtle" onClick={onClear}>
        <Kbd small>Esc</Kbd> Clear
      </Button>
    </div>
  );
}
