import { useEffect, useRef } from 'react';
import type { Event } from '../types';
import { isMuted, wasPrompted } from '../lib/takeawayDismissals';

const CLASS_TYPES = new Set(['lecture', 'lab', 'office_hours']);
const LOOK_AHEAD_MS = 24 * 60 * 60 * 1000;

export interface EndedOccurrence {
  event: Event;
  occurrenceDate: string;       // YYYY-MM-DD of the day the occurrence ended
  endedAt: Date;
}

type Callback = (occ: EndedOccurrence) => void;

interface ScheduledTimer {
  timeoutId: ReturnType<typeof setTimeout>;
  occurrenceDate: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Find the next occurrence end-time for an event within [now, now + LOOK_AHEAD_MS].
 *  Returns null if none. Handles single + recurring events. */
function findNextEndWithin(event: Event, now: Date, horizon: Date): { endDate: Date; occurrenceDate: string } | null {
  if (!event.end_time) return null;

  if (!event.is_recurring) {
    const endDate = new Date(event.end_time);
    if (endDate >= now && endDate <= horizon) {
      return { endDate, occurrenceDate: toDateStr(new Date(event.start_time)) };
    }
    return null;
  }

  const days = event.recurrence_days
    ? event.recurrence_days.split(',').map(Number).filter((n) => !Number.isNaN(n))
    : [];
  if (days.length === 0) return null;

  const startDT = new Date(event.start_time);
  const endDT = new Date(event.end_time);
  const durationMs = endDT.getTime() - startDT.getTime();
  const recurrenceEnd = event.recurrence_end ? new Date(event.recurrence_end + 'T23:59:59') : null;

  const skipped = new Set<string>(
    (event.skipped_dates ? event.skipped_dates.split(',') : []).map((s) => s.trim()).filter(Boolean),
  );

  let perDay: Record<number, { start: string; end: string }> = {};
  if (event.per_day_times) {
    try {
      perDay = JSON.parse(event.per_day_times) ?? {};
    } catch {
      perDay = {};
    }
  }

  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  const limitDay = new Date(horizon);
  limitDay.setHours(23, 59, 59, 999);

  while (cursor <= limitDay) {
    if (recurrenceEnd && cursor > recurrenceEnd) break;
    const dow = cursor.getDay();
    if (days.includes(dow)) {
      const dateStr = toDateStr(cursor);
      if (!skipped.has(dateStr)) {
        const dayTimes = perDay[dow];
        let occEnd: Date;
        if (dayTimes) {
          const [eh, em] = dayTimes.end.split(':').map(Number);
          occEnd = new Date(cursor);
          occEnd.setHours(eh, em, 0, 0);
        } else {
          const occStart = new Date(cursor);
          occStart.setHours(startDT.getHours(), startDT.getMinutes(), 0, 0);
          occEnd = new Date(occStart.getTime() + durationMs);
        }
        if (occEnd >= now && occEnd <= horizon) {
          return { endDate: occEnd, occurrenceDate: dateStr };
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}

/** Schedule a per-event timer that fires when a class-type event ends.
 *  Mirrors the per-event setTimeout pattern of useReminders. Skips events
 *  the user has already been prompted for or muted. */
export function useEventEndPrompts(events: Event[], onEnded: Callback) {
  const callbackRef = useRef(onEnded);

  useEffect(() => {
    callbackRef.current = onEnded;
  }, [onEnded]);

  const timersRef = useRef<Record<number, ScheduledTimer>>({});

  useEffect(() => {
    Object.values(timersRef.current).forEach((t) => clearTimeout(t.timeoutId));
    timersRef.current = {};

    const now = new Date();
    const horizon = new Date(now.getTime() + LOOK_AHEAD_MS);

    for (const ev of events) {
      if (!ev.event_type || !CLASS_TYPES.has(ev.event_type)) continue;
      if (isMuted(ev.id)) continue;

      const next = findNextEndWithin(ev, now, horizon);
      if (!next) continue;
      if (wasPrompted(ev.id, next.occurrenceDate)) continue;

      const delta = next.endDate.getTime() - now.getTime();
      if (delta < -60_000) continue; // ended > 60s ago — skip
      const captured = ev;
      const occurrenceDate = next.occurrenceDate;
      const endedAt = next.endDate;

      const fire = () => {
        callbackRef.current({ event: captured, occurrenceDate, endedAt });
      };

      if (delta <= 0) {
        // Just ended (within last 60s) — fire on next tick
        timersRef.current[ev.id] = {
          timeoutId: setTimeout(fire, 0),
          occurrenceDate,
        };
      } else {
        timersRef.current[ev.id] = {
          timeoutId: setTimeout(fire, delta),
          occurrenceDate,
        };
      }
    }

    return () => {
      Object.values(timersRef.current).forEach((t) => clearTimeout(t.timeoutId));
    };
  }, [events]);
}
