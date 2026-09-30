/**
 * Pure helpers shared by the Task Board, the Focus board and Home.
 * No React, no I/O — safe to unit test.
 */
import type { Task, Event, Calendar } from '../../types';
import type { BadgeTone } from '../ui';

export type Priority = Task['priority'];
export type TaskStatus = Task['status'];
export type GroupBy = 'timeline' | 'due' | 'priority' | 'status';
export type ShowFilter = 'all' | 'incomplete' | 'completed' | 'overdue';

export const PRIORITIES: Priority[] = ['high', 'med', 'low'];
export const STATUSES: TaskStatus[] = ['backlog', 'doing', 'done'];

export const PRIORITY_TONE: Record<Priority, BadgeTone> = { high: 'error', med: 'warning', low: 'neutral' };
export const PRIORITY_LABEL: Record<Priority, string> = { high: 'High', med: 'Medium', low: 'Low' };
export const STATUS_LABEL: Record<TaskStatus, string> = { backlog: 'Backlog', doing: 'In progress', done: 'Done' };
export const STATUS_COLOR: Record<TaskStatus, string> = {
  backlog: 'var(--text-dim)', doing: 'var(--accent)', done: 'var(--success)',
};
export const PRIORITY_COLOR: Record<Priority, string> = {
  high: 'var(--error)', med: 'var(--warning)', low: 'var(--text-dim)',
};

/** Group id used for tasks that have no backing event (created from the Focus board). */
export const NO_TIMELINE_GROUP = 'no-timeline';

/* ── Dates ───────────────────────────────────────────────────────────────── */

/** Local YYYY-MM-DD (never toISOString — that shifts the day in negative offsets). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayISO(): string {
  return isoDate(new Date());
}

export function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

/** Monday 00:00 of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  const dow = s.getDay(); // 0 = Sun
  s.setDate(s.getDate() - ((dow + 6) % 7));
  return s;
}

/** Parse YYYY-MM-DD as a local-midnight Date; null when malformed. */
export function parseISODate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

export function isValidISODate(s: string): boolean {
  const d = parseISODate(s);
  return !!d && isoDate(d) === s;
}

/* ── Task accessors ──────────────────────────────────────────────────────── */

export function taskTitle(task: Task): string {
  return task.note?.trim() || `Task #${task.id}`;
}

export function taskEvent(task: Task, events: Event[]): Event | null {
  if (!task.event_id) return null;
  return events.find(e => e.id === task.event_id) ?? null;
}

/** task → event → calendar. The old code passed event_id as a calendar id; this is the fix. */
export function taskTimeline(task: Task, events: Event[], timelines: Calendar[]): Calendar | null {
  const ev = taskEvent(task, events);
  if (!ev) return null;
  return timelines.find(t => t.id === ev.calendar_id) ?? null;
}

export function taskColor(task: Task, events: Event[], timelines: Calendar[]): string | null {
  return taskTimeline(task, events, timelines)?.color ?? null;
}

export function isOverdue(task: Task, today: string = todayISO()): boolean {
  return !!task.due_date && task.due_date < today && !task.is_complete;
}

export interface DueInfo {
  /** Short chip text, e.g. "Today", "Tomorrow", "3 days ago", "Sep 30". */
  label: string;
  /** Full sentence for aria-label / title. */
  long: string;
  tone: 'overdue' | 'today' | 'soon' | 'later';
  diffDays: number;
}

/** Relative description of a due date vs. today (local). */
export function describeDue(dueDate: string, today: string = todayISO()): DueInfo | null {
  const due = parseISODate(dueDate);
  const base = parseISODate(today);
  if (!due || !base) return null;
  const diff = Math.round((due.getTime() - base.getTime()) / 86_400_000);
  const dayName = due.toLocaleDateString([], { weekday: 'short' });
  const dateName = due.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (diff < 0) {
    const label = diff === -1 ? 'Yesterday' : `${-diff} days ago`;
    return { label, long: `Due ${label.toLowerCase()} (${dateName})`, tone: 'overdue', diffDays: diff };
  }
  if (diff === 0) return { label: 'Today', long: 'Due today', tone: 'today', diffDays: 0 };
  if (diff === 1) return { label: 'Tomorrow', long: 'Due tomorrow', tone: 'soon', diffDays: 1 };
  if (diff < 7) return { label: dayName, long: `Due ${dayName} (${dateName})`, tone: 'soon', diffDays: diff };
  return { label: dateName, long: `Due ${dateName}`, tone: 'later', diffDays: diff };
}

export function formatEstimate(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* ── Filtering & grouping ────────────────────────────────────────────────── */

export function matchesShow(task: Task, show: ShowFilter, today: string = todayISO()): boolean {
  switch (show) {
    case 'incomplete': return !task.is_complete;
    case 'completed':  return task.is_complete;
    case 'overdue':    return isOverdue(task, today);
    default:           return true;
  }
}

export function matchesSearch(task: Task, event: Event | null, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return taskTitle(task).toLowerCase().includes(q) || (event?.title ?? '').toLowerCase().includes(q);
}

/** Preset applied when a task is created from a group's "+" button. */
export interface GroupPreset {
  status?: TaskStatus;
  priority?: Priority;
  due_date?: string;
  /** Timeline groups: the new task is backed by a scaffold event in this calendar. */
  calendar_id?: number;
}

export interface TaskGroup {
  id: string;
  label: string;
  /** CSS color for the group dot (null → neutral). */
  color: string | null;
  tasks: Task[];
  preset: GroupPreset;
}

type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none';

function dueBucket(task: Task, today: string): DueBucket {
  if (!task.due_date) return 'none';
  const info = describeDue(task.due_date, today);
  if (!info) return 'none';
  if (info.diffDays < 0) return 'overdue';
  if (info.diffDays === 0) return 'today';
  if (info.diffDays === 1) return 'tomorrow';
  if (info.diffDays < 7) return 'week';
  return 'later';
}

/**
 * Split tasks into groups for the board. Fixed groupings (status, priority,
 * due) always return every bucket so each has a "+" target; the timeline
 * grouping lists every timeline plus a "No timeline" bucket so tasks without a
 * backing event never vanish.
 */
export function groupTasks(
  tasks: Task[],
  groupBy: GroupBy,
  events: Event[],
  timelines: Calendar[],
  today: string = todayISO(),
): TaskGroup[] {
  if (groupBy === 'status') {
    return STATUSES.map(s => ({
      id: s, label: STATUS_LABEL[s], color: STATUS_COLOR[s],
      tasks: tasks.filter(t => t.status === s), preset: { status: s },
    }));
  }
  if (groupBy === 'priority') {
    return PRIORITIES.map(p => ({
      id: p, label: PRIORITY_LABEL[p], color: PRIORITY_COLOR[p],
      tasks: tasks.filter(t => t.priority === p), preset: { priority: p },
    }));
  }
  if (groupBy === 'due') {
    const tomorrow = isoDate(addDays(parseISODate(today) ?? new Date(), 1));
    const buckets: Array<{ id: DueBucket; label: string; color: string | null; preset: GroupPreset }> = [
      { id: 'overdue',  label: 'Overdue',     color: 'var(--error)',   preset: {} },
      { id: 'today',    label: 'Today',       color: 'var(--warning)', preset: { due_date: today } },
      { id: 'tomorrow', label: 'Tomorrow',    color: 'var(--accent)',  preset: { due_date: tomorrow } },
      { id: 'week',     label: 'This week',   color: 'var(--info)',    preset: {} },
      { id: 'later',    label: 'Later',       color: null,             preset: {} },
      { id: 'none',     label: 'No due date', color: null,             preset: {} },
    ];
    return buckets.map(b => ({
      id: b.id, label: b.label, color: b.color, preset: b.preset,
      tasks: tasks.filter(t => dueBucket(t, today) === b.id),
    }));
  }
  // timeline
  const byTimeline = new Map<number, Task[]>();
  const orphans: Task[] = [];
  for (const t of tasks) {
    const tl = taskTimeline(t, events, timelines);
    if (!tl) { orphans.push(t); continue; }
    const list = byTimeline.get(tl.id) ?? [];
    list.push(t);
    byTimeline.set(tl.id, list);
  }
  const groups: TaskGroup[] = timelines.map(tl => ({
    id: String(tl.id), label: tl.name, color: tl.color,
    tasks: byTimeline.get(tl.id) ?? [], preset: { calendar_id: tl.id },
  }));
  groups.push({ id: NO_TIMELINE_GROUP, label: 'No timeline', color: null, tasks: orphans, preset: {} });
  return groups;
}
