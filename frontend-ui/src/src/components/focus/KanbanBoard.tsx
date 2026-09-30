import { useState, useRef, type DragEvent } from 'react';
import styles from './KanbanBoard.module.css';
import type { Task, Calendar, Event } from '../../types';
import { IconButton, Input, Button, Badge, TLDot, Icons } from '../ui';
import { TaskCard } from '../tasks/TaskCard';
import { STATUSES, STATUS_LABEL, STATUS_COLOR, taskEvent, taskTimeline, taskTitle, type TaskStatus } from '../tasks/taskUtils';
import { togglePinned } from './focusStore';
import { useTaskActions } from './useTaskActions';

interface KanbanBoardProps {
  tasks: Task[];
  events: Event[];
  timelines: Calendar[];
  activeTaskId: number | null;
  onActiveTask: (id: number | null) => void;
  onReload: () => void;
}

const DRAG_MIME = 'application/x-loom-task';

/**
 * Three status columns. Cards are keyboard-operable buttons (Enter/Space =
 * focus on this task) and draggable between columns; the menu offers "Move to"
 * for keyboard users.
 */
export function KanbanBoard({ tasks, events, timelines, activeTaskId, onActiveTask, onReload }: KanbanBoardProps) {
  const actions = useTaskActions({ tasks, events, activeTaskId, onActiveTask, onReload });
  const [addingIn, setAddingIn] = useState<TaskStatus | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const dragIdRef = useRef<number | null>(null);

  function onDragStart(e: DragEvent, taskId: number) {
    dragIdRef.current = taskId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_MIME, String(taskId));
  }

  function onDrop(e: DragEvent, status: TaskStatus) {
    e.preventDefault();
    setDragOver(null);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    const id = raw ? Number(raw) : dragIdRef.current;
    dragIdRef.current = null;
    if (id == null || Number.isNaN(id)) return;
    actions.moveById(id, status);
  }

  async function submitAdd(status: TaskStatus) {
    const title = newTitle.trim();
    setNewTitle('');
    setAddingIn(null);
    if (!title) return;
    await actions.add(title, status);
  }

  return (
    <div className={styles.board}>
      {STATUSES.map(status => {
        const cards = tasks.filter(t => t.status === status);
        const headId = `focus-col-${status}`;
        return (
          <section
            key={status}
            className={[styles.col, dragOver === status ? styles.colOver : ''].join(' ')}
            aria-labelledby={headId}
            onDragOver={e => { e.preventDefault(); if (dragOver !== status) setDragOver(status); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(null); }}
            onDrop={e => onDrop(e, status)}
          >
            <header className={styles.colHead}>
              <TLDot color={STATUS_COLOR[status]} size={8} />
              <h2 id={headId} className={styles.colTitle}>{STATUS_LABEL[status]}</h2>
              <Badge size="sm">{cards.length}</Badge>
              <span className={styles.spacer} />
              <IconButton
                size="sm"
                icon={Icons.plus}
                label={`Add task to ${STATUS_LABEL[status]}`}
                onClick={() => { setAddingIn(status); setNewTitle(''); }}
              />
            </header>

            {addingIn === status && (
              <form className={styles.addForm} onSubmit={e => { e.preventDefault(); void submitAdd(status); }}>
                <div className={styles.addInput}>
                  <Input
                    size="sm"
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') { setAddingIn(null); setNewTitle(''); } }}
                    placeholder="Task title"
                    aria-label={`New task in ${STATUS_LABEL[status]}`}
                    autoFocus
                  />
                </div>
                <Button size="sm" variant="secondary" type="submit" disabled={!newTitle.trim()}>Add</Button>
                <IconButton size="sm" icon={Icons.x} label="Cancel" onClick={() => { setAddingIn(null); setNewTitle(''); }} />
              </form>
            )}

            <div className={styles.cards}>
              {cards.length === 0 && addingIn !== status && (
                <p className={styles.colEmpty}>Nothing here. Drop a task or press + to add one.</p>
              )}
              {cards.map(task => {
                const isActive = task.id === activeTaskId;
                const isPinned = actions.pinned.has(task.id);
                return (
                  <div
                    key={task.id}
                    className={styles.dragWrap}
                    draggable
                    onDragStart={e => onDragStart(e, task.id)}
                    onDragEnd={() => { dragIdRef.current = null; setDragOver(null); }}
                  >
                    <TaskCard
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
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
