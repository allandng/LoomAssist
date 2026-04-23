import { useState, useEffect, useCallback, useMemo } from 'react';
import styles from './TaskBoardPage.module.css';
import { Icon, Icons } from '../components/shared/Icon';
import { TLDot } from '../components/shared/TLDot';
import { SectionLabel } from '../components/shared/SectionLabel';
import { listTasks, listCalendars, listEvents, updateTask, deleteTask } from '../api';
import type { Task, Calendar, Event } from '../types';
import { timelineColor, parseChecklist } from '../lib/eventUtils';

type GroupBy = 'timeline' | 'due' | 'priority' | 'status';
type ShowFilter = 'all' | 'incomplete' | 'completed' | 'overdue';

const PRIORITY_COLOR: Record<string, string> = {
  high: 'var(--error)', med: 'var(--warning)', low: 'var(--text-dim)',
};

interface TaskCardProps {
  task: Task;
  event: Event | null;
  timeline: Calendar | null;
  activeTaskId: number | null;
  onToggle: (task: Task) => void;
  onDelete: (id: number) => void;
}

function TaskCard({ task, event, timeline, activeTaskId, onToggle, onDelete }: TaskCardProps) {
  const isActive = task.id === activeTaskId;
  const isOverdue = task.due_date ? task.due_date < new Date().toISOString().split('T')[0] && !task.is_complete : false;
  const checklist = parseChecklist(event?.checklist ?? '');
  const done = checklist.filter(c => c.done).length;
  const tlColor = timeline?.color ?? 'var(--text-dim)';
  const progPct = checklist.length > 0 ? Math.round((done / checklist.length) * 100) : 0;

  return (
    <div className={`${styles.card} ${isActive ? styles.cardActive : ''} ${task.is_complete ? styles.cardDone : ''}`}>
      <div className={styles.cardTop}>
        <button
          className={styles.cardCheckbox}
          style={{
            borderColor: task.is_complete ? 'var(--success)' : 'var(--border-strong)',
            background: task.is_complete ? 'var(--success)' : 'transparent',
          }}
          onClick={() => onToggle(task)}
        >
          {task.is_complete && <Icon d={Icons.check} size={10} stroke="#0B1120" strokeWidth={3} />}
        </button>
        <div className={styles.cardBody}>
          <div className={styles.cardTitle}>{task.note || `Task #${task.id}`}</div>
          {event && (
            <div className={styles.cardEvent}>
              <Icon d={Icons.link} size={10} stroke={tlColor} />
              <span style={{ color: tlColor }}>{event.title}</span>
            </div>
          )}
        </div>
        <span className={styles.priorityDot} style={{ background: PRIORITY_COLOR[task.priority] ?? 'var(--text-dim)' }} title={task.priority} />
      </div>

      {!task.is_complete && checklist.length > 0 && (
        <div className={styles.checklistSection}>
          <div className={styles.checklistHeader}>
            <span>CHECKLIST {done}/{checklist.length}</span>
            {isOverdue && <span className={styles.overdueTag}>OVERDUE</span>}
            {isActive && <span className={styles.focusingTag}>● FOCUSING</span>}
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${progPct}%`, background: tlColor }} />
          </div>
        </div>
      )}
    </div>
  );
}

export function TaskBoardPage() {
  const [tasks, setTasks]         = useState<Task[]>([]);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const [events, setEvents]       = useState<Event[]>([]);
  const [groupBy, setGroupBy]     = useState<GroupBy>('timeline');
  const [showFilter, setShowFilter] = useState<ShowFilter>('all');
  const [activeTaskId] = useState<number | null>(null);

  const today = new Date().toISOString().split('T')[0];

  const loadData = useCallback(async () => {
    const [t, c, e] = await Promise.all([listTasks(), listCalendars(), listEvents()]);
    setTasks(t);
    setTimelines(c);
    setEvents(e);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleToggle = useCallback(async (task: Task) => {
    await updateTask(task.id, { is_complete: !task.is_complete, status: task.is_complete ? 'backlog' : 'done' });
    loadData();
  }, [loadData]);

  const handleDelete = useCallback(async (id: number) => {
    await deleteTask(id);
    loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    return tasks.filter(t => {
      if (showFilter === 'incomplete') return !t.is_complete;
      if (showFilter === 'completed') return t.is_complete;
      if (showFilter === 'overdue') return t.due_date && t.due_date < today && !t.is_complete;
      return true;
    });
  }, [tasks, showFilter, today]);

  const filterCounts = useMemo(() => ({
    all:        tasks.length,
    incomplete: tasks.filter(t => !t.is_complete).length,
    completed:  tasks.filter(t => t.is_complete).length,
    overdue:    tasks.filter(t => t.due_date && t.due_date < today && !t.is_complete).length,
  }), [tasks, today]);

  // Group tasks
  const groups = useMemo(() => {
    if (groupBy === 'timeline') {
      return timelines
        .map(tl => ({
          id: String(tl.id),
          label: tl.name,
          color: tl.color,
          items: filtered.filter(t => {
            const ev = events.find(e => e.id === t.event_id);
            return ev?.calendar_id === tl.id;
          }),
        }))
        .filter(g => g.items.length > 0);
    }
    if (groupBy === 'status') {
      return (['backlog', 'doing', 'done'] as const).map(s => ({
        id: s, label: s === 'doing' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1),
        color: s === 'doing' ? 'var(--accent)' : s === 'done' ? 'var(--success)' : 'var(--text-dim)',
        items: filtered.filter(t => t.status === s),
      })).filter(g => g.items.length > 0);
    }
    if (groupBy === 'priority') {
      return (['high', 'med', 'low'] as const).map(p => ({
        id: p, label: p.charAt(0).toUpperCase() + p.slice(1),
        color: PRIORITY_COLOR[p], items: filtered.filter(t => t.priority === p),
      })).filter(g => g.items.length > 0);
    }
    // due
    const buckets: Record<string, Task[]> = {};
    for (const t of filtered) {
      const key = t.due_date || 'No due date';
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(t);
    }
    return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).map(([label, items]) => ({
      id: label, label, color: 'var(--text-muted)', items,
    }));
  }, [filtered, groupBy, timelines, events]);

  return (
    <div className={styles.page}>
      {/* Sidebar */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>Task Board</div>
        <div className={styles.sidebarScroll}>
          <SectionLabel>Group by</SectionLabel>
          <div className={styles.groupList}>
            {(['timeline', 'due', 'priority', 'status'] as const).map(g => (
              <button
                key={g}
                className={`${styles.groupItem} ${groupBy === g ? styles.groupItemActive : ''}`}
                onClick={() => setGroupBy(g)}
              >
                {g.charAt(0).toUpperCase() + g.slice(1).replace('due', 'Due date')}
              </button>
            ))}
          </div>

          <SectionLabel>Show</SectionLabel>
          <div className={styles.showList}>
            {(['all', 'incomplete', 'completed', 'overdue'] as const).map(f => (
              <button
                key={f}
                className={`${styles.showItem} ${showFilter === f ? styles.showItemActive : ''}`}
                onClick={() => setShowFilter(f)}
              >
                <span className={`${styles.showLabel} ${f === 'overdue' ? styles.showLabelWarn : ''}`}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </span>
                <span className={styles.showCount}>{filterCounts[f]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main */}
      <div className={styles.main}>
        <div className={styles.scroll}>
          <div className={styles.groups}>
            {groups.length === 0 && (
              <div className={styles.empty}>No tasks match the current filter.</div>
            )}
            {groups.map(g => (
              <div key={g.id} className={styles.group}>
                <div className={styles.groupHeader}>
                  <TLDot color={g.color} size={10} />
                  <span className={styles.groupLabel}>{g.label}</span>
                  <span className={styles.groupMeta}>
                    {g.items.filter(i => !i.is_complete).length} open · {g.items.length} total
                  </span>
                </div>
                <div className={styles.cardGrid}>
                  {g.items.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      event={events.find(e => e.id === task.event_id) ?? null}
                      timeline={timelines.find(t => t.id === events.find(e => e.id === task.event_id)?.calendar_id) ?? null}
                      activeTaskId={activeTaskId}
                      onToggle={handleToggle}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TaskBoardSidebarContent() {
  return null;
}
