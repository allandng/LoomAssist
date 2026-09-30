import { useEffect, useState } from 'react';
import { ModalShell, ModalFooter } from './ModalShell';
import { Button, EmptyState, Icon, Icons } from '../ui';
import { useModal } from '../../contexts/ModalContext';
import { findFreeSlots } from '../../api';
import type { Event, FreeSlot } from '../../types';
import styles from './MissedEventsModal.module.css';

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
    <ModalShell
      title="Missed events"
      subtitle={items.length > 0 ? `${items.length}${truncated ? '+' : ''} event${items.length !== 1 ? 's' : ''} you didn’t start` : undefined}
      size="md"
      onClose={close}
      flush
    >
      {items.length === 0 ? (
        <EmptyState
          icon={Icons.checkCircle}
          title="Nothing marked as missed."
          description="Events you skip show up here with a suggested new time."
        />
      ) : (
        <ul className={styles.list} aria-label="Missed events">
          {items.map(ev => {
            // Loading iff the id has not been keyed into `suggestions` yet
            // (items prop changed and the async fetch hasn't completed).
            const loading = !(ev.id in suggestions);
            const slot = suggestions[ev.id] ?? null;
            return (
              <li key={ev.id} className={styles.item}>
                <div className={styles.itemText}>
                  <div className={styles.itemTitle}>{ev.title}</div>
                  <div className={styles.itemWhen}>
                    <Icon d={Icons.clock} size={11} /> {formatStart(ev.start_time)}
                  </div>
                  <div className={styles.itemReason}>You didn’t start this.</div>
                  <div className={[styles.itemHint, slot ? styles.itemHintSlot : ''].join(' ')}>
                    {loading
                      ? <><Icon d={Icons.loader} size={11} className={styles.spin} /> Looking for a free slot…</>
                      : slot
                        ? <>Suggested: <span className={styles.slot}>{formatRange(slot.start, slot.end)}</span></>
                        : 'No free slot in next 7 days'}
                  </div>
                </div>
                {/* Plain button on purpose: the global class keeps the label as the
                    button's own text node (tests read `.disabled` off it). */}
                <button
                  type="button"
                  className="loom-btn-secondary loom-btn-sm"
                  onClick={() => onReschedule(ev, slot?.start ?? null, slot?.end ?? null)}
                  disabled={loading}
                >
                  Reschedule
                </button>
              </li>
            );
          })}
          {truncated && (
            <li className={styles.more}>…and more</li>
          )}
        </ul>
      )}

      <ModalFooter>
        <Button variant="ghost" onClick={close}>Close</Button>
      </ModalFooter>
    </ModalShell>
  );
}
