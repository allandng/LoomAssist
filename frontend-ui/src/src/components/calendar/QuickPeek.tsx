import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './QuickPeek.module.css';
import { Icon, Icons } from '../shared/Icon';
import { TLDot } from '../shared/TLDot';
import { SourceBadge } from '../shared/SourceBadge';
import type { Event, Calendar } from '../../types';
import { parseChecklist, renderDescription } from '../../lib/eventUtils';
import { DEFAULT_TIMELINE_COLOR } from '../../lib/colors';
import { pushEscapeHandler } from '../../lib/escapeStack';

interface QuickPeekProps {
  event: Event;
  timelines: Calendar[];
  anchorX: number;
  anchorY: number;
  /** WS5 #1 — a single-click pins an interactive peek (action row + toggles). */
  pinned?: boolean;
  /** Move focus into the card only when opened from the keyboard (APG non-modal dialog). */
  keyboardOpen?: boolean;
  onClose?: () => void;
  onEdit?: (event: Event) => void;
  onDuplicate?: (event: Event) => void;
  onDelete?: (event: Event) => void;
  onChecklistToggle?: (index: number) => void;
  /** Hover-mode grace: keep the passive peek alive while the cursor is over it. */
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
}

const OFFSET = 12;

export function QuickPeek({
  event,
  timelines,
  anchorX,
  anchorY,
  pinned = false,
  keyboardOpen = false,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
  onChecklistToggle,
  onHoverEnter,
  onHoverLeave,
}: QuickPeekProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: anchorY + OFFSET, left: anchorX + OFFSET });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = anchorX + OFFSET;
    let top  = anchorY + OFFSET;
    if (left + rect.width > window.innerWidth - 8) left = anchorX - rect.width - OFFSET;
    if (left < 8) left = 8;
    if (top  + rect.height > window.innerHeight - 8) top = anchorY - rect.height - OFFSET;
    if (top < 8) top = 8;
    setPos({ top, left });
  }, [anchorX, anchorY]);

  // Pinned peek is a non-modal dialog: Esc through the shared stack (only the
  // top layer), click-outside closes, focus enters on keyboard-open only.
  useEffect(() => {
    if (!pinned) return;
    if (keyboardOpen) ref.current?.focus();

    const popEscape = pushEscapeHandler(() => { onClose?.(); });

    function onDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      // Clicks on an event pill are owned by the calendar's click handler
      // (it re-pins / toggles the peek) — don't double-close here.
      if (target.closest('.fc-event')) return;
      onClose?.();
    }
    // Defer so the same click that pinned the peek doesn't immediately close it.
    const id = setTimeout(() => window.addEventListener('pointerdown', onDown, true), 0);

    return () => {
      popEscape();
      clearTimeout(id);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [pinned, keyboardOpen, onClose]);

  const timeline = timelines.find(t => t.id === event.calendar_id);
  const color = timeline?.color ?? DEFAULT_TIMELINE_COLOR;
  const checklist = parseChecklist(event.checklist).map((c, idx) => ({ ...c, __idx: idx }));
  const done = checklist.filter(c => c.done).length;

  const startDT = new Date(event.start_time);
  const endDT   = new Date(event.end_time);
  const datePart = startDT.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timePart = event.is_all_day
    ? 'All day'
    : `${startDT.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${endDT.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  // Clock-in tracking summary
  let trackedRow: string | null = null;
  if (event.actual_start) {
    const actStart = new Date(event.actual_start);
    const actEnd   = event.actual_end ? new Date(event.actual_end) : new Date();
    const actualMin = Math.max(0, Math.round((actEnd.getTime() - actStart.getTime()) / 60_000));
    const plannedMin = Math.max(1, Math.round((endDT.getTime() - startDT.getTime()) / 60_000));
    const live = event.actual_end ? '' : ' (live)';
    trackedRow = `Tracked: ${actualMin}m vs. planned ${plannedMin}m${live}`;
  }

  const renderItem = (item: typeof checklist[number]) => {
    const box = (
      <span
        className={styles.checkBox}
        style={{
          borderColor: item.done ? 'var(--text-dim)' : 'var(--border-strong)',
          background: item.done ? 'var(--text-dim)' : 'transparent',
        }}
      >
        {item.done && <Icon d={Icons.check} size={8} stroke="var(--bg-main)" strokeWidth={3} />}
      </span>
    );
    return (
      <div key={item.__idx} className={`${styles.checkItem} ${item.done ? styles.checkItemDone : ''}`}>
        {pinned && onChecklistToggle ? (
          <button
            type="button"
            className={styles.checkToggle}
            onClick={() => onChecklistToggle(item.__idx)}
            aria-pressed={item.done}
            aria-label={`Toggle "${item.text}"`}
          >
            {box}
          </button>
        ) : box}
        {item.text}
      </div>
    );
  };

  const readings = checklist.filter(c => c.isReading);
  const tasks    = checklist.filter(c => !c.isReading);

  return (
    <div
      ref={ref}
      className={`${styles.peek} ${pinned ? styles.peekPinned : ''}`}
      style={{ top: pos.top, left: pos.left }}
      role={pinned ? 'dialog' : undefined}
      aria-label={pinned ? event.title : undefined}
      tabIndex={pinned ? -1 : undefined}
      onMouseEnter={!pinned ? onHoverEnter : undefined}
      onMouseLeave={!pinned ? onHoverLeave : undefined}
    >
      <div className={styles.meta}>
        <TLDot color={color} size={7} />
        <span className={styles.tlName}>{timeline?.name?.toUpperCase() ?? '—'}</span>
      </div>
      <div className={styles.title}>{event.title}</div>
      <div className={styles.time}>{datePart} · {timePart}</div>

      {event.location && (
        <div className={styles.metaRow}>
          <Icon d={Icons.pin} size={11} stroke="var(--text-muted)" />
          <span>{event.location}</span>
        </div>
      )}

      {event.travel_time_minutes && event.travel_time_minutes > 0 ? (
        <div className={styles.metaRow}>
          <Icon d={Icons.clock} size={11} stroke="var(--text-muted)" />
          <span>{event.travel_time_minutes} min travel buffer</span>
        </div>
      ) : null}

      {event.event_type === 'lecture' && event.prep_minutes && event.prep_minutes > 0 ? (
        <div className={styles.metaRow}>
          <Icon d={Icons.clock} size={11} stroke="var(--text-muted)" />
          <span>{event.prep_minutes} min prep buffer</span>
        </div>
      ) : null}

      {trackedRow && (
        <div className={styles.metaRow}>
          <Icon d={Icons.clock} size={11} stroke="var(--text-muted)" />
          <span>{trackedRow}</span>
        </div>
      )}

      {event.description && (
        <div
          className={styles.desc}
          dangerouslySetInnerHTML={{ __html: renderDescription(event.description) }}
        />
      )}

      {checklist.length > 0 && (
        <>
          {readings.length > 0 && (
            <>
              <div className={styles.checklistHeader}>
                READINGS · {readings.filter(r => r.done).length} / {readings.length}
              </div>
              {readings.slice(0, 5).map(renderItem)}
              {readings.length > 5 && <div className={styles.checkMore}>+{readings.length - 5} more</div>}
            </>
          )}
          {tasks.length > 0 && (
            <>
              <div className={styles.checklistHeader}>
                CHECKLIST · {done} / {checklist.length}
              </div>
              {tasks.slice(0, 5).map(renderItem)}
              {tasks.length > 5 && <div className={styles.checkMore}>+{tasks.length - 5} more</div>}
            </>
          )}
        </>
      )}

      <SourceBadge
        connectionCalendarId={event.connection_calendar_id}
        lastSyncedAt={event.last_synced_at}
      />

      {/* Action row — last in DOM so the content reading order is preserved, but
          absolutely positioned top-right (WS5 #1). */}
      {pinned && (
        <div className={styles.actions}>
          <button type="button" className={styles.actionBtn} onClick={() => onEdit?.(event)} aria-label="Edit event" title="Edit">
            <Icon d={Icons.pencil} size={13} />
          </button>
          <button type="button" className={styles.actionBtn} onClick={() => onDuplicate?.(event)} aria-label="Duplicate event" title="Duplicate">
            <Icon d={Icons.copy} size={13} />
          </button>
          <button type="button" className={styles.actionBtn} onClick={() => onDelete?.(event)} aria-label="Delete event" title="Delete">
            <Icon d={Icons.trash} size={13} />
          </button>
          <button type="button" className={styles.actionBtn} onClick={() => onClose?.()} aria-label="Close" title="Close">
            <Icon d={Icons.x} size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
