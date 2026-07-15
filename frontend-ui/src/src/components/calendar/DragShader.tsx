import type { EventInput } from '@fullcalendar/core';

export interface DragState {
  id: number;      // numeric event id (kept for callers)
  fcId: string;    // FullCalendar occurrence id of the element being dragged
  start: Date;
  end: Date;
}

export interface SelectRange {
  start: Date;
  end: Date;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return !(aEnd <= bStart || aStart >= bEnd);
}

// Parse an EventInput's start/end (ISO string in our pipeline) to a Date.
function toDate(v: unknown): Date | null {
  if (v == null) return null;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}

function isPrep(occ: EventInput): boolean {
  return !!(occ.extendedProps as { isPrepBlock?: boolean } | undefined)?.isPrepBlock;
}

// WS3 #4 — conflict math runs over the EXPANDED occurrences (fcEvents), not the
// raw stored rows. This makes recurring occurrences visible to the check and,
// because fcEvents is already filtered to visible timelines, automatically
// excludes hidden ones. Prep blocks and the dragged occurrence itself are
// skipped.
function hasConflict(start: Date, end: Date, occs: EventInput[], excludeFcId: string): boolean {
  for (const occ of occs) {
    if (occ.id === excludeFcId) continue;
    if (isPrep(occ)) continue;
    const s = toDate(occ.start);
    const e = toDate(occ.end);
    if (!s || !e) continue;
    if (overlaps(start, end, s, e)) return true;
  }
  return false;
}

function countConflicts(start: Date, end: Date, occs: EventInput[]): number {
  let n = 0;
  for (const occ of occs) {
    if (isPrep(occ)) continue;
    const s = toDate(occ.start);
    const e = toDate(occ.end);
    if (!s || !e) continue;
    if (overlaps(start, end, s, e)) n++;
  }
  return n;
}

/**
 * Injects dynamic styles into the document to tint the FullCalendar drag mirror
 * and highlight cells during event drag OR drag-to-select on empty grid.
 *
 * WS3 #5 ride-along: while an event drag is active we keep the source rendered
 * at reduced opacity (`.loom-drag-source`, class added by CalendarPage) so the
 * user can compare the origin against the new slot.
 *
 * The component returns null — it works purely through a <style> tag so no DOM
 * wrapper is needed.
 */
export function DragShader({
  dragging,
  selectRange,
  fcEvents,
}: {
  dragging: DragState | null;
  selectRange?: SelectRange | null;
  fcEvents: EventInput[];
}) {
  if (!dragging && !selectRange) return null;

  if (dragging) {
    const conflicted = hasConflict(dragging.start, dragging.end, fcEvents, dragging.fcId);
    const mirrorBg   = conflicted ? 'var(--drag-conflict)' : 'var(--drag-free)';
    const mirrorBdr  = conflicted
      ? 'color-mix(in srgb, var(--error) 50%, transparent)'
      : 'color-mix(in srgb, var(--success) 40%, transparent)';
    const hlBg       = conflicted ? 'var(--drag-conflict)' : 'var(--drag-free)';

    return (
      <style>{`
        .fc-event-mirror {
          background-color: ${mirrorBg} !important;
          border-color: ${mirrorBdr} !important;
          opacity: 0.85 !important;
        }
        .fc-highlight {
          background-color: ${hlBg} !important;
        }
        .fc-event.loom-drag-source {
          opacity: 0.4 !important;
          visibility: visible !important;
        }
      `}</style>
    );
  }

  // Drag-to-select on empty grid — count conflicts to set tint + left edge.
  const n = selectRange ? countConflicts(selectRange.start, selectRange.end, fcEvents) : 0;
  const hlBg     = n > 0 ? 'var(--drag-conflict)' : 'var(--drag-free)';
  const leftEdge = n > 0 ? '2px solid var(--warning)' : '2px solid transparent';
  return (
    <style>{`
      .fc-highlight {
        background-color: ${hlBg} !important;
        border-left: ${leftEdge} !important;
      }
    `}</style>
  );
}
