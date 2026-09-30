import { useCallback, useMemo } from 'react';
import { createTask, deleteTask, updateTask } from '../../api';
import type { Task, Event } from '../../types';
import { Icons, confirm, type MenuEntry } from '../ui';
import { useNotifications } from '../../store/notifications';
import { useModal } from '../../contexts/ModalContext';
import { getPinnedIds, markTaskDone, togglePinned, useFocusVersion } from './focusStore';
import { STATUSES, STATUS_LABEL, taskEvent, taskTitle, type TaskStatus } from '../tasks/taskUtils';

interface Options {
  tasks: Task[];
  events: Event[];
  activeTaskId: number | null;
  onActiveTask: (id: number | null) => void;
  onReload: () => void;
}

/**
 * Mutations shared by the Focus board and list: complete, move between
 * columns, pin, delete (confirms), quick-add, plus the per-task menu.
 */
export function useTaskActions({ tasks, events, activeTaskId, onActiveTask, onReload }: Options) {
  const { addNotification } = useNotifications();
  const { openEventEditor } = useModal();
  const focusVersion = useFocusVersion();
  const pinned = useMemo(() => new Set(getPinnedIds()), [focusVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- store read keyed on its version

  const run = useCallback(async (failTitle: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      onReload();
    } catch {
      addNotification({ type: 'error', title: failTitle });
    }
  }, [onReload, addNotification]);

  const toggleComplete = useCallback((task: Task) => run('Could not update task', async () => {
    const done = !task.is_complete;
    await updateTask(task.id, { is_complete: done, status: done ? 'done' : 'backlog' });
    markTaskDone(task.id, done);
  }), [run]);

  const move = useCallback((task: Task, status: TaskStatus) => run('Could not move task', async () => {
    if (task.status === status) return;
    const done = status === 'done';
    await updateTask(task.id, { status, is_complete: done });
    if (done !== task.is_complete) markTaskDone(task.id, done);
  }), [run]);

  const moveById = useCallback((id: number, status: TaskStatus) => {
    const task = tasks.find(t => t.id === id);
    if (task) void move(task, status);
  }, [tasks, move]);

  const remove = useCallback(async (task: Task) => {
    const ok = await confirm({
      title: `Delete "${taskTitle(task)}"?`,
      description: 'The task is removed from the board. Any linked event stays on the calendar.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await run('Could not delete task', async () => {
      await deleteTask(task.id);
      if (activeTaskId === task.id) onActiveTask(null);
    });
  }, [run, activeTaskId, onActiveTask]);

  const add = useCallback((title: string, status: TaskStatus) => run('Could not create task', () =>
    createTask({ event_id: 0, is_complete: status === 'done', note: title, status, priority: 'med', due_date: '' }),
  ), [run]);

  const focusOn = useCallback((task: Task) => {
    onActiveTask(activeTaskId === task.id ? null : task.id);
  }, [activeTaskId, onActiveTask]);

  const menuFor = useCallback((task: Task): MenuEntry[] => {
    const ev = taskEvent(task, events);
    const isActive = activeTaskId === task.id;
    return [
      { id: 'focus', label: isActive ? 'Stop focusing' : 'Focus on this', icon: Icons.target, onSelect: () => focusOn(task) },
      { id: 'pin', label: pinned.has(task.id) ? 'Unpin from sidebar' : 'Pin to sidebar', icon: Icons.pin, onSelect: () => togglePinned(task.id) },
      { id: 'done', label: task.is_complete ? 'Mark not done' : 'Mark done', icon: Icons.checkCircle, onSelect: () => void toggleComplete(task) },
      { heading: 'Move to' },
      ...STATUSES.map(s => ({ id: `mv-${s}`, label: STATUS_LABEL[s], checked: task.status === s, onSelect: () => void move(task, s) })),
      { separator: true },
      { id: 'open', label: 'Open event', icon: Icons.externalLink, disabled: !ev, onSelect: () => { if (ev) openEventEditor(ev); } },
      { separator: true },
      { id: 'delete', label: 'Delete', icon: Icons.trash, danger: true, onSelect: () => void remove(task) },
    ];
  }, [events, activeTaskId, pinned, focusOn, toggleComplete, move, openEventEditor, remove]);

  return { pinned, toggleComplete, move, moveById, remove, add, focusOn, menuFor };
}
