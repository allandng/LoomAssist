import styles from './InboxItemRow.module.css';
import { Badge, Button, IconButton, Icons } from '../ui';
import type { InboxItem } from '../../types';
import { effectiveProposal, type InboxProposal } from './useInbox';
import { formatProposal, relativeTime } from './timeFormat';

export interface InboxItemRowProps {
  item: InboxItem;
  proposal?: InboxProposal;
  proposing?: boolean;
  busy?: boolean;
  /** Dense layout for the quick-capture panel. */
  compact?: boolean;
  onPropose: (item: InboxItem) => void;
  onSchedule: (item: InboxItem) => void;
  /** Open the event editor pre-filled with the proposal so the user can adjust it. */
  onEdit: (item: InboxItem) => void;
  onOpenEvent: (item: InboxItem) => void;
  onArchive: (item: InboxItem) => void;
  /** Bring an archived item back to the open list (page only). */
  onRestore?: (item: InboxItem) => void;
}

/** One captured thought: text, capture time, proposal / scheduled state and actions. */
export function InboxItemRow({ item, proposal, proposing, busy, compact, onPropose, onSchedule, onEdit, onOpenEvent, onArchive, onRestore }: InboxItemRowProps) {
  const p = effectiveProposal(item, proposal);
  const scheduled = item.scheduled_event_id != null;
  const archived = item.archived && !scheduled;

  return (
    <li className={[styles.row, compact ? styles.compact : '', archived ? styles.archived : ''].join(' ')}>
      <div className={styles.main}>
        <p className={styles.text}>{item.text}</p>
        <div className={styles.meta}>
          <span className={styles.captured}>Captured {relativeTime(item.created_at)}</span>
          {scheduled && <Badge tone="success" size="sm" icon={Icons.checkCircle}>Scheduled</Badge>}
          {!scheduled && p.start && (
            <Badge tone="accent" size="sm" icon={Icons.sparkles} title={p.rationale || undefined}>
              Proposed: {formatProposal(p.start)}
            </Badge>
          )}
          {archived && <Badge tone="neutral" size="sm" icon={Icons.archive}>Archived</Badge>}
        </div>
        {!compact && p.rationale && !scheduled && (
          <p className={styles.rationale}>{p.rationale}</p>
        )}
      </div>

      <div className={styles.actions}>
        {scheduled ? (
          <Button size="sm" variant="ghost" icon={Icons.calendar} onClick={() => onOpenEvent(item)}>Open event</Button>
        ) : archived ? (
          onRestore && (
            <Button size="sm" variant="ghost" icon={Icons.reset} loading={busy} onClick={() => onRestore(item)}>Restore</Button>
          )
        ) : p.start ? (
          <>
            <Button size="sm" variant="primary" icon={Icons.check} loading={busy} onClick={() => onSchedule(item)}>Schedule</Button>
            <Button size="sm" variant="ghost" icon={Icons.pencil} onClick={() => onEdit(item)}>Adjust</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" icon={Icons.sparkles} loading={proposing} onClick={() => onPropose(item)}>
            Propose time
          </Button>
        )}
        {!archived && !scheduled && (
          <IconButton size="sm" icon={Icons.archive} label="Archive" disabled={busy} onClick={() => onArchive(item)} />
        )}
      </div>
    </li>
  );
}
