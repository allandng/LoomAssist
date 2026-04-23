import { useCallback } from 'react';
import styles from './ListView.module.css';
import { Icon, Icons } from '../shared/Icon';
import { TLDot } from '../shared/TLDot';
import type { Task, Calendar } from '../../types';
import { updateTask } from '../../api';
import { timelineColor } from '../../lib/eventUtils';

type GroupKey = 'doing' | 'backlog' | 'done';

const GROUPS: { key: GroupKey; title: string; color: string }[] = [
  { key: 'doing',   title: 'In Progress', color: 'var(--accent)' },
  { key: 'backlog', title: 'Backlog',     color: 'var(--text-dim)' },
  { key: 'done',    title: 'Done',        color: 'var(--success)' },
];

const PRIORITY_COLOR: Record<string, string> = {
  high: 'var(--error)', med: 'var(--warning)', low: 'var(--text-dim)',
};

interface ListViewProps {
  tasks: Task[];
  timelines: Calendar[];
  activeTaskId: number | null;
  onReload: () => void;
}

export function ListView({ tasks, timelines, activeTaskId, onReload }: ListViewProps) {
  const today = new Date().toISOString().split('T')[0];

  const handleToggle = useCallback(async (task: Task) => {
    await updateTask(task.id, { is_complete: !task.is_complete, status: task.is_complete ? 'backlog' : 'done' });
    onReload();
  }, [onReload]);

  return (
    <div className={styles.wrap}>
      <div className={styles.table}>
        <div className={styles.addRow}>
          <Icon d={Icons.plus} size={13} className={styles.addIcon} />
          <span>Add task</span>
        </div>

        {GROUPS.map((g, gi) => {
          const items = tasks.filter(t => t.status === g.key);
          if (items.length === 0) return null;
          return (
            <div key={g.key}>
              <div className={`${styles.groupHeader} ${gi > 0 ? styles.groupHeaderBorder : ''}`}>
                <Icon d={Icons.chevronDown} size={11} />
                <TLDot color={g.color} size={6} />
                <span>{g.title}</span>
                <span className={styles.groupCount}>· {items.length}</span>
              </div>

              {items.map((task, i) => {
                const isActive = task.id === activeTaskId;
                const tlColor = timelineColor(timelines, task.event_id);
                return (
                  <div
                    key={task.id}
                    className={`${styles.row} ${isActive ? styles.rowActive : ''} ${task.is_complete ? styles.rowDone : ''} ${i < items.length - 1 ? styles.rowBorder : ''}`}
                  >
                    <button
                      className={styles.checkbox}
                      style={{
                        borderColor: task.is_complete ? 'var(--success)' : 'var(--border-strong)',
                        background: task.is_complete ? 'var(--success)' : 'transparent',
                      }}
                      onClick={() => handleToggle(task)}
                    >
                      {task.is_complete && <Icon d={Icons.check} size={10} stroke="#0B1120" strokeWidth={3} />}
                    </button>

                    {task.priority && !task.is_complete && (
                      <span
                        className={styles.priorityDot}
                        style={{ background: PRIORITY_COLOR[task.priority] ?? 'var(--text-dim)' }}
                      />
                    )}

                    <span className={styles.rowTitle}>{task.note || `Task #${task.id}`}</span>

                    <span className={styles.tlBadge} style={{ color: tlColor, background: `${tlColor}1e` }}>
                      <TLDot color={tlColor} size={5} />
                    </span>

                    {task.due_date && (
                      <span
                        className={styles.dueDate}
                        style={{ color: task.due_date === today ? 'var(--warning)' : 'var(--text-muted)' }}
                      >
                        {task.due_date === today ? 'Today' : task.due_date}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
