import { useEffect, useState } from 'react';
import { ModalShell, ModalFooter } from './ModalShell';
import { useModal } from '../../contexts/ModalContext';
import { findFreeSlots } from '../../api';
import type { Event, FreeSlot } from '../../types';

interface Props {
  items: Event[];
  truncated: boolean;
  onReschedule: (event: Event, suggestedStart: string | null, suggestedEnd: string | null) => void;
}

function formatStart(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return `${startIso} – ${endIso}`;
  return `${s.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} – ${e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function eventDurationMinutes(ev: Event): number {
  const ms = new Date(ev.end_time).getTime() - new Date(ev.start_time).getTime();
  if (!isFinite(ms) || ms <= 0) return 60;
  return Math.max(15, Math.round(ms / 60_000));
}

export function MissedEventsModal({ items, truncated, onReschedule }: Props) {
  const { close } = useModal();
  // Per-event suggested slot. `undefined` = still loading; `null` = no slot found.
  const [suggestions, setSuggestions] = useState<Record<number, FreeSlot | null | undefined>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const windowStart = new Date().toISOString();
      const windowEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const results = await Promise.all(items.map(async (ev) => {
        try {
          const { slots } = await findFreeSlots({
            window_start: windowStart,
            window_end: windowEnd,
            duration_minutes: eventDurationMinutes(ev),
          });
          return [ev.id, slots[0] ?? null] as const;
        } catch {
          return [ev.id, null] as const;
        }
      }));
      if (cancelled) return;
      setSuggestions(Object.fromEntries(results));
    })();
    return () => { cancelled = true; };
  }, [items]);

  return (
    <ModalShell title="Missed events" onClose={close}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
        {items.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            Nothing marked as missed.
          </p>
        )}

        {items.map(ev => {
          // Loading iff the id has not been keyed into `suggestions` yet
          // (items prop changed and the async fetch hasn't completed).
          const loading = !(ev.id in suggestions);
          const slot = suggestions[ev.id] ?? null;
          return (
            <div
              key={ev.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '10px 12px', borderRadius: 8,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>{ev.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {formatStart(ev.start_time)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                  You didn&rsquo;t start this.
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
                  {loading
                    ? 'Looking for a free slot…'
                    : slot
                      ? <>Suggested: <span style={{ color: 'var(--text-main)' }}>{formatRange(slot.start, slot.end)}</span></>
                      : 'No free slot in next 7 days'}
                </div>
              </div>
              <button
                className="loom-btn-ghost"
                onClick={() => onReschedule(ev, slot?.start ?? null, slot?.end ?? null)}
                disabled={loading}
                style={{ alignSelf: 'flex-start' }}
              >
                Reschedule
              </button>
            </div>
          );
        })}

        {truncated && (
          <p style={{ color: 'var(--text-dim)', fontSize: 11.5, margin: '4px 0 0', textAlign: 'center' }}>
            …and more
          </p>
        )}
      </div>

      <ModalFooter>
        <div style={{ flex: 1 }} />
        <button className="loom-btn-ghost" onClick={() => close()}>Close</button>
      </ModalFooter>
    </ModalShell>
  );
}
