import type { Event } from '../../types';

export interface DragState {
  id: number;
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

function hasConflict(start: Date, end: Date, events: Event[], excludeId: number): boolean {
  for (const ev of events) {
    if (ev.id === excludeId) continue;
    try {
      const evStart = new Date(ev.start_time);
      const evEnd   = new Date(ev.end_time);
      if (overlaps(start, end, evStart, evEnd)) return true;
    } catch {
      // ignore unparseable events
    }
  }
  return false;
}

function countConflicts(start: Date, end: Date, events: Event[]): number {
  let n = 0;
  for (const ev of events) {
    try {
      const evStart = new Date(ev.start_time);
      const evEnd   = new Date(ev.end_time);
      if (overlaps(start, end, evStart, evEnd)) n++;
    } catch { /* skip */ }
  }
  return n;
}

/**
 * Injects dynamic styles into the document to tint the FullCalendar drag mirror
 * and highlight cells during event drag OR drag-to-select on empty grid.
 *
 * Phase v3.0 §8 ride-along #2: when drag-to-select overlaps existing events,
 * the highlight gains a 2px --warning left edge so the user sees the conflict
 * before the (eventual) Quick Create popover appears.
 *
 * The component returns null — it works purely through a <style> tag so no DOM
 * wrapper is needed.
 */
export function DragShader({
  dragging,
  selectRange,
  events,
}: {
  dragging: DragState | null;
  selectRange?: SelectRange | null;
  events: Event[];
}) {
  if (!dragging && !selectRange) return null;

  if (dragging) {
    const conflicted = hasConflict(dragging.start, dragging.end, events, dragging.id);
    const mirrorBg   = conflicted ? 'var(--drag-conflict)' : 'var(--drag-free)';
    const mirrorBdr  = conflicted ? 'rgba(248,113,113,0.5)' : 'rgba(74,222,128,0.4)';
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
      `}</style>
    );
  }

  // Drag-to-select on empty grid — count conflicts to set tint + left edge.
  const n = selectRange ? countConflicts(selectRange.start, selectRange.end, events) : 0;
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
