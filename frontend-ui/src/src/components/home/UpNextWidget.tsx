import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './UpNextWidget.module.css';
import type { Event, Calendar } from '../../types';
import { Card, CardHeader, CardBody, Button, Badge, EmptyState, Skeleton, TLDot, Icons } from '../ui';
import { useModal } from '../../contexts/ModalContext';
import { DEFAULT_TIMELINE_COLOR } from '../../lib/colors';
import { upcomingOccurrences } from './homeStats';
import { todayISO, isoDate, addDays } from '../tasks/taskUtils';

interface UpNextWidgetProps {
  events: Event[];
  timelines: Calendar[];
  loading?: boolean;
}

const WINDOW_DAYS = 7;
const LIMIT = 6;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function UpNextWidget({ events, timelines, loading }: UpNextWidgetProps) {
  const navigate = useNavigate();
  const { openEventEditor } = useModal();

  const upcoming = useMemo(
    () => upcomingOccurrences(events, timelines, new Date(), { withinDays: WINDOW_DAYS, limit: LIMIT }),
    [events, timelines],
  );

  const now = new Date();
  const today = todayISO();
  const tomorrow = isoDate(addDays(now, 1));
  const nowMs = now.getTime();

  return (
    <Card flush>
      <CardHeader
        title="Up next"
        description={`Next ${WINDOW_DAYS} days`}
        actions={
          <Button size="sm" variant="subtle" iconRight={Icons.arrowRight} onClick={() => navigate('/calendar')}>
            Open calendar
          </Button>
        }
      />
      <CardBody>
        {loading ? (
          <div className={styles.list} aria-hidden="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className={styles.skeletonRow}>
                <Skeleton width="80%" height={12} />
                <Skeleton width={8} height={8} radius={99} />
                <Skeleton width="60%" height={12} />
              </div>
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <div className={styles.emptyWrap}>
            <EmptyState
              compact
              icon={Icons.calendar}
              title="Nothing scheduled"
              description="The next seven days are clear. Add an event to plan ahead."
              action={{ label: 'New event', kbd: 'N', onClick: () => openEventEditor() }}
            />
          </div>
        ) : (
          <ul className={styles.list}>
            {upcoming.map(o => {
              const tl = timelines.find(t => t.id === o.event.calendar_id);
              const dayLabel = o.date === today
                ? 'Today'
                : o.date === tomorrow
                  ? 'Tomorrow'
                  : o.start.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
              const timeLabel = o.allDay
                ? 'All day'
                : o.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
              const isNow = !o.allDay && o.start.getTime() <= nowMs;
              const location = o.event.location?.trim();
              const prep = o.event.prep_minutes ?? 0;
              return (
                <li key={o.key}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => openEventEditor(o.event, undefined, o.instanceDate)}
                    aria-label={`${o.event.title}, ${dayLabel} ${timeLabel}. Open event`}
                  >
                    <span className={styles.when}>
                      <span className={styles.day}>{dayLabel}</span>
                      <span className={styles.time}>{timeLabel}</span>
                    </span>
                    <TLDot color={tl?.color ?? DEFAULT_TIMELINE_COLOR} size={8} />
                    <span className={styles.title}>{o.event.title}</span>
                    <span className={styles.badges}>
                      {isNow && <Badge tone="accent" size="sm" dot>Now</Badge>}
                      {location && (
                        <Badge size="sm" icon={Icons.mapPin} title={location}>{truncate(location, 18)}</Badge>
                      )}
                      {prep > 0 && (
                        <Badge size="sm" tone="info" icon={Icons.clock}>{prep} min prep</Badge>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
