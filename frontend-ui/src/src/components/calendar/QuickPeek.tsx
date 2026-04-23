import { useEffect, useRef, useState } from 'react';
import styles from './QuickPeek.module.css';
import { Icon, Icons } from '../shared/Icon';
import { TLDot } from '../shared/TLDot';
import type { Event, Calendar } from '../../types';
import { parseChecklist, renderDescription } from '../../lib/eventUtils';

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
  const color = timeline?.color ?? '#6366F1';
  const checklist = parseChecklist(event.checklist);
  const done = checklist.filter(c => c.done).length;

  const startDT = new Date(event.start_time);
  const endDT   = new Date(event.end_time);
  const datePart = startDT.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timePart = event.is_all_day
    ? 'All day'
    : `${startDT.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${endDT.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

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

      {event.description && (
        <div
          className={styles.desc}
          dangerouslySetInnerHTML={{ __html: renderDescription(event.description) }}
        />
      )}

      {checklist.length > 0 && (
        <>
          <div className={styles.checklistHeader}>
            CHECKLIST · {done} / {checklist.length}
          </div>
          {checklist.slice(0, 5).map((item, i) => (
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
          ))}
          {checklist.length > 5 && (
            <div className={styles.checkMore}>+{checklist.length - 5} more</div>
          )}
        </>
      )}
    </div>
  );
}
