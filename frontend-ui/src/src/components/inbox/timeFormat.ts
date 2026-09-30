/**
 * Date helpers shared by the Inbox, Journal and Courses surfaces that the
 * shell's `lib/time.ts` does not cover (proposal labels, local YYYY-MM-DD
 * parsing, day headings). `relativeTime` is re-exported from there.
 */

export { relativeTime } from '../../lib/time';

const DAY = 86_400_000;

function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: d.getMinutes() === 0 ? undefined : '2-digit' }).toLowerCase();
}

/** Short proposal label: "Tue 3 pm" (adds the date when more than 6 days out). */
export function formatProposal(startISO: string, now: Date = new Date()): string {
  const s = new Date(startISO);
  if (Number.isNaN(s.getTime())) return '';
  const far = Math.abs(s.getTime() - now.getTime()) > 6 * DAY;
  const day = far
    ? s.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
    : s.toLocaleDateString([], { weekday: 'short' });
  return `${day} ${fmtClock(s)}`;
}

/** Parse a YYYY-MM-DD string as a local date (no UTC shift). */
export function parseLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? '');
  if (!m) {
    const d = new Date(ymd);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Today's date as YYYY-MM-DD in local time. */
export function todayYMD(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** "Today" · "Yesterday" · "Monday, Sep 28" (+ year when it differs). */
export function dayHeading(ymd: string, now: Date = new Date()): string {
  const d = parseLocalDate(ymd);
  if (!d) return ymd;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const delta = Math.round((d.getTime() - startOfToday) / DAY);
  if (delta === 0) return 'Today';
  if (delta === -1) return 'Yesterday';
  if (delta === 1) return 'Tomorrow';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], sameYear
    ? { weekday: 'long', month: 'short', day: 'numeric' }
    : { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}
