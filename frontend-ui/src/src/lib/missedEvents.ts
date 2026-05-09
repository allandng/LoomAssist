import type { Event } from '../types';

export type MissedButtonState =
  | { visible: false }
  | { visible: true; label: 'Mark as missed' | 'Unmark' };

/**
 * Decides whether the editor footer's mark/unmark button shows for a given
 * event, and which label it carries.
 *
 * Visible iff the event:
 *   - exists (we're editing, not creating)
 *   - is not recurring   (per-occurrence move not supported)
 *   - is not all-day     (no clock-in semantics)
 *   - has already ended  (end_time < now)
 *
 * Synced events (`connection_calendar_id != null`) are intentionally NOT
 * excluded — marking is local-only and safe; only the recovery list
 * (GET /events/missed) excludes synced rows.
 *
 * Label: "Mark as missed" when `missed_at` is null, "Unmark" otherwise.
 */
export function getMissedButtonState(
  event: Event | null | undefined,
  missedAt: string | null,
  now: Date = new Date(),
): MissedButtonState {
  if (!event) return { visible: false };
  if (event.is_recurring) return { visible: false };
  if (event.is_all_day) return { visible: false };
  const end = new Date(event.end_time);
  if (isNaN(end.getTime())) return { visible: false };
  if (end >= now) return { visible: false };
  return { visible: true, label: missedAt ? 'Unmark' : 'Mark as missed' };
}
