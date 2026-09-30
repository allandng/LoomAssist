import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './TaskBoardPage.module.css';
import {
  listTasks, listCalendars, listEvents, updateTask, deleteTask, createTask, createEvent, runAutopilot,
} from '../api';
import type { Task, Calendar, Event } from '../types';
import {
  Page, Section, Toolbar, ToolbarSpacer, Button, IconButton, Input, Segmented, Badge, Skeleton, EmptyState,
  TLDot, Icons, confirm, prompt, type MenuEntry,
} from '../components/ui';
import { ContextSidebar } from '../components/sidebar/ContextSidebar';
import { DensityHeatmap } from '../components/shared/DensityHeatmap';
import { HabitsPanel } from '../components/tasks/HabitsPanel';
import { TaskTemplatesPanel } from '../components/tasks/TaskTemplatesPanel';
import { TaskCard } from '../components/tasks/TaskCard';
import {
  groupTasks, matchesShow, matchesSearch, taskEvent, taskTimeline, taskTitle, todayISO, addDays, isValidISODate,
  PRIORITIES, PRIORITY_LABEL,
  type GroupBy, type ShowFilter, type TaskGroup, type Priority,
} from '../components/tasks/taskUtils';
import { useActiveTaskId, setActiveTaskId, markTaskDone } from '../components/focus/focusStore';
import { useModal } from '../contexts/ModalContext';
import { useNotifications } from '../store/notifications';

type BoardView = 'board' | 'list';

const PANEL_KEY = 'loom:panel:tasks';
const GROUP_KEY = 'loom:tasks:groupBy';
const VIEW_KEY  = 'loom:tasks:view';

const GROUP_OPTIONS: GroupBy[] = ['timeline', 'due', 'priority', 'status'];
const VIEW_OPTIONS: BoardView[] = ['board', 'list'];

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

/** All-day scaffold event so a task can belong to a timeline (tasks are event-backed). */
function scaffoldEvent(title: string, calendarId: number, date: string) {
  return {
    title,
    start_time: `${date}T00:00:00`,
    end_time: `${date}T23:59:00`,
    calendar_id: calendarId,
    is_recurring: false,
    recurrence_days: '',
    recurrence_end: '',
    description: '',
    unique_description: '',
    reminder_minutes: 0,
    external_uid: '',
    timezone: 'local',
    is_all_day: true,
    skipped_dates: '',
    per_day_times: '',
    checklist: '',
  };
}

export function TaskBoardPage() {
  const navigate = useNavigate();
  const { openAutopilotReview, openEventEditor } = useModal();
  const { addNotification } = useNotifications();
  const activeTaskId = useActiveTaskId();

  const [tasks, setTasks]         = useState<Task[]>([]);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const [events, setEvents]       = useState<Event[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [groupBy, setGroupBy]     = useState<GroupBy>(() => readChoice(GROUP_KEY, GROUP_OPTIONS, 'timeline'));
  const [show, setShow]           = useState<ShowFilter>('all');
  const [view, setView]           = useState<BoardView>(() => readChoice(VIEW_KEY, VIEW_OPTIONS, 'board'));
  const [query, setQuery]         = useState('');
  const [quickTitle, setQuickTitle] = useState('');
  const [panelCollapsed, setPanelCollapsed] = useState(() => readFlag(PANEL_KEY));
  const [planning, setPlanning]   = useState(false);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    let alive = true;
    Promise.all([listTasks(), listCalendars(), listEvents()])
      .then(([t, c, e]) => {
        if (!alive) return;
        setTasks(t);
        setTimelines(c);
        setEvents(e);
        setError(false);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [reloadKey]);

  /* ── Left panel: collapse state persisted, toggled by the TopBar too ────── */
  const togglePanel = useCallback(() => {
    setPanelCollapsed(c => {
      const next = !c;
      persist(PANEL_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  useEffect(() => {
    window.addEventListener('loom-panel-toggle', togglePanel);
    return () => window.removeEventListener('loom-panel-toggle', togglePanel);
  }, [togglePanel]);

  const changeGroupBy = (g: GroupBy) => { setGroupBy(g); persist(GROUP_KEY, g); };
  const changeView    = (v: BoardView) => { setView(v); persist(VIEW_KEY, v); };

  /* ── Derived ───────────────────────────────────────────────────────────── */
  const today = todayISO();
  const filtering = query.trim() !== '' || show !== 'all';

  const visible = useMemo(
    () => tasks.filter(t => matchesShow(t, show, today) && matchesSearch(t, taskEvent(t, events), query)),
    [tasks, show, today, query, events],
  );

  const groups = useMemo(
    () => groupTasks(visible, groupBy, events, timelines, today),
    [visible, groupBy, events, timelines, today],
  );

  // While searching or filtering, hide groups that came up empty.
  const shownGroups = useMemo(
    () => (filtering ? groups.filter(g => g.tasks.length > 0) : groups),
    [groups, filtering],
  );

  const counts = useMemo(() => ({
    all:        tasks.length,
    incomplete: tasks.filter(t => !t.is_complete).length,
    completed:  tasks.filter(t => t.is_complete).length,
    overdue:    tasks.filter(t => t.due_date && t.due_date < today && !t.is_complete).length,
  }), [tasks, today]);

  /* ── Mutations ─────────────────────────────────────────────────────────── */
  async function run(failTitle: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      reload();
    } catch {
      addNotification({ type: 'error', title: failTitle });
    }
  }

  const toggleDone = (task: Task) => run('Could not update task', async () => {
    const done = !task.is_complete;
    await updateTask(task.id, { is_complete: done, status: done ? 'done' : 'backlog' });
    markTaskDone(task.id, done);
  });

  async function editNote(task: Task) {
    const v = await prompt({ title: 'Edit note', label: 'Task', defaultValue: task.note, confirmLabel: 'Save', validate: s => (s.trim() ? null : 'Enter a note') });
    if (v == null) return;
    await run('Could not update task', () => updateTask(task.id, { note: v.trim() }));
  }

  async function setDue(task: Task) {
    const v = await prompt({
      title: 'Set due date',
      label: 'Due date (YYYY-MM-DD, empty to clear)',
      defaultValue: task.due_date || today,
      placeholder: today,
      confirmLabel: 'Save',
      validate: s => (s.trim() === '' || isValidISODate(s.trim()) ? null : 'Use the format YYYY-MM-DD'),
    });
    if (v == null) return;
    await run('Could not update task', () => updateTask(task.id, { due_date: v.trim() }));
  }

  async function setEstimate(task: Task) {
    const v = await prompt({
      title: 'Set estimate',
      label: 'Minutes (empty to clear)',
      defaultValue: task.estimated_minutes ? String(task.estimated_minutes) : '',
      placeholder: '45',
      confirmLabel: 'Save',
      validate: s => (s.trim() === '' || (/^\d+$/.test(s.trim()) && Number(s) > 0) ? null : 'Enter a whole number of minutes'),
    });
    if (v == null) return;
    await run('Could not update task', () => updateTask(task.id, { estimated_minutes: v.trim() ? Number(v.trim()) : null }));
  }

  const setPriority = (task: Task, p: Priority) => run('Could not update task', () => updateTask(task.id, { priority: p }));

  async function remove(task: Task) {
    const ok = await confirm({
      title: `Delete "${taskTitle(task)}"?`,
      description: 'The task is removed from the board. Any linked event stays on the calendar.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await run('Could not delete task', async () => {
      await deleteTask(task.id);
      if (activeTaskId === task.id) setActiveTaskId(null);
    });
  }

  const focusOn = (task: Task) => setActiveTaskId(activeTaskId === task.id ? null : task.id);

  async function createWithPreset(title: string, group: TaskGroup | null) {
    const preset = group?.preset ?? {};
    await run('Could not create task', async () => {
      let eventId = 0;
      if (preset.calendar_id) {
        const { event } = await createEvent(scaffoldEvent(title, preset.calendar_id, preset.due_date ?? today));
        eventId = event.id;
      }
      await createTask({
        event_id: eventId,
        is_complete: false,
        note: title,
        status: preset.status ?? 'backlog',
        priority: preset.priority ?? 'med',
        due_date: preset.due_date ?? '',
      });
    });
  }

  async function addTask(group: TaskGroup | null) {
    const title = await prompt({
      title: group ? `New task in ${group.label}` : 'New task',
      label: 'Task',
      placeholder: 'What needs doing?',
      confirmLabel: 'Add',
      validate: s => (s.trim() ? null : 'Enter a task'),
    });
    if (!title) return;
    await createWithPreset(title.trim(), group);
  }

  async function quickAdd() {
    const title = quickTitle.trim();
    if (!title) return;
    setQuickTitle('');
    await createWithPreset(title, null);
  }

  async function planWeek() {
    setPlanning(true);
    try {
      const now = new Date();
      const res = await runAutopilot({ window_start: now.toISOString(), window_end: addDays(now, 7).toISOString() });
      openAutopilotReview(res.proposals, res.overflow, timelines, reload);
    } catch {
      addNotification({ type: 'error', title: 'Autopilot failed', message: 'Could not generate proposals.' });
    } finally {
      setPlanning(false);
    }
  }

  function menuFor(task: Task): MenuEntry[] {
    const ev = taskEvent(task, events);
    return [
      { id: 'focus', label: activeTaskId === task.id ? 'Stop focusing' : 'Focus on this', icon: Icons.target, onSelect: () => focusOn(task) },
      { id: 'note',  label: 'Edit note',      icon: Icons.pencil,   onSelect: () => void editNote(task) },
      { id: 'due',   label: 'Set due date',   icon: Icons.calendar, onSelect: () => void setDue(task) },
      { id: 'est',   label: 'Set estimate',   icon: Icons.timer,    onSelect: () => void setEstimate(task) },
      { heading: 'Priority' },
      ...PRIORITIES.map(p => ({ id: `p-${p}`, label: PRIORITY_LABEL[p], checked: task.priority === p, onSelect: () => void setPriority(task, p) })),
      { separator: true },
      { id: 'open', label: 'Open event', icon: Icons.externalLink, disabled: !ev, onSelect: () => { if (ev) openEventEditor(ev); } },
      { separator: true },
      { id: 'delete', label: 'Delete', icon: Icons.trash, danger: true, onSelect: () => void remove(task) },
    ];
  }

  function renderCard(task: Task, variant: 'card' | 'row') {
    return (
      <TaskCard
        key={task.id}
        task={task}
        variant={variant}
        event={taskEvent(task, events)}
        timeline={taskTimeline(task, events, timelines)}
        focusing={activeTaskId === task.id}
        onToggle={toggleDone}
        menuItems={menuFor(task)}
      />
    );
  }

  function groupHead(g: TaskGroup, id: string) {
    return (
      <header className={styles.groupHead}>
        <TLDot color={g.color ?? 'var(--text-dim)'} size={8} />
        <h2 id={id} className={styles.groupTitle} title={g.label}>{g.label}</h2>
        <Badge size="sm">{g.tasks.length}</Badge>
        <span className={styles.spacer} />
        <IconButton size="sm" icon={Icons.plus} label={`Add task to ${g.label}`} onClick={() => void addTask(g)} />
      </header>
    );
  }

  /* ── Render ────────────────────────────────────────────────────────────── */
  const emptyBoard = !loading && !error && visible.length === 0;

  return (
    <Page bare>
      <ContextSidebar collapsed={panelCollapsed} onToggle={togglePanel}>
        <div className={styles.panel}>
          <div className={styles.planBlock}>
            <Button variant="primary" block icon={Icons.sparkles} loading={planning} onClick={planWeek}>
              Plan week
            </Button>
            <p className={styles.panelHint}>Schedules tasks with an estimate into free time over the next seven days.</p>
          </div>

          <Section small title="Group by">
            <Segmented
              size="sm"
              aria-label="Group tasks by"
              value={groupBy}
              onChange={changeGroupBy}
              options={[
                { value: 'timeline', label: 'Timeline' },
                { value: 'due',      label: 'Due' },
                { value: 'priority', label: 'Priority' },
                { value: 'status',   label: 'Status' },
              ]}
            />
          </Section>

          <Section small title="Show">
            <Segmented
              size="sm"
              aria-label="Show tasks"
              value={show}
              onChange={setShow}
              options={[
                { value: 'all',        label: 'All' },
                { value: 'incomplete', label: 'Open' },
                { value: 'completed',  label: 'Done' },
                { value: 'overdue',    label: 'Overdue' },
              ]}
            />
            <div className={styles.counts}>
              <span>{counts.incomplete} open</span>
              <span>{counts.completed} done</span>
              <span className={counts.overdue ? styles.countWarn : undefined}>{counts.overdue} overdue</span>
            </div>
          </Section>

          <HabitsPanel />

          <TaskTemplatesPanel timelines={timelines} onCreated={reload} />

          <Section small title="Activity">
            <DensityHeatmap
              events={events}
              onDayClick={d => navigate('/calendar', { state: { date: d.toISOString(), view: 'Day' } })}
            />
          </Section>
        </div>
      </ContextSidebar>

      <div className={styles.main}>
        <Toolbar className={styles.toolbar}>
          <div className={styles.search}>
            <Input
              size="sm"
              icon={Icons.search}
              placeholder="Search tasks"
              aria-label="Search tasks"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          {!loading && !error && (
            <span className={styles.count}>
              {filtering ? `${visible.length} of ${tasks.length}` : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
            </span>
          )}
          <ToolbarSpacer />
          <Segmented
            size="sm"
            aria-label="Layout"
            value={view}
            onChange={changeView}
            options={[
              { value: 'board', label: 'Board', icon: Icons.kanban },
              { value: 'list',  label: 'List',  icon: Icons.list },
            ]}
          />
        </Toolbar>

        <div className={styles.scroll}>
          {error ? (
            <div className={styles.errorRow} role="alert">
              <Badge tone="error" icon={Icons.alertCircle}>Couldn't load tasks</Badge>
              <Button size="sm" variant="subtle" icon={Icons.refresh} onClick={reload}>Retry</Button>
            </div>
          ) : loading ? (
            <div className={styles.columns} aria-hidden="true">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className={styles.skeletonCol}>
                  <Skeleton height={16} width="50%" />
                  <Skeleton height={72} />
                  <Skeleton height={72} />
                  <Skeleton height={72} />
                </div>
              ))}
            </div>
          ) : emptyBoard ? (
            <EmptyState
              icon={Icons.tasks}
              title={tasks.length === 0 ? 'No tasks yet' : 'No tasks match'}
              description={
                tasks.length === 0
                  ? 'Add a task here, or send one to the board from any event.'
                  : 'Try another filter or clear the search.'
              }
              action={{ label: 'Add task', icon: Icons.plus, onClick: () => void addTask(null) }}
              secondary={filtering ? { label: 'Clear filters', onClick: () => { setQuery(''); setShow('all'); } } : undefined}
            />
          ) : view === 'board' ? (
            <div className={styles.columns}>
              {shownGroups.map(g => {
                const headId = `tasks-group-${g.id}`;
                return (
                  <section key={g.id} className={styles.column} aria-labelledby={headId}>
                    {groupHead(g, headId)}
                    <div className={styles.cards}>
                      {g.tasks.length === 0
                        ? <p className={styles.columnEmpty}>No tasks</p>
                        : g.tasks.map(t => renderCard(t, 'card'))}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className={styles.listWrap}>
              <form className={styles.addRow} onSubmit={e => { e.preventDefault(); void quickAdd(); }}>
                <div className={styles.addInput}>
                  <Input
                    size="sm"
                    icon={Icons.plus}
                    placeholder="Add a task and press Enter"
                    aria-label="New task"
                    value={quickTitle}
                    onChange={e => setQuickTitle(e.target.value)}
                  />
                </div>
                <Button size="sm" variant="secondary" type="submit" disabled={!quickTitle.trim()}>Add</Button>
              </form>
              {shownGroups.filter(g => g.tasks.length > 0).map(g => {
                const headId = `tasks-list-${g.id}`;
                return (
                  <section key={g.id} className={styles.listGroup} aria-labelledby={headId}>
                    {groupHead(g, headId)}
                    <div className={styles.rows}>
                      {g.tasks.map(t => renderCard(t, 'row'))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
