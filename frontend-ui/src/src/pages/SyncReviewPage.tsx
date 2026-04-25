// Phase v3.0: SyncReviewPage — sub-route at /calendar/sync-review.
//
// Per design doc §6 Flow C + mockup-sync-review.jsx: two-pane (420px list +
// preview), grouped by connection then kind. Keyboard: j/k navigate, Enter
// opens merge, r reject.
//
// Empty state: "No items to review" — pin animation friendly to the §11 calm
// tone.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModal } from '../contexts/ModalContext';
import { useSync } from '../contexts/SyncContext';
import { useNotifications } from '../store/notifications';
import { useShortcuts } from '../hooks/useShortcuts';
import {
  type SyncReviewItem,
  listReview, approveReview, replaceLocalReview, rejectReview,
} from '../api';
import { Icon, Icons } from '../components/shared/Icon';
import styles from './SyncReviewPage.module.css';

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric',
                                  hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

function pillFor(kind: SyncReviewItem['kind']): { label: string; cls: string } {
  switch (kind) {
    case 'incoming_duplicate':     return { label: 'Possible duplicate', cls: styles.pillWarning };
    case 'bidirectional_conflict': return { label: 'Two-sided edit',     cls: styles.pillAccent };
    case 'push_rejected':          return { label: 'Push rejected',      cls: styles.pillError };
    default:                       return { label: kind,                 cls: '' };
  }
}

export function SyncReviewPage() {
  const navigate = useNavigate();
  const { addNotification } = useNotifications();
  const { refreshStatuses } = useSync();
  const { openSyncMerge } = useModal();

  const [items, setItems]         = useState<SyncReviewItem[]>([]);
  const [selectedId, setSelected] = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);

  const refresh = useCallback(async () => {
    try {
      const rows = await listReview();
      setItems(rows);
      if (selectedId && !rows.find(r => r.id === selectedId)) setSelected(rows[0]?.id ?? null);
      else if (!selectedId && rows.length > 0)                setSelected(rows[0].id);
    } catch (e) {
      addNotification({ type: 'error', title: 'Failed to load Sync Review', message: e instanceof Error ? e.message : '' });
    }
  }, [addNotification, selectedId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh(); }, [refresh]);

  // Group by connection_display_name → kind for the list pane.
  const groups = useMemo(() => {
    const out: Record<string, SyncReviewItem[]> = {};
    for (const it of items) {
      const key = it.connection_display_name;
      if (!out[key]) out[key] = [];
      out[key].push(it);
    }
    return out;
  }, [items]);

  const selected = useMemo(() => items.find(i => i.id === selectedId) ?? null, [items, selectedId]);

  // ── Keyboard nav (per design doc §9 Phase 3): j/k navigate, Enter merge, r reject. ──
  // Registered through the shared `useShortcuts` hook so the typing guard is consistent.
  useShortcuts(useMemo(() => [
    {
      key: 'j',
      handler: () => {
        if (!items.length) return;
        const idx = items.findIndex(i => i.id === selectedId);
        const next = items[Math.min(idx + 1, items.length - 1)];
        setSelected(next.id);
      },
    },
    {
      key: 'k',
      handler: () => {
        if (!items.length) return;
        const idx = items.findIndex(i => i.id === selectedId);
        const prev = items[Math.max(idx - 1, 0)];
        setSelected(prev.id);
      },
    },
    {
      key: 'Enter',
      handler: () => { if (selected) openSyncMerge(selected.id); },
    },
    {
      key: 'r',
      handler: () => { if (selected) handleReject(selected.id, false); },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [items, selectedId, selected]));

  async function handleApprove(id: string) {
    setBusy(true);
    try {
      await approveReview(id);
      addNotification({ type: 'success', title: 'Approved as new event', autoRemoveMs: 3000 });
      await refresh();
      await refreshStatuses();
    } catch (e) {
      addNotification({ type: 'error', title: 'Approve failed', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  }

  async function handleReplace(id: string) {
    setBusy(true);
    try {
      await replaceLocalReview(id);
      addNotification({ type: 'success', title: 'Replaced local with incoming', autoRemoveMs: 3000 });
      await refresh();
      await refreshStatuses();
    } catch (e) {
      addNotification({ type: 'error', title: 'Replace failed', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(id: string, remember: boolean) {
    setBusy(true);
    try {
      await rejectReview(id, remember);
      addNotification({
        type: 'success',
        title: remember ? 'Rejected and remembered' : 'Rejected',
        autoRemoveMs: 3000,
      });
      await refresh();
      await refreshStatuses();
    } catch (e) {
      addNotification({ type: 'error', title: 'Reject failed', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.listPane}>
          <div className={styles.listHeader}>
            <div className={styles.listHeaderTitleRow}>
              <span className={styles.listHeaderTitle}>Sync Review</span>
              <span className={styles.listHeaderCount}>0 items</span>
            </div>
          </div>
          <div className={styles.previewEmpty} style={{ padding: 28 }}>
            No items to review.
          </div>
        </div>
        <div className={styles.previewEmpty}>
          <p>Sync cycles route ambiguous matches here.</p>
          <p>Trigger a sync from the Sync Center to populate this queue.</p>
          <button
            onClick={() => navigate('/calendar')}
            style={{
              marginTop: 16, padding: '7px 14px', borderRadius: 7,
              background: 'transparent', color: 'var(--accent)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}
          >
            ← Back to Calendar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.listPane}>
        <div className={styles.listHeader}>
          <div className={styles.listHeaderTitleRow}>
            <span className={styles.listHeaderTitle}>Sync Review</span>
            <span className={styles.listHeaderCount}>{items.length} items</span>
          </div>
          <div className={styles.listHeaderHint}>
            Items that need a decision. Use <span className={styles.kbd}>j</span>{' '}
            <span className={styles.kbd}>k</span> to navigate,{' '}
            <span className={styles.kbd}>Enter</span> to merge,{' '}
            <span className={styles.kbd}>r</span> to reject.
          </div>
        </div>
        <div className={styles.listScroll}>
          {Object.entries(groups).map(([groupName, groupItems]) => (
            <div key={groupName}>
              <div className={styles.groupHeader}>
                <Icon d={Icons.sync} size={12} stroke="var(--text-muted)" />
                {groupName} · {groupItems.length}
              </div>
              {groupItems.map(it => {
                const pill = pillFor(it.kind);
                const inc = it.incoming_payload as { title?: string; start_time?: string };
                const score = it.match_score != null ? `${Math.round(it.match_score * 100)}% match` : '';
                return (
                  <div
                    key={it.id}
                    className={`${styles.listItem} ${it.id === selectedId ? styles.listItemSelected : ''}`}
                    onClick={() => setSelected(it.id)}
                  >
                    <div className={styles.listItemTopRow}>
                      <span className={`${styles.listItemPill} ${pill.cls}`}>{pill.label}</span>
                      {score && <span className={styles.listItemScore}>{score}</span>}
                      <span className={styles.listItemTime}>
                        {inc.start_time ? formatTime(inc.start_time) : ''}
                      </span>
                    </div>
                    <div className={styles.listItemRow}>
                      <span className={styles.listItemLabel}>local</span>
                      <span className={styles.listItemValue}>
                        {/* For incoming_duplicate, "local" is the candidate; we don't have the
                            local title in the list payload, so show the local_event_id ref. */}
                        Event #{it.local_event_id ?? '—'}
                      </span>
                    </div>
                    <div className={styles.listItemRow}>
                      <span className={styles.listItemLabel}>incom</span>
                      <span className={styles.listItemValue}>{inc.title ?? '(Untitled)'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className={styles.previewPane}>
          <ReviewPreview
            item={selected}
            busy={busy}
            onMerge={()         => openSyncMerge(selected.id)}
            onApprove={()       => handleApprove(selected.id)}
            onReplace={()       => handleReplace(selected.id)}
            onReject={(remember)=> handleReject(selected.id, remember)}
          />
        </div>
      )}
    </div>
  );
}

function ReviewPreview({
  item, busy, onMerge, onApprove, onReplace, onReject,
}: {
  item: SyncReviewItem;
  busy: boolean;
  onMerge: () => void;
  onApprove: () => void;
  onReplace: () => void;
  onReject: (remember: boolean) => void;
}) {
  const inc  = item.incoming_payload as Record<string, string>;
  const pill = pillFor(item.kind);

  // We don't have the local event payload in the review list — for the preview
  // pane in this iteration we show the incoming side authoritatively and
  // surface the local event by id. The merge modal will fetch both.
  return (
    <>
      <div className={styles.previewHeaderPills}>
        <span className={`${styles.listItemPill} ${pill.cls}`}>{pill.label}</span>
        <span className={`${styles.listItemPill}`}>{item.connection_display_name}</span>
        {item.match_score != null && (
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            {Math.round(item.match_score * 100)}% match
          </span>
        )}
      </div>
      <h2 className={styles.previewTitle}>{inc.title ?? '(Untitled)'}</h2>
      <div className={styles.previewMeta}>
        {inc.start_time ? formatTime(inc.start_time) : ''}
        {inc.location ? ` · ${inc.location}` : ''}
      </div>

      <div className={styles.previewGrid}>
        <PreviewCard heading="Local event" headingClass={styles.previewCardLocal} fields={[
          ['Event id', `#${item.local_event_id ?? '—'}`],
          ['Status',   'Existing on this device'],
        ]} />
        <PreviewCard heading="Incoming" headingClass={styles.previewCardIncoming} fields={[
          ['Title',       inc.title ?? '—'],
          ['Time',        inc.start_time ? `${formatTime(inc.start_time)} → ${inc.end_time ? formatTime(inc.end_time) : ''}` : '—'],
          ['Location',    inc.location ?? '—'],
          ['Description', inc.description ?? '—'],
        ]} />
      </div>

      <h3 className={styles.reasonsHeading}>Why we flagged this</h3>
      <ul className={styles.reasonsList}>
        {item.match_reasons?.map((r, i) => (
          <li key={i}>
            <code style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{r.field}</code>
            {' similarity '}
            {Math.round(r.similarity * 100)}%
          </li>
        ))}
        {!item.match_reasons?.length && <li>No reasoning recorded.</li>}
      </ul>

      <div className={styles.actions}>
        <button className="loom-btn-primary" onClick={onMerge} disabled={busy}>
          <Icon d={Icons.sync} size={12} /> Merge…
        </button>
        <button className="loom-btn-ghost"   onClick={onApprove} disabled={busy}>Approve as new</button>
        <button className="loom-btn-ghost"   onClick={onReplace} disabled={busy}>Replace local</button>
        <span className={styles.spacer} />
        <button className={styles.btnDanger} onClick={() => onReject(true)} disabled={busy}>
          <Icon d={Icons.x} size={12} /> Reject &amp; remember
        </button>
      </div>
    </>
  );
}

function PreviewCard({
  heading, headingClass, fields,
}: {
  heading: string;
  headingClass: string;
  fields: Array<[string, string]>;
}) {
  return (
    <div className={styles.previewCard}>
      <div className={`${styles.previewCardHeading} ${headingClass}`}>{heading}</div>
      {fields.map(([k, v]) => (
        <div key={k} className={styles.previewField}>
          <span className={styles.previewFieldKey}>{k}</span>
          <span className={`${styles.previewFieldVal} ${v === '—' ? styles.previewFieldValEmpty : ''}`}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Calendar sidebar entry: "Pending Review (N)" ─────────────────────────────
//
// Hidden when N === 0 AND no connections exist (so local-only users never see
// it). Imported from CalendarSidebar in CalendarPage.

export function SidebarSyncReviewLink() {
  const navigate = useNavigate();
  const { reviewCount, connections } = useSync();
  if (reviewCount === 0 && connections.length === 0) return null;
  return (
    <button
      onClick={() => navigate('/calendar/sync-review')}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '8px 12px',
        background: reviewCount > 0 ? 'color-mix(in srgb, var(--warning) 12%, transparent)' : 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 12.5, fontWeight: 500,
        color: reviewCount > 0 ? 'var(--warning)' : 'var(--text-main)',
        textAlign: 'left',
      }}
      title="Open Sync Review queue"
    >
      <Icon
        d={Icons.bell}
        size={13}
        stroke={reviewCount > 0 ? 'var(--warning)' : 'var(--text-muted)'}
      />
      <span style={{ flex: 1 }}>Pending Review</span>
      {reviewCount > 0 && (
        <span style={{
          minWidth: 18, height: 16, padding: '0 5px',
          background: 'var(--warning)', color: 'white',
          fontSize: 10.5, fontWeight: 700, borderRadius: 999,
          display: 'grid', placeItems: 'center', lineHeight: 1,
        }}>
          {reviewCount > 99 ? '99+' : reviewCount}
        </span>
      )}
    </button>
  );
}
