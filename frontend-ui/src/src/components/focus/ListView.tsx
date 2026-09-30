import { useState } from 'react';
import styles from './ListView.module.css';
import type { Task, Calendar, Event } from '../../types';
import { Input, Button, Badge, EmptyState, IconButton, TLDot, Icons } from '../ui';
import { TaskCard } from '../tasks/TaskCard';
import { STATUS_LABEL, STATUS_COLOR, taskEvent, taskTimeline, taskTitle, type TaskStatus } from '../tasks/taskUtils';
import { togglePinned } from './focusStore';
import { useTaskActions } from './useTaskActions';

const ORDER: TaskStatus[] = ['doing', 'backlog', 'done'];

interface ListViewProps {
  tasks: Task[];
  events: Event[];
  timelines: Calendar[];
  activeTaskId: number | null;
  onActiveTask: (id: number | null) => void;
  onReload: () => void;
}

/** Grouped rows with the same controls as the board; the add row is a real form. */
export function ListView({ tasks, events, timelines, activeTaskId, onActiveTask, onReload }: ListViewProps) {
  const actions = useTaskActions({ tasks, events, activeTaskId, onActiveTask, onReload });
  const [newTitle, setNewTitle] = useState('');

  async function submitAdd() {
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle('');
    await actions.add(title, 'backlog');
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <form className={styles.addRow} onSubmit={e => { e.preventDefault(); void submitAdd(); }}>
          <div className={styles.addInput}>
            <Input
              size="sm"
              icon={Icons.plus}
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Add a task and press Enter"
              aria-label="New task"
            />
          </div>
          <Button size="sm" variant="secondary" type="submit" disabled={!newTitle.trim()}>Add</Button>
        </form>

        {tasks.length === 0 && (
          <EmptyState
            icon={Icons.tasks}
            title="No tasks yet"
            description="Add one above, or send a task to the board from any event."
          />
        )}

        {ORDER.map(status => {
          const items = tasks.filter(t => t.status === status);
          if (items.length === 0) return null;
          const headId = `focus-list-${status}`;
          return (
            <section key={status} className={styles.group} aria-labelledby={headId}>
              <header className={styles.groupHead}>
                <TLDot color={STATUS_COLOR[status]} size={8} />
                <h2 id={headId} className={styles.groupTitle}>{STATUS_LABEL[status]}</h2>
                <Badge size="sm">{items.length}</Badge>
              </header>
              <div className={styles.rows}>
                {items.map(task => {
                  const isActive = task.id === activeTaskId;
                  const isPinned = actions.pinned.has(task.id);
                  return (
                    <TaskCard
                      key={task.id}
                      variant="row"
                      task={task}
                      event={taskEvent(task, events)}
                      timeline={taskTimeline(task, events, timelines)}
                      focusing={isActive}
                      onToggle={actions.toggleComplete}
                      menuItems={actions.menuFor(task)}
                      onActivate={() => actions.focusOn(task)}
                      activateLabel={isActive ? 'Stop focusing' : 'Focus on this task'}
                      extra={
                        <IconButton
                          size="sm"
                          icon={Icons.pin}
                          active={isPinned}
                          label={isPinned ? `Unpin ${taskTitle(task)}` : `Pin ${taskTitle(task)}`}
                          onClick={() => togglePinned(task.id)}
                        />
                      }
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
