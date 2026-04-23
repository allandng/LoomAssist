import type { EventInput } from '@fullcalendar/core';
import type { Event, Calendar } from '../types';

/** Build a CSS color for a FullCalendar event based on its timeline. */
export function timelineColor(timelines: Calendar[], calendarId: number): string {
  return timelines.find(t => t.id === calendarId)?.color ?? '#6366F1';
}

/** Resolve the title for a specific occurrence (unique_description has per-occurrence notes, not title overrides — so title is always event.title). */
export function occurrenceTitle(event: Event): string {
  return event.title;
}

/** Parse per_day_times JSON silently, returns {} on malformed input. */
export function parsePerDayTimes(raw: string): Record<number, { start: string; end: string }> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/** Parse checklist JSON silently. */
export function parseChecklist(raw: string): Array<{ text: string; done: boolean }> {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

/** Parse comma-sep YYYY-MM-DD skipped_dates. */
function parseSkipped(raw: string): Set<string> {
  return new Set(raw ? raw.split(',').filter(Boolean) : []);
}

/** Advance a Date by one day in place. */
function addDay(d: Date): void {
  d.setDate(d.getDate() + 1);
}

/** Format Date as YYYY-MM-DD. */
function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

/**
 * Convert a backend Event into one or more FullCalendar EventInput objects.
 * Handles all-day, recurring (including per-day times + skipped dates), and regular events.
 */
export function toFCEvents(event: Event, timelines: Calendar[]): EventInput[] {
  const color = timelineColor(timelines, event.calendar_id);

  const base: Partial<EventInput> = {
    title: event.title,
    extendedProps: { event },
    backgroundColor: `${color}22`,
    borderColor: color,
    textColor: color,
    classNames: ['loom-event'],
  };

  // Non-recurring
  if (!event.is_recurring) {
    if (event.is_all_day) {
      return [{
        ...base,
        id: String(event.id),
        start: event.start_time.split('T')[0],
        allDay: true,
        backgroundColor: color,
        textColor: '#fff',
        borderColor: color,
      }];
    }
    return [{
      ...base,
      id: String(event.id),
      start: event.start_time,
      end: event.end_time,
    }];
  }

  // Recurring
  const days = event.recurrence_days
    ? event.recurrence_days.split(',').map(Number).filter(n => !isNaN(n))
    : [];
  if (days.length === 0) return [];

  const skipped = parseSkipped(event.skipped_dates);
  const perDay = parsePerDayTimes(event.per_day_times);
  const maxDate = event.recurrence_end ? new Date(event.recurrence_end + 'T23:59:59') : null;

  const startDT = new Date(event.start_time);
  const endDT   = new Date(event.end_time);
  const durationMs = endDT.getTime() - startDT.getTime();

  const fallback = new Date(startDT);
  fallback.setFullYear(fallback.getFullYear() + 1);
  const limit = maxDate ?? fallback;

  const results: EventInput[] = [];
  const cursor = new Date(startDT);
  cursor.setHours(0, 0, 0, 0);

  // Start from the event's actual start date
  const originDate = new Date(startDT);
  originDate.setHours(0, 0, 0, 0);

  while (cursor <= limit) {
    const dow = cursor.getDay();
    if (days.includes(dow) && cursor >= originDate) {
      const dateStr = toDateStr(cursor);
      if (!skipped.has(dateStr)) {
        const dayTimes = perDay[dow];
        let occStart: Date, occEnd: Date;

        if (dayTimes) {
          const [sh, sm] = dayTimes.start.split(':').map(Number);
          const [eh, em] = dayTimes.end.split(':').map(Number);
          occStart = new Date(cursor);
          occStart.setHours(sh, sm, 0, 0);
          occEnd = new Date(cursor);
          occEnd.setHours(eh, em, 0, 0);
        } else {
          occStart = new Date(cursor);
          occStart.setHours(startDT.getHours(), startDT.getMinutes(), 0, 0);
          occEnd = new Date(occStart.getTime() + durationMs);
        }

        results.push({
          ...base,
          id: `${event.id}_${dateStr}`,
          start: occStart.toISOString(),
          end: occEnd.toISOString(),
          extendedProps: { event, instanceDate: dateStr },
        });
      }
    }
    addDay(cursor);
  }

  return results;
}

/** Convert all events to FullCalendar format, skipping hidden timelines. */
export function buildFCEvents(
  events: Event[],
  timelines: Calendar[],
  hiddenIds: Set<number>,
  activeFilters: Set<string>,
): EventInput[] {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  return events
    .filter(ev => !hiddenIds.has(ev.calendar_id))
    .filter(ev => {
      if (activeFilters.has('checklist') && !ev.checklist) return false;
      if (activeFilters.has('recurring') && !ev.is_recurring) return false;
      if (activeFilters.has('thisweek')) {
        const start = new Date(ev.start_time);
        if (start < weekStart || start >= weekEnd) return false;
      }
      return true;
    })
    .flatMap(ev => toFCEvents(ev, timelines));
}

/** Render description with @mention and link highlighting (returns HTML string). */
export function renderDescription(desc: string): string {
  if (!desc) return '';
  // @[EventName] mentions
  let html = desc.replace(/@\[([^\]]+)\]/g, (_, name) =>
    `<mark class="loom-mention">@${name}</mark>`
  );
  // [Link Text](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (_, text, url) =>
    `<a href="${url}" target="_blank" rel="noopener">${text}</a>`
  );
  // bare https?:// URLs
  html = html.replace(/(https?:\/\/[^\s<>"]+)/g, (_, url) =>
    `<a href="${url}" target="_blank" rel="noopener">${url}</a>`
  );
  return html;
}

/** Human-readable time elapsed since a Date. */
export function relativeTime(since: Date): string {
  const secs = Math.floor((Date.now() - since.getTime()) / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}
