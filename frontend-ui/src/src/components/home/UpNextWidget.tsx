import { useMemo } from 'react';
import styles from './UpNextWidget.module.css';
import type { Event, Calendar } from '../../types';
import { TLDot } from '../shared/TLDot';
import { useModal } from '../../contexts/ModalContext';
import { isExamLike } from '../../lib/eventClassification';

interface UpNextWidgetProps {
  events: Event[];
  timelines: Calendar[];
}

interface TimelineExtras {
  is_course?: boolean;
}

function isDeadlineCandidate(ev: Event, tl: (Calendar & TimelineExtras) | undefined): boolean {
  if (isExamLike(ev.title)) return true;
  if (tl?.is_course) return true;
  return false;
}

export function UpNextWidget({ events, timelines }: UpNextWidgetProps) {
  const { openEventEditor } = useModal();

  const computed = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const filtered = events
      .filter(ev => {
        const start = new Date(ev.start_time);
        if (isNaN(start.getTime()) || start < now || start > cutoff) return false;
        const tl = timelines.find(t => t.id === ev.calendar_id) as (Calendar & TimelineExtras) | undefined;
        return isDeadlineCandidate(ev, tl);
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
      .slice(0, 5);
    return { upcoming: filtered, nowMs: now.getTime() };
  }, [events, timelines]);

  const { upcoming, nowMs } = computed;

  return (
    <section className={styles.widget}>
      <h2 className={styles.heading}>Up Next</h2>
      {upcoming.length === 0 ? (
        <p className={styles.empty}>Nothing pressing in the next two weeks.</p>
      ) : (
        <ul className={styles.list}>
          {upcoming.map(ev => {
            const start = new Date(ev.start_time);
            const tl = timelines.find(t => t.id === ev.calendar_id);
            const diffMs = start.getTime() - nowMs;
            const diffDays = diffMs / (1000 * 60 * 60 * 24);
            const isUrgent = diffDays <= 1;
            const chip = diffDays < 1
              ? `${Math.max(1, Math.ceil(diffMs / 3_600_000))}h`
              : diffDays < 7
                ? `${Math.ceil(diffDays)}d`
                : `${Math.ceil(diffDays / 7)}w`;
            return (
              <li key={ev.id}>
                <button
                  className={styles.row}
                  onClick={() => openEventEditor(ev)}
                  aria-label={`Open ${ev.title}`}
                >
                  <span className={`${styles.chip} ${isUrgent ? styles.chipUrgent : ''}`}>{chip}</span>
                  <TLDot color={tl?.color ?? '#6366F1'} size={7} />
                  <span className={styles.title}>{ev.title}</span>
                  <span className={styles.time}>
                    {start.toLocaleDateString([], { weekday: 'short' })}{' '}
                    {start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
