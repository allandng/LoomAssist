import { useEffect, useRef, useState } from 'react';
import styles from './QuickPeek.module.css';
import { Icon, Icons } from '../shared/Icon';
import { TLDot } from '../shared/TLDot';
import { SourceBadge } from '../shared/SourceBadge';
import type { Event, Calendar } from '../../types';
import { parseChecklist, renderDescription } from '../../lib/eventUtils';
import { DEFAULT_TIMELINE_COLOR } from '../../lib/colors';

interface QuickPeekProps {
  event: Event;
  timelines: Calendar[];
  anchorX: number;
  anchorY: number;
}

const OFFSET = 12;

export function QuickPeek({ event, timelines, anchorX, anchorY }: QuickPeekProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: anchorY + OFFSET, left: anchorX + OFFSET });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = anchorX + OFFSET;
    let top  = anchorY + OFFSET;
    if (left + rect.width > window.innerWidth - 8) left = anchorX - rect.width - OFFSET;
    if (top  + rect.height > window.innerHeight - 8) top = anchorY - rect.height - OFFSET;
    setPos({ top, left });
  }, [anchorX, anchorY]);

  const timeline = timelines.find(t => t.id === event.calendar_id);
  const color = timeline?.color ?? DEFAULT_TIMELINE_COLOR;
  const checklist = parseChecklist(event.checklist);
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

  return (
    <div
      ref={ref}
      className={styles.peek}
      style={{ top: pos.top, left: pos.left }}
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

      {(() => {
        if (checklist.length === 0) return null;
        const readings = checklist.filter(c => c.isReading);
        const tasks    = checklist.filter(c => !c.isReading);
        const renderItem = (item: typeof checklist[number], i: number) => (
          <div key={i} className={`${styles.checkItem} ${item.done ? styles.checkItemDone : ''}`}>
            <span
              className={styles.checkBox}
              style={{
                borderColor: item.done ? 'var(--text-dim)' : 'var(--border-strong)',
                background: item.done ? 'var(--text-dim)' : 'transparent',
              }}
            >
              {item.done && <Icon d={Icons.check} size={8} stroke="var(--bg-main)" strokeWidth={3} />}
            </span>
            {item.text}
          </div>
        );
        return (
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
        );
      })()}

      <SourceBadge
        connectionCalendarId={event.connection_calendar_id}
        lastSyncedAt={event.last_synced_at}
      />
    </div>
  );
}
