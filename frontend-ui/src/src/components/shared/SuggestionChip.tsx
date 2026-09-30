import type { ConflictSuggestion } from '../../types';
import styles from './SuggestionChip.module.css';
import { Icon, Icons } from './Icon';

interface Props {
  suggestion: ConflictSuggestion;
  onClick: (suggestion: ConflictSuggestion) => void;
  disabled?: boolean;
}

function formatRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return `${s.toLocaleString([], opts)} – ${e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** One proposed alternative slot. Click applies it. */
export function SuggestionChip({ suggestion, onClick, disabled }: Props) {
  return (
    <button type="button" className={styles.chip} onClick={() => onClick(suggestion)} disabled={disabled}>
      <span className={styles.icon}><Icon d={Icons.clock} size={13} /></span>
      <span className={styles.text}>
        <span className={styles.range}>{formatRange(suggestion.start, suggestion.end)}</span>
        {suggestion.rationale && <span className={styles.rationale}>{suggestion.rationale}</span>}
      </span>
      <span className={styles.arrow}><Icon d={Icons.arrowRight} size={13} /></span>
    </button>
  );
}
