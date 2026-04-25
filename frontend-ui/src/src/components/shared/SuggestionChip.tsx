import type { ConflictSuggestion } from '../../types';

interface Props {
  suggestion: ConflictSuggestion;
  onClick: (suggestion: ConflictSuggestion) => void;
}

function formatRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return `${s.toLocaleString([], opts)} – ${e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function SuggestionChip({ suggestion, onClick }: Props) {
  return (
    <button
      onClick={() => onClick(suggestion)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 2,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-strong)',
        borderRadius: 8,
        padding: '7px 12px',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-strong)')}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>
        {formatRange(suggestion.start, suggestion.end)}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {suggestion.rationale}
      </span>
    </button>
  );
}
