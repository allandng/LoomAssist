import { useState, useEffect } from 'react';
import styles from './FocusSidebar.module.css';
import { Icon, Icons } from '../shared/Icon';
import { TLDot } from '../shared/TLDot';
import { Chip } from '../shared/Chip';
import { SectionLabel } from '../shared/SectionLabel';
import { listEvents, listCalendars } from '../../api';
import type { Event, Calendar, Task } from '../../types';
import { timelineColor } from '../../lib/eventUtils';

const PINNED_KEY = 'loom:focus:pinned';

function readPinned(): number[] {
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]'); } catch { return []; }
}

interface FocusSidebarProps {
  tasks: Task[];
  onlyIncomplete: boolean;
  onToggleOnlyIncomplete: () => void;
}

export function FocusSidebar({ tasks, onlyIncomplete, onToggleOnlyIncomplete }: FocusSidebarProps) {
  const [upNext, setUpNext] = useState<Array<Event & { color: string; isNow: boolean }>>([]);
  const [pinnedIds, setPinnedIds] = useState<number[]>(readPinned);

  useEffect(() => {
    Promise.all([listEvents(), listCalendars()]).then(([events, cals]) => {
      const now = Date.now();
      const upcoming = events
        .filter(e => !e.is_all_day)
        .map(e => ({
          ...e,
          color: timelineColor(cals, e.calendar_id),
          isNow: new Date(e.start_time).getTime() <= now && new Date(e.end_time).getTime() > now,
        }))
        .filter(e => new Date(e.end_time).getTime() > now)
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
        .slice(0, 4);
      setUpNext(upcoming);
    }).catch(() => {});
  }, []);

  const pinnedTasks = tasks.filter(t => pinnedIds.includes(t.id));

  function togglePin(id: number) {
    setPinnedIds(prev => {
      const next = prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id];
      localStorage.setItem(PINNED_KEY, JSON.stringify(next));
      return next;
    });
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Focus</span>
      </div>

      <div className={styles.scroll}>
        <SectionLabel right={<span className={styles.todayLabel}>TODAY</span>}>
          Up next
        </SectionLabel>
        <div className={styles.upNextList}>
          {upNext.map(e => (
            <div key={e.id} className={`${styles.upNextCard} ${e.isNow ? styles.upNextNow : ''}`}>
              <TLDot color={e.color} size={8} />
              <div className={styles.upNextBody}>
                <div className={styles.upNextTitle}>{e.title}</div>
                <div className={styles.upNextTime}>
                  {new Date(e.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              {e.isNow && <Chip color="var(--accent)">NOW</Chip>}
            </div>
          ))}
        </div>

        {pinnedTasks.length > 0 && (
          <>
            <SectionLabel>Pinned tasks</SectionLabel>
            <div className={styles.pinnedList}>
              {pinnedTasks.map(t => (
                <div key={t.id} className={styles.pinnedItem}>
                  <Icon d={Icons.pin} size={12} className={styles.pinIcon} />
                  <span className={styles.pinnedTitle}>{t.note || `Task #${t.id}`}</span>
                  <button className={styles.unpinBtn} onClick={() => togglePin(t.id)}>
                    <Icon d={Icons.x} size={10} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className={styles.footer}>
        <button
          className={`${styles.filterToggle} ${onlyIncomplete ? styles.filterToggleOn : ''}`}
          onClick={onToggleOnlyIncomplete}
        >
          <div className={styles.filterCheckbox}
            style={{ borderColor: onlyIncomplete ? 'var(--accent)' : 'var(--border-strong)', background: onlyIncomplete ? 'var(--accent-soft)' : 'transparent' }}
          />
          <span>Only incomplete</span>
        </button>
      </div>
    </div>
  );
}
