import type { Assignment, GradeWeight } from '../../types';
import type { BadgeTone } from '../ui';
import { parseLocalDate } from '../inbox/timeFormat';

const DAY = 86_400_000;

/** Parse the course's `grade_weights` JSON, dropping malformed rows. */
export function parseWeights(json: string | null | undefined): GradeWeight[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((w): w is GradeWeight => !!w && typeof w.name === 'string' && typeof w.weight === 'number' && Number.isFinite(w.weight))
      .map(w => ({ name: w.name, weight: w.weight }));
  } catch {
    return [];
  }
}

export function serializeWeights(weights: GradeWeight[]): string {
  return JSON.stringify(weights.map(w => ({ name: w.name.trim(), weight: w.weight })));
}

export function weightsTotal(weights: GradeWeight[]): number {
  return Math.round(weights.reduce((s, w) => s + (Number.isFinite(w.weight) ? w.weight : 0), 0) * 100) / 100;
}

export interface DueInfo {
  label: string;
  tone: BadgeTone;
  overdue: boolean;
  /** Whole days from today (negative = past). */
  days: number | null;
}

/** Human due-date label for an assignment row. Graded work is never "overdue". */
export function dueInfo(dueYMD: string, graded: boolean, now: Date = new Date()): DueInfo {
  const d = parseLocalDate(dueYMD);
  if (!d) return { label: dueYMD || 'No due date', tone: 'neutral', overdue: false, days: null };
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((d.getTime() - startOfToday) / DAY);
  const short = d.toLocaleDateString([], d.getFullYear() === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });

  if (graded) return { label: short, tone: 'neutral', overdue: false, days };
  if (days < 0) return { label: days === -1 ? '1 day overdue' : `${-days} days overdue`, tone: 'error', overdue: true, days };
  if (days === 0) return { label: 'Due today', tone: 'warning', overdue: false, days };
  if (days === 1) return { label: 'Due tomorrow', tone: 'warning', overdue: false, days };
  if (days <= 7) return { label: `Due in ${days} days`, tone: 'neutral', overdue: false, days };
  return { label: `Due ${short}`, tone: 'neutral', overdue: false, days };
}

export const isGraded = (a: Assignment): boolean => a.score != null;

/** Open (unscored) assignments for a course — the number shown in the course list. */
export function openAssignmentCount(assignments: Assignment[], courseId: number): number {
  return assignments.filter(a => a.course_id === courseId && !isGraded(a)).length;
}

export function overdueCount(assignments: Assignment[], courseId: number, now: Date = new Date()): number {
  return assignments.filter(a => a.course_id === courseId && !isGraded(a) && dueInfo(a.due_date, false, now).overdue).length;
}

/** "18 / 20" · "— / 20" · "—". */
export function scoreLabel(a: Assignment): string {
  const s = a.score != null ? trimNumber(a.score) : '—';
  if (a.max_score == null) return a.score != null ? s : '—';
  return `${s} / ${trimNumber(a.max_score)}`;
}

export function scorePercent(a: Assignment): number | null {
  if (a.score == null || a.max_score == null || a.max_score <= 0) return null;
  return Math.round((a.score / a.max_score) * 1000) / 10;
}

export function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function sortByDue(assignments: Assignment[]): Assignment[] {
  return [...assignments].sort((a, b) => a.due_date.localeCompare(b.due_date) || a.title.localeCompare(b.title));
}

/** Colour names for the shared timeline palette, in `TIMELINE_PALETTE` order. */
export const PALETTE_NAMES = ['Indigo', 'Green', 'Amber', 'Pink', 'Cyan', 'Violet', 'Red'];

export function fileBasename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
