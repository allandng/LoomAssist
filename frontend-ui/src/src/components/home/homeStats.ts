/**
 * Pure stat helpers for the Home dashboard (and the Focus sidebar's "Up next").
 */
import type { Event, Calendar, Task, HabitEntry } from '../../types';
import { toFCEvents } from '../../lib/eventUtils';
import { isoDate, addDays, parseISODate } from '../tasks/taskUtils';

export interface Occurrence {
  key: string;
  event: Event;
  start: Date;
  end: Date | null;
  allDay: boolean;
  /** Local YYYY-MM-DD of the occurrence. */
  date: string;
  /** Set for recurring occurrences — pass to openEventEditor as `instanceDate`. */
  instanceDate?: string;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    // All-day occurrences come back as bare YYYY-MM-DD; parse as local midnight.
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return parseISODate(v);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'number') return new Date(v);
  return null;
}

/**
 * Expand every event (recurring rules included) into concrete occurrences and
 * drop the synthetic prep blocks that toFCEvents adds for lectures.
 */
export function expandOccurrences(events: Event[], timelines: Calendar[]): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ev of events) {
    let inputs;
    try { inputs = toFCEvents(ev, timelines); } catch { continue; }
    for (const fc of inputs) {
      const xp = (fc.extendedProps ?? {}) as { isPrepBlock?: boolean; instanceDate?: string };
      if (xp.isPrepBlock) continue;
      const start = toDate(fc.start);
      if (!start) continue;
      const end = toDate(fc.end);
      out.push({
        key: String(fc.id ?? `${ev.id}_${start.getTime()}`),
        event: ev,
        start,
        end,
        allDay: !!fc.allDay || !!ev.is_all_day,
        date: isoDate(start),
        instanceDate: xp.instanceDate,
      });
    }
  }
  return out;
}

export function occurrencesOn(events: Event[], timelines: Calendar[], date: string): Occurrence[] {
  return expandOccurrences(events, timelines).filter(o => o.date === date);
}

/**
 * Next occurrences from `from` (inclusive of anything still running), sorted by
 * start, optionally capped to `withinDays` and `limit`.
 */
export function upcomingOccurrences(
  events: Event[],
  timelines: Calendar[],
  from: Date = new Date(),
  opts: { withinDays?: number; limit?: number; sameDayOnly?: boolean } = {},
): Occurrence[] {
  const fromMs = from.getTime();
  const today = isoDate(from);
  const horizon = opts.withinDays != null ? addDays(from, opts.withinDays).getTime() : Infinity;
  const list = expandOccurrences(events, timelines).filter(o => {
    if (opts.sameDayOnly && o.date !== today) return false;
    const endMs = o.end ? o.end.getTime() : o.allDay ? addDays(o.start, 1).getTime() : o.start.getTime();
    if (endMs <= fromMs) return false;           // already over
    if (o.start.getTime() > horizon) return false;
    return true;
  });
  list.sort((a, b) => a.start.getTime() - b.start.getTime());
  return opts.limit != null ? list.slice(0, opts.limit) : list;
}

/** Incomplete tasks due in the next 7 days (today inclusive), plus how many are already overdue. */
export function tasksDueThisWeek(tasks: Task[], today: string): { due: number; overdue: number } {
  const base = parseISODate(today) ?? new Date();
  const weekEnd = isoDate(addDays(base, 7));
  let due = 0, overdue = 0;
  for (const t of tasks) {
    if (t.is_complete || !t.due_date) continue;
    if (t.due_date < today) overdue += 1;
    else if (t.due_date < weekEnd) due += 1;
  }
  return { due, overdue };
}

/**
 * Consecutive days (ending today, or yesterday if nothing is logged yet today)
 * with at least one habit entry across all habits.
 */
export function habitStreak(entries: HabitEntry[], today: string): number {
  const days = new Set(entries.filter(e => e.count > 0).map(e => e.date));
  if (days.size === 0) return 0;
  const base = parseISODate(today) ?? new Date();
  let cursor = days.has(today) ? base : addDays(base, -1);
  let streak = 0;
  while (days.has(isoDate(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
