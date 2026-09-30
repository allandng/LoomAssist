import { useMemo, useState } from 'react';
import styles from './courses.module.css';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Icon, Icons, Row, Skeleton, TLDot } from '../ui';
import type { Calendar, Course, Event } from '../../types';
import { fileBasename } from './courseUtils';
import { formatShortDate, formatTimeRange } from '../../lib/time';

interface Props {
  course: Course;
  timelines: Calendar[];
  /** All events; null while loading. */
  events: Event[] | null;
  eventsError: string | null;
  onReloadEvents: () => void;
  onScan: () => void;
  onEdit: () => void;
}

const MAX_EVENTS = 25;

export function SyllabusTab({ course, timelines, events, eventsError, onReloadEvents, onScan, onEdit }: Props) {
  const timeline = timelines.find(t => t.id === course.timeline_id) ?? null;
  // Frozen at mount: the past/upcoming split does not need to tick.
  const [now] = useState(() => Date.now());

  const linked = useMemo(() => {
    if (!events || course.timeline_id == null) return [];
    const mine = events
      .filter(e => e.calendar_id === course.timeline_id)
      .map(e => ({ event: e, past: new Date(e.end_time).getTime() < now }));
    const upcoming = mine.filter(x => !x.past).sort((a, b) => a.event.start_time.localeCompare(b.event.start_time));
    const past = mine.filter(x => x.past).sort((a, b) => b.event.start_time.localeCompare(a.event.start_time));
    return [...upcoming, ...past].slice(0, MAX_EVENTS);
  }, [events, course.timeline_id, now]);

  return (
    <div className={styles.tabStack}>
      <Card>
        <CardHeader
          compact
          title="Syllabus"
          description="Scan a PDF to pull due dates and class times into this course."
          actions={<Button variant="primary" icon={Icons.upload} onClick={onScan}>Scan syllabus</Button>}
        />
        <CardBody className={styles.rows}>
          <Row label="File" description={course.syllabus_path ? course.syllabus_path : 'No syllabus scanned yet.'} icon={Icons.file} divider={false}>
            {course.syllabus_path ? <Badge tone="success" icon={Icons.check}>{fileBasename(course.syllabus_path)}</Badge> : <Badge tone="neutral" outline>None</Badge>}
          </Row>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          compact
          title="Linked events"
          description={timeline ? <>Events on the <strong>{timeline.name}</strong> timeline</> : 'Pick a timeline for this course to see its events here.'}
          icon={timeline ? <TLDot color={timeline.color} size={10} /> : undefined}
          actions={!timeline ? <Button size="sm" variant="ghost" icon={Icons.pencil} onClick={onEdit}>Link timeline</Button> : undefined}
        />
        {!timeline ? (
          <EmptyState compact icon={Icons.calendar} title="No timeline linked" description="Choose one under Edit and this course’s classes and deadlines show up here." />
        ) : eventsError ? (
          <div className={styles.errorRow}>
            <Badge tone="error" dot>{eventsError}</Badge>
            <Button size="sm" variant="subtle" onClick={onReloadEvents}>Retry</Button>
          </div>
        ) : events === null ? (
          <div aria-busy="true">
            {[0, 1, 2].map(i => (
              <div key={i} className={styles.eventRow}>
                <Skeleton width={8} height={8} radius={4} />
                <Skeleton width="50%" height={13} />
                <Skeleton width={120} height={11} />
              </div>
            ))}
          </div>
        ) : linked.length === 0 ? (
          <EmptyState compact icon={Icons.calendar} title="No events on this timeline yet" description="Scan the syllabus or add events on the calendar." />
        ) : (
          <ul className={styles.eventList}>
            {linked.map(({ event: e, past }) => {
              return (
                <li key={e.id} className={[styles.eventRow, past ? styles.eventPast : ''].join(' ')}>
                  <TLDot color={timeline.color} size={8} />
                  <span className={styles.eventTitle}>{e.title}</span>
                  {e.is_recurring && <Icon d={Icons.repeat} size={12} className={styles.linkedIcon} aria-label="Repeats" />}
                  <time className={[styles.eventTime, styles.mono].join(' ')} dateTime={e.start_time}>
                    {e.is_all_day ? formatShortDate(e.start_time) : `${formatShortDate(e.start_time)} · ${formatTimeRange(e.start_time, e.end_time)}`}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
