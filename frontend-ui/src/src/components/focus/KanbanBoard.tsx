import { useState, useCallback, useRef } from 'react';
import styles from './KanbanBoard.module.css';
import { Icon, Icons } from '../shared/Icon';
import { TLDot } from '../shared/TLDot';
import type { Task, Calendar } from '../../types';
import { updateTask, createTask, deleteTask } from '../../api';


type Status = 'backlog' | 'doing' | 'done';

const COLS: { id: Status; title: string; accent: boolean }[] = [
  { id: 'backlog', title: 'Backlog',     accent: false },
  { id: 'doing',   title: 'In Progress', accent: true  },
  { id: 'done',    title: 'Done',        accent: false },
];

const PRIORITY_COLOR: Record<string, string> = {
  high: 'var(--error)', med: 'var(--warning)', low: 'var(--text-dim)',
};

interface KanbanBoardProps {
  tasks: Task[];
  timelines: Calendar[];
  activeTaskId: number | null;
  onActiveTask: (id: number | null) => void;
  onReload: () => void;
}

export function KanbanBoard({ tasks, timelines: _timelines, activeTaskId, onActiveTask, onReload }: KanbanBoardProps) {
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);
  const [addingIn, setAddingIn] = useState<Status | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const dragIdRef = useRef<number | null>(null);

  const getByStatus = (s: Status) => tasks.filter(t => t.status === s);

  const handleDragStart = useCallback((taskId: number) => {
    dragIdRef.current = taskId;
  }, []);

  const handleDrop = useCallback(async (targetStatus: Status, e: React.DragEvent) => {
    e.preventDefault();
    const id = dragIdRef.current;
    if (id === null) return;
    dragIdRef.current = null;
    await updateTask(id, { status: targetStatus });
    onReload();
  }, [onReload]);

  const handleMoveCard = useCallback(async (taskId: number, status: Status) => {
    await updateTask(taskId, { status });
    setMenuOpenFor(null);
    onReload();
  }, [onReload]);

  const handleDeleteCard = useCallback(async (taskId: number) => {
    await deleteTask(taskId);
    setMenuOpenFor(null);
    if (activeTaskId === taskId) onActiveTask(null);
    onReload();
  }, [activeTaskId, onActiveTask, onReload]);

  const handleAddTask = useCallback(async (status: Status) => {
    if (!newTaskTitle.trim()) { setAddingIn(null); return; }
    await createTask({ event_id: 0, is_complete: false, note: newTaskTitle.trim(), status, priority: 'med', due_date: '' });
    setNewTaskTitle('');
    setAddingIn(null);
    onReload();
  }, [newTaskTitle, onReload]);

  return (
    <div className={styles.board}>
      {COLS.map(col => {
        const cards = getByStatus(col.id);
        return (
          <div
            key={col.id}
            className={`${styles.col} ${col.accent ? styles.colAccent : ''}`}
            onDragOver={e => e.preventDefault()}
            onDrop={e => handleDrop(col.id, e)}
          >
            <div className={styles.colHeader}>
              <span className={`${styles.colDot} ${col.accent ? styles.colDotAccent : ''}`} />
              <span className={styles.colTitle}>{col.title}</span>
              <span className={styles.colCount}>{cards.length}</span>
              <div style={{ flex: 1 }} />
            </div>

            <div className={styles.addRow}>
              {addingIn === col.id ? (
                <input
                  className={styles.addInput}
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAddTask(col.id);
                    if (e.key === 'Escape') { setAddingIn(null); setNewTaskTitle(''); }
                  }}
                  onBlur={() => handleAddTask(col.id)}
                  placeholder="Task title…"
                  autoFocus
                />
              ) : (
                <button className={styles.addBtn} onClick={() => setAddingIn(col.id)}>
                  <Icon d={Icons.plus} size={12} /> Add a task…
                </button>
              )}
            </div>

            <div className={styles.cards}>
              {cards.map(task => {
                const isActive = task.id === activeTaskId;
                return (
                  <div
                    key={task.id}
                    className={`${styles.card} ${isActive ? styles.cardActive : ''} ${task.is_complete ? styles.cardDone : ''}`}
                    draggable
                    onDragStart={() => handleDragStart(task.id)}
                    onClick={() => setMenuOpenFor(menuOpenFor === task.id ? null : task.id)}
                  >
                    <div className={styles.cardTop}>
                      <span
                        className={styles.priorityDot}
                        style={{ background: PRIORITY_COLOR[task.priority] ?? 'var(--text-dim)' }}
                        title={task.priority}
                      />
                      <span className={styles.cardTitle}>{task.note || `Task #${task.id}`}</span>
                    </div>
                    <div className={styles.cardMeta}>
                      {task.due_date && (
                        <span className={styles.dueDate} style={{ color: task.due_date === new Date().toISOString().split('T')[0] ? 'var(--warning)' : 'var(--text-muted)' }}>
                          <Icon d={Icons.clock} size={9} /> {task.due_date}
                        </span>
                      )}
                      {isActive && <span className={styles.focusingBadge}>● FOCUSING</span>}
                    </div>

                    {menuOpenFor === task.id && (
                      <div className={styles.menu} onClick={e => e.stopPropagation()}>
                        <div className={styles.menuSection}>MOVE TO →</div>
                        {COLS.map(c => c.id !== col.id && (
                          <button key={c.id} className={styles.menuItem} onClick={() => handleMoveCard(task.id, c.id)}>
                            <TLDot color={c.accent ? 'var(--accent)' : 'var(--text-dim)'} size={6} /> {c.title}
                          </button>
                        ))}
                        <div className={styles.menuDivider} />
                        <button className={styles.menuItem} onClick={() => { onActiveTask(isActive ? null : task.id); setMenuOpenFor(null); }}>
                          {isActive ? 'Stop focusing' : 'Focus on this'}
                        </button>
                        <button className={styles.menuItem} onClick={() => updateTask(task.id, { is_complete: !task.is_complete }).then(onReload)}>
                          Mark {task.is_complete ? 'incomplete' : 'complete'}
                        </button>
                        <button className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={() => handleDeleteCard(task.id)}>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
