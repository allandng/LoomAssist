// Disconnect confirmation with a per-timeline choice.
//
// The shared `confirm()` primitive takes only title/description, so this small
// dialog owns the "keep local / delete synced events" decision per timeline and
// hands back the DisconnectTimelineDecision[] the backend expects.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Select, Icon, Icons, TLDot } from '../ui';
import type { DisconnectTimelineDecision } from '../../api';
import { pushEscapeHandler } from '../../lib/escapeStack';
import styles from './DisconnectDialog.module.css';

export interface DisconnectTimeline {
  id: number;
  name: string;
  color?: string;
  eventHint?: string; // e.g. "3 calendars" — optional descriptive line
}

interface Props {
  connectionName: string;
  timelines: DisconnectTimeline[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (decisions: DisconnectTimelineDecision[]) => void;
}

type Strategy = 'keep' | 'delete';

export function DisconnectDialog({ connectionName, timelines, busy, onCancel, onConfirm }: Props) {
  const [choices, setChoices] = useState<Record<number, Strategy>>(() =>
    Object.fromEntries(timelines.map(t => [t.id, 'keep' as Strategy])));
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [invoker] = useState<HTMLElement | null>(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    const pop = pushEscapeHandler(onCancel);
    cancelRef.current?.focus();
    return () => {
      pop();
      if (invoker && document.contains(invoker)) invoker.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deleting = Object.values(choices).filter(s => s === 'delete').length;

  function submit() {
    onConfirm(timelines.map(t => ({ local_calendar_id: t.id, strategy: choices[t.id] ?? 'keep' })));
  }

  return createPortal(
    <div className={styles.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={styles.panel} role="alertdialog" aria-modal="true" aria-labelledby="disconnect-title" aria-describedby="disconnect-desc">
        <div className={styles.body}>
          <div className={styles.icon} aria-hidden="true"><Icon d={Icons.warning} size={18} /></div>
          <div className={styles.text}>
            <h2 id="disconnect-title" className={styles.title}>Disconnect {connectionName}?</h2>
            <p id="disconnect-desc" className={styles.desc}>
              Syncing stops and the sign-in is removed from this device. Events on the provider are never modified.
              Choose what happens to each timeline that came from this connection.
            </p>
            {timelines.length === 0 ? (
              <p className={styles.empty}>No timelines are linked to this connection.</p>
            ) : (
              <ul className={styles.list}>
                {timelines.map(t => (
                  <li key={t.id} className={styles.row}>
                    <span className={styles.rowMain}>
                      <TLDot color={t.color ?? 'var(--accent)'} />
                      <span className={styles.rowName}>{t.name}</span>
                      {t.eventHint && <span className={styles.rowHint}>{t.eventHint}</span>}
                    </span>
                    <Select
                      size="sm"
                      aria-label={`What to do with ${t.name}`}
                      className={styles.select}
                      value={choices[t.id] ?? 'keep'}
                      onChange={e => setChoices(c => ({ ...c, [t.id]: e.target.value as Strategy }))}
                    >
                      <option value="keep">Keep events on this device</option>
                      <option value="delete">Delete the synced events</option>
                    </Select>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className={styles.footer}>
          {deleting > 0 && <span className={styles.warn}>{deleting === 1 ? '1 timeline' : `${deleting} timelines`} will be deleted</span>}
          <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={submit} loading={busy}>Disconnect</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
