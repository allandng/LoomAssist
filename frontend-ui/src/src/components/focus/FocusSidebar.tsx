import { useEffect, useMemo, useState } from 'react';
import styles from './FocusSidebar.module.css';
import type { Event, Task, Calendar } from '../../types';
import { Section, Badge, EmptyState, IconButton, Switch, TLDot, Icons } from '../ui';
import { useModal } from '../../contexts/ModalContext';
import { timelineColor } from '../../lib/eventUtils';
import { upcomingOccurrences } from '../home/homeStats';
import { taskColor, taskTitle } from '../tasks/taskUtils';
import { doneTodayCount, getPinnedIds, togglePinned, useFocusVersion } from './focusStore';

const UP_NEXT_LIMIT = 5;
const CLOCK_TICK_MS = 60_000;

interface FocusSidebarProps {
  tasks: Task[];
  events: Event[];
  timelines: Calendar[];
  onlyIncomplete: boolean;
  onToggleOnlyIncomplete: () => void;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Left panel of the Focus page: what is left on today's calendar, the tasks
 * pinned from the board, and the "done today" count (tasks completed today,
 * not every completed task).
 */
export function FocusSidebar({ tasks, events, timelines, onlyIncomplete, onToggleOnlyIncomplete }: FocusSidebarProps) {
  const { openEventEditor } = useModal();
  const focusVersion = useFocusVersion();

  // Re-evaluate "now" once a minute so finished events drop off the list.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps -- tick drives the refresh

  const upNext = useMemo(
    () => upcomingOccurrences(events, timelines, now, { sameDayOnly: true, limit: UP_NEXT_LIMIT }),
    [events, timelines, now],
  );

  const pinnedTasks = useMemo(() => {
    const ids = getPinnedIds();
    return ids.map(id => tasks.find(t => t.id === id)).filter((t): t is Task => !!t);
  }, [tasks, focusVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- store read keyed on its version

  const doneToday = useMemo(() => doneTodayCount(tasks), [tasks, focusVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- store read keyed on its version

  return (
    <div className={styles.side}>
      <div className={styles.scroll}>
        <Section small title="Up next" actions={<Badge size="sm" outline>Today</Badge>}>
          {upNext.length === 0 ? (
            <EmptyState
              compact
              icon={Icons.calendar}
              title="Nothing left today"
              description="Your schedule is clear for the rest of the day."
            />
          ) : (
            <ul className={styles.list}>
              {upNext.map(o => {
                const isNow = !o.allDay && o.start.getTime() <= now.getTime();
                const color = timelineColor(timelines, o.event.calendar_id);
                const time = o.allDay ? 'All day' : `${fmtTime(o.start)}${o.end ? ` – ${fmtTime(o.end)}` : ''}`;
                return (
                  <li key={o.key}>
                    <button
                      type="button"
                      className={[styles.eventRow, isNow ? styles.eventNow : ''].join(' ')}
                      onClick={() => openEventEditor(o.event, undefined, o.instanceDate)}
                      aria-label={`${o.event.title}, ${time}. Open event`}
                    >
                      <TLDot color={color} size={8} />
                      <span className={styles.eventText}>
                        <span className={styles.eventTitle}>{o.event.title}</span>
                        <span className={styles.eventTime}>{time}</span>
                      </span>
                      {isNow && <Badge size="sm" tone="accent" dot>Now</Badge>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section small title="Pinned" actions={pinnedTasks.length ? <Badge size="sm">{pinnedTasks.length}</Badge> : undefined}>
          {pinnedTasks.length === 0 ? (
            <p className={styles.hint}>Pin a task from the board to keep it in view here.</p>
          ) : (
            <ul className={styles.list}>
              {pinnedTasks.map(t => {
                const color = taskColor(t, events, timelines);
                return (
                  <li key={t.id} className={[styles.pinRow, t.is_complete ? styles.pinDone : ''].join(' ')}>
                    <TLDot color={color ?? 'var(--text-dim)'} size={7} />
                    <span className={styles.pinTitle}>{taskTitle(t)}</span>
                    <IconButton size="sm" icon={Icons.pin} active label={`Unpin ${taskTitle(t)}`} onClick={() => togglePinned(t.id)} />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>

      <div className={styles.footer}>
        <div className={styles.doneRow}>
          <span className={styles.doneLabel}>Done today</span>
          <Badge tone={doneToday > 0 ? 'success' : 'neutral'}>{doneToday}</Badge>
        </div>
        <Switch size="sm" label="Only incomplete" checked={onlyIncomplete} onChange={onToggleOnlyIncomplete} />
      </div>
    </div>
  );
}
