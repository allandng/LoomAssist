// Phase v3.0: SyncMergeModal — three-column field-by-field diff per
// mockup-sync-merge.jsx. Field · Local · Incoming · Result preview.
//
// Same-value rows render once spanning Local+Incoming with a "matches" label.
// Differing rows show two DiffCell checkboxes; clicking one picks that side
// for the merge result.
//
// Footer: Approve as new · Replace local · Save merge.
//
// The modal fetches the local event's full payload on mount so the user can
// see both sides at full detail (the SyncReviewItem only carries the incoming
// payload).

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useSync } from '../../contexts/SyncContext';
import { useNotifications } from '../../store/notifications';
import {
  getReviewItem, mergeReview, approveReview, replaceLocalReview,
  type SyncReviewItem,
} from '../../api';
import type { Event as LoomEvent } from '../../types';
import { Icon, Icons } from '../shared/Icon';
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

export function SyncMergeModal({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { close } = useModal();
  const { refreshStatuses } = useSync();
  const { addNotification } = useNotifications();

  const [item,        setItem]        = useState<SyncReviewItem | null>(null);
  const [localEvent,  setLocalEvent]  = useState<Partial<LoomEvent> | null>(null);
  const [picks,       setPicks]       = useState<Record<string, Side>>({});
  const [busy,        setBusy]        = useState(false);
  const [err,         setErr]         = useState<string | null>(null);

  // Boot: fetch the review item + local event side-by-side.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const it = await getReviewItem(itemId);
        if (cancelled) return;
        setItem(it);
        // Default picks: incoming for any field where the values differ
        // (matches the design doc §6 Flow C example).
        const inc = it.incoming_payload as Record<string, unknown>;
        const localId = it.local_event_id;
        let local: Partial<LoomEvent> | null = null;
        if (localId) {
          // Use the existing /events route — fetch the single event id.
          const all = await fetch('http://localhost:8000/events/').then(r => r.json()) as LoomEvent[];
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

  const incoming = (item?.incoming_payload ?? {}) as Record<string, unknown>;

  const result = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const f of MERGE_FIELDS) {
      const lv = (localEvent as Record<string, unknown> | null)?.[f.key];
      const iv = incoming[f.key];
      if (eq(lv, iv)) {
        out[f.key] = lv;
      } else {
        out[f.key] = picks[f.key] === 'local' ? lv : iv;
      }
    }
    // Preserve sync metadata so the runner upserts in place.
    out.external_id   = incoming.external_id;
    out.external_etag = incoming.external_etag;
    out.is_all_day    = incoming.is_all_day;
    return out;
  }, [localEvent, incoming, picks]);

  const handleSave = useCallback(async () => {
    if (!item || busy) return;
    setBusy(true); setErr(null);
    try {
      await mergeReview(item.id, result);
      addNotification({ type: 'success', title: 'Merge saved', autoRemoveMs: 3000 });
      await refreshStatuses();
      onClose(); close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [item, result, busy, addNotification, refreshStatuses, onClose, close]);

  // Keyboard: Esc closes; ↵ saves the merge.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target && (e.target as HTMLElement).matches('input, textarea, [contenteditable]')) return;
      if (e.key === 'Escape')      { e.preventDefault(); onClose(); close(); }
      if (e.key === 'Enter')       { e.preventDefault(); handleSave(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, close, handleSave]);

  const handleApprove = useCallback(async () => {
    if (!item) return;
    setBusy(true); setErr(null);
    try {
      await approveReview(item.id);
      addNotification({ type: 'success', title: 'Approved as new event', autoRemoveMs: 3000 });
      await refreshStatuses();
      onClose(); close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [item, addNotification, refreshStatuses, onClose, close]);

  const handleReplace = useCallback(async () => {
    if (!item) return;
    setBusy(true); setErr(null);
    try {
      await replaceLocalReview(item.id);
      addNotification({ type: 'success', title: 'Replaced local with incoming', autoRemoveMs: 3000 });
      await refreshStatuses();
      onClose(); close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [item, addNotification, refreshStatuses, onClose, close]);

  if (!item) {
    return (
      <div className={styles.shell} style={{ height: 220, justifyContent: 'center', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-muted)' }}>{err ?? 'Loading…'}</span>
      </div>
    );
  }

  return (
    <div className={styles.shell} role="dialog" aria-modal="true" aria-label="Merge events">
      <div className={styles.header}>
        <Icon d={Icons.sync} size={18} stroke="var(--accent)" />
        <div>
          <div className={styles.headerTitle}>Merge events</div>
          <div className={styles.headerSubtitle}>{item.connection_display_name}</div>
        </div>
        <div className={styles.spacer} />
        {item.match_score != null && (
          <span className={`${styles.pill} ${styles.pillWarning}`}>
            {Math.round(item.match_score * 100)}% match
          </span>
        )}
        <button className={styles.closeBtn} onClick={() => { onClose(); close(); }} aria-label="Close">
          <Icon d={Icons.x} size={14} />
        </button>
      </div>

      <div className={styles.colHeaders}>
        <span>Field</span>
        <span>Local</span>
        <span>Incoming</span>
        <span>Result (preview)</span>
      </div>

      <div className={styles.body}>
        {MERGE_FIELDS.map(f => {
          const lv = (localEvent as Record<string, unknown> | null)?.[f.key];
          const iv = incoming[f.key];
          const same = eq(lv, iv);

          if (same) {
            return (
              <div key={f.key} className={styles.row}>
                <span className={styles.fieldName}>{f.label}</span>
                <span className={styles.matchedRow}>
                  <Icon d={Icons.check} size={12} stroke="var(--success)" />
                  {formatVal(lv)} <span className={styles.matchesLabel}>matches</span>
                </span>
                <span className={styles.previewCell}>{formatVal(lv)}</span>
              </div>
            );
          }

          const pickedSide = picks[f.key] ?? 'incoming';
          return (
            <div key={f.key} className={styles.row}>
              <span className={styles.fieldName}>{f.label}</span>
              <DiffCell
                value={lv}
                picked={pickedSide === 'local'}
                onClick={() => setPicks(p => ({ ...p, [f.key]: 'local' }))}
              />
              <DiffCell
                value={iv}
                picked={pickedSide === 'incoming'}
                onClick={() => setPicks(p => ({ ...p, [f.key]: 'incoming' }))}
              />
              <span className={styles.previewCell}>
                {formatVal(pickedSide === 'local' ? lv : iv)}
              </span>
            </div>
          );
        })}
      </div>

      {err && <div className={styles.errorBanner}>{err}</div>}

      <div className={styles.footer}>
        <span className={styles.footerHint}>
          <span className={styles.kbd}>↵</span> save merge ·{' '}
          <span className={styles.kbd}>Esc</span> close
        </span>
        <span className={styles.spacer} />
        <button className="loom-btn-ghost" onClick={handleApprove} disabled={busy}>Approve as new</button>
        <button className="loom-btn-ghost" onClick={handleReplace} disabled={busy}>Replace local</button>
        <button className="loom-btn-primary" onClick={handleSave}    disabled={busy}>
          <Icon d={Icons.check} size={12} /> Save merge
        </button>
      </div>
    </div>
  );
}

function DiffCell({
  value, picked, onClick,
}: {
  value: unknown;
  picked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.diffCell} ${picked ? styles.diffCellPicked : ''}`}
    >
      <span className={`${styles.checkbox} ${picked ? styles.checkboxChecked : ''}`}>
        {picked && <Icon d={Icons.check} size={10} stroke="white" strokeWidth={2.4} />}
      </span>
      <span className={`${styles.diffCellValue} ${value == null || value === '' ? styles.diffCellEmpty : ''}`}>
        {formatVal(value)}
      </span>
    </button>
  );
}
