/**
 * Shared time formatting.
 *
 *   relativeTime('2026-09-30T10:00:00Z')   → 'just now' | '3m ago' | '2h ago' | 'yesterday' | 'Mar 4'
 *   formatTimeRange(startISO, endISO)       → '9:00–10:30 AM' | '11:30 AM–1:00 PM'
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Compact relative label for a past (or near-future) timestamp.
 * Falls back to a short calendar date once the moment is older than yesterday;
 * the year is appended when it differs from `now`.
 */
export function relativeTime(iso: string | Date, now: Date = new Date()): string {
  const d = toDate(iso);
  const t = d.getTime();
  if (isNaN(t)) return '';
  const diff = now.getTime() - t;
  const abs = Math.abs(diff);
  const future = diff < 0;

  if (abs < MINUTE) return 'just now';
  if (abs < HOUR) {
    const m = Math.round(abs / MINUTE);
    return future ? `in ${m}m` : `${m}m ago`;
  }
  if (abs < DAY) {
    const h = Math.round(abs / HOUR);
    return future ? `in ${h}h` : `${h}h ago`;
  }

  const dayDelta = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (dayDelta === 1) return 'yesterday';
  if (dayDelta === -1) return 'tomorrow';

  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
}

function fmtTime(d: Date, withPeriod: boolean): string {
  const s = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (withPeriod) return s;
  // Strip a trailing AM/PM (and the space before it) for the leading half of a range.
  return s.replace(/\s?[AaPp][Mm]\.?$/, '');
}

function period(d: Date): string {
  const m = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).match(/[AaPp][Mm]\.?$/);
  return m ? m[0] : '';
}

/**
 * "9:00–10:30 AM" when both ends share a period, "11:30 AM–1:00 PM" otherwise.
 * Ranges that span days include a short date on each side.
 */
export function formatTimeRange(startISO: string | Date, endISO: string | Date): string {
  const a = toDate(startISO);
  const b = toDate(endISO);
  if (isNaN(a.getTime())) return '';
  if (isNaN(b.getTime())) return fmtTime(a, true);

  const sameDay = startOfDay(a) === startOfDay(b);
  if (!sameDay) {
    const date = (d: Date) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${date(a)}, ${fmtTime(a, true)} – ${date(b)}, ${fmtTime(b, true)}`;
  }
  const samePeriod = period(a) === period(b);
  return `${fmtTime(a, !samePeriod)}–${fmtTime(b, true)}`;
}

/** Short date for headers: "Tue, Sep 30". */
export function formatShortDate(iso: string | Date): string {
  const d = toDate(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
