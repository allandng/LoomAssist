import styles from './journal.module.css';
import { Icon } from '../ui';
import { MOODS, type Mood } from './moods';

interface Props {
  value: Mood | null;
  onChange: (next: Mood | null) => void;
  disabled?: boolean;
}

/** Three large selectable mood cards (radio semantics; click again to clear). */
export function MoodPicker({ value, onChange, disabled }: Props) {
  return (
    <div className={styles.moodGrid} role="radiogroup" aria-label="How are you feeling?">
      {MOODS.map(m => {
        const active = value === m.value;
        return (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            className={[styles.moodCard, active ? styles.moodCardActive : '', styles[`mood_${m.value}`]].join(' ')}
            onClick={() => onChange(active ? null : m.value)}
          >
            <span className={styles.moodIcon} aria-hidden="true"><Icon d={m.icon} size={22} strokeWidth={1.6} /></span>
            <span className={styles.moodLabel}>{m.label}</span>
            <span className={styles.moodHint}>{m.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
