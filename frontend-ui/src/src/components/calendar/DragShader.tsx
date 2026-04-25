import type { Event } from '../../types';

export interface DragState {
  id: number;
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

/**
 * Injects dynamic styles into the document to tint the FullCalendar drag mirror
 * and highlight cells during event drag. The component returns null — it works
 * purely through a <style> tag so no DOM wrapper is needed.
 */
export function DragShader({ dragging, events }: { dragging: DragState | null; events: Event[] }) {
  if (!dragging) return null;

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
