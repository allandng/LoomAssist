// SyncMergeModal — three-column field-by-field diff: Field · Local · Incoming
// · Result. Same-value rows render once spanning Local+Incoming with a
// "matches" label. Differing rows show two pickable cells; the chosen side
// feeds the merge result.
//
// Footer: Approve as new · Replace local (left) · Save merge (right, ⌘/Ctrl+↵).
// Escape is handled by ModalShell through the shared escape stack.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ModalShell, ModalFooter, ModalNotice } from './ModalShell';
import { modKey } from './platform';
import { Button, Badge, Skeleton, Icon, Icons } from '../ui';
import { useModal } from '../../contexts/ModalContext';
import { useSync } from '../../contexts/SyncContext';
import { useNotifications } from '../../store/notifications';
import {
  getReviewItem, mergeReview, approveReview, replaceLocalReview, listEvents,
  type SyncReviewItem,
} from '../../api';
import type { Event as LoomEvent } from '../../types';
import styles from './SyncMergeModal.module.css';

const MERGE_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'title',       label: 'Title' },
  { key: 'start_time',  label: 'Start' },
  { key: 'end_time',    label: 'End' },
  { key: 'location',    label: 'Location' },
  { key: 'description', label: 'Description' },
];

type Side = 'local' | 'incoming';

function eq(a: unknown, b: unknown): boolean {
  return (a ?? '') === (b ?? '');
}

function formatVal(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v);
}

export function SyncMergeModal({ itemId }: { itemId: string }) {
  const { close } = useModal();
  const { refreshStatuses } = useSync();
  const { addNotification } = useNotifications();

  const [item,        setItem]        = useState<SyncReviewItem | null>(null);
  const [localEvent,  setLocalEvent]  = useState<Partial<LoomEvent> | null>(null);
  const [picks,       setPicks]       = useState<Record<string, Side>>({});
  const [busy,        setBusy]        = useState<'save' | 'approve' | 'replace' | null>(null);
  const [err,         setErr]         = useState<string | null>(null);

  // Boot: fetch the review item + local event side-by-side.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const it = await getReviewItem(itemId);
        if (cancelled) return;
        setItem(it);
        // Default picks: incoming for any field where the values differ.
        const inc = it.incoming_payload as Record<string, unknown>;
        const localId = it.local_event_id;
        let local: Partial<LoomEvent> | null = null;
        if (localId) {
          const all = await listEvents();
          local = all.find(e => e.id === localId) ?? null;
        }
        if (cancelled) return;
        setLocalEvent(local);
        const initialPicks: Record<string, Side> = {};
        for (const f of MERGE_FIELDS) {
          const lv = (local as Record<string, unknown> | null)?.[f.key];
          const iv = inc[f.key];
          if (!eq(lv, iv)) initialPicks[f.key] = 'incoming';
        }
        setPicks(initialPicks);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [itemId]);

  const incoming = useMemo(
    () => (item?.incoming_payload ?? {}) as Record<string, unknown>,
    [item],
  );

  const result = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const f of MERGE_FIELDS) {
      const lv = (localEvent as Record<string, unknown> | null)?.[f.key];
      const iv = incoming[f.key];
      out[f.key] = eq(lv, iv) ? lv : (picks[f.key] === 'local' ? lv : iv);
    }
    // Preserve sync metadata so the runner upserts in place.
    out.external_id   = incoming.external_id;
    out.external_etag = incoming.external_etag;
    out.is_all_day    = incoming.is_all_day;
    return out;
  }, [localEvent, incoming, picks]);

  const run = useCallback(async (kind: 'save' | 'approve' | 'replace') => {
    if (!item || busy) return;
    setBusy(kind); setErr(null);
    try {
      if (kind === 'save')         { await mergeReview(item.id, result);   addNotification({ type: 'success', title: 'Merge saved', autoRemoveMs: 3000 }); }
      else if (kind === 'approve') { await approveReview(item.id);         addNotification({ type: 'success', title: 'Approved as a new event', autoRemoveMs: 3000 }); }
      else                         { await replaceLocalReview(item.id);    addNotification({ type: 'success', title: 'Local event replaced', autoRemoveMs: 3000 }); }
      await refreshStatuses();
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [item, busy, result, addNotification, refreshStatuses, close]);

  // ⌘/Ctrl+Enter saves the merge (Escape → ModalShell / escape stack).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run('save'); }
  };

  const differing = MERGE_FIELDS.filter(f => !eq((localEvent as Record<string, unknown> | null)?.[f.key], incoming[f.key])).length;

  return (
    <ModalShell
      title="Merge events"
      subtitle={item ? item.connection_display_name : undefined}
      size="xl"
      onClose={close}
      flush
      headerActions={item?.match_score != null ? <Badge tone="warning" dot>{Math.round(item.match_score * 100)}% match</Badge> : undefined}
    >
      <div className={styles.wrap} onKeyDown={onKeyDown}>
        {!item && !err && (
          <div className={styles.loading}>
            {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} height={40} radius={8} />)}
          </div>
        )}

        {err && (
          <div className={styles.errorWrap}>
            <ModalNotice tone="error" icon={<Icon d={Icons.alertCircle} size={13} />}>{err}</ModalNotice>
          </div>
        )}

        {item && (
          <>
            <div className={styles.colHeaders} aria-hidden="true">
              <span>Field</span>
              <span>Local</span>
              <span>Incoming</span>
              <span className={styles.colResult}>Result</span>
            </div>

            <div className={styles.rows} role="table" aria-label="Field differences">
              {MERGE_FIELDS.map(f => {
                const lv = (localEvent as Record<string, unknown> | null)?.[f.key];
                const iv = incoming[f.key];
                const same = eq(lv, iv);

                if (same) {
                  return (
                    <div key={f.key} className={styles.row} role="row">
                      <span className={styles.fieldName} role="rowheader">{f.label}</span>
                      <span className={styles.matchedRow} role="cell">
                        <Icon d={Icons.check} size={12} className={styles.matchIcon} />
                        <span className={styles.matchedVal}>{formatVal(lv)}</span>
                        <span className={styles.matchesLabel}>matches</span>
                      </span>
                      <span className={styles.previewCell} role="cell">{formatVal(lv)}</span>
                    </div>
                  );
                }

                const pickedSide = picks[f.key] ?? 'incoming';
                return (
                  <div key={f.key} className={styles.row} role="row">
                    <span className={styles.fieldName} role="rowheader">{f.label}</span>
                    <DiffCell
                      label={`Use local ${f.label.toLowerCase()}`}
                      value={lv}
                      picked={pickedSide === 'local'}
                      onClick={() => setPicks(p => ({ ...p, [f.key]: 'local' }))}
                    />
                    <DiffCell
                      label={`Use incoming ${f.label.toLowerCase()}`}
                      value={iv}
                      picked={pickedSide === 'incoming'}
                      onClick={() => setPicks(p => ({ ...p, [f.key]: 'incoming' }))}
                    />
                    <span className={styles.previewCell} role="cell">
                      {formatVal(pickedSide === 'local' ? lv : iv)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className={styles.summary}>
              {differing === 0
                ? <Badge tone="success" dot>All fields match</Badge>
                : <Badge tone="neutral" dot>{differing} field{differing !== 1 ? 's' : ''} differ — click a cell to pick a side</Badge>}
            </div>
          </>
        )}
      </div>

      <ModalFooter
        left={item ? (
          <>
            <Button variant="ghost" onClick={() => { void run('approve'); }} disabled={busy !== null} loading={busy === 'approve'}>Approve as new</Button>
            <Button variant="ghost" onClick={() => { void run('replace'); }} disabled={busy !== null} loading={busy === 'replace'}>Replace local</Button>
          </>
        ) : undefined}
      >
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" icon={Icons.check} kbd={`${modKey()}↵`} onClick={() => { void run('save'); }} disabled={!item || busy !== null} loading={busy === 'save'}>
          Save merge
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}

function DiffCell({ value, picked, onClick, label }: { value: unknown; picked: boolean; onClick: () => void; label: string }) {
  const empty = value == null || value === '';
  return (
    <button
      type="button"
      role="cell"
      aria-pressed={picked}
      aria-label={label}
      onClick={onClick}
      className={[styles.diffCell, picked ? styles.diffCellPicked : ''].join(' ')}
    >
      <span className={[styles.pick, picked ? styles.pickOn : ''].join(' ')} aria-hidden="true">
        {picked && <Icon d={Icons.check} size={10} strokeWidth={2.5} />}
      </span>
      <span className={[styles.diffValue, empty ? styles.diffEmpty : ''].join(' ')}>{formatVal(value)}</span>
    </button>
  );
}
