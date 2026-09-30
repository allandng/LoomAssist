// Sync review — /calendar/sync-review.
//
// Two panes: a list of items that need a decision (grouped by connection) and
// a detail pane with the local vs. incoming comparison and the actions.
// Keyboard (only while the page has focus): J/K move, Enter merges, A approves,
// L replaces local, R rejects, Shift+R rejects and remembers.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModal } from '../contexts/ModalContext';
import { useSync } from '../contexts/SyncContext';
import { useNotifications } from '../store/notifications';
import {
  type SyncReviewItem,
  listReview, approveReview, replaceLocalReview, rejectReview, listEvents,
} from '../api';
import type { Event } from '../types';
import { Page, Badge, Button, Kbd, Skeleton, EmptyState, Icon, Icons, type BadgeTone } from '../components/ui';
import { errMessage } from '../components/settings/util';
import styles from './SyncReviewPage.module.css';

function formatTime(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function kindMeta(kind: SyncReviewItem['kind']): { label: string; tone: BadgeTone } {
  switch (kind) {
    case 'incoming_duplicate':     return { label: 'Possible duplicate', tone: 'warning' };
    case 'bidirectional_conflict': return { label: 'Edited on both sides', tone: 'accent' };
    case 'push_rejected':          return { label: 'Push rejected', tone: 'error' };
    default:                       return { label: String(kind), tone: 'neutral' };
  }
}

type Incoming = { title?: string; start_time?: string; end_time?: string; location?: string; description?: string };

export function SyncReviewPage() {
  const navigate = useNavigate();
  const { addNotification } = useNotifications();
  const { refreshStatuses } = useSync();
  const { openSyncMerge } = useModal();

  const [items, setItems]         = useState<SyncReviewItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localEvents, setLocalEvents] = useState<Map<number, Event>>(() => new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await listReview();
      setItems(rows);
      setLoadError(null);
      setSelectedId(prev => (prev && rows.some(r => r.id === prev) ? prev : rows[0]?.id ?? null));
    } catch (e) {
      setItems([]);
      setLoadError(errMessage(e, 'Could not load the review queue.'));
    }
  }, []);

  // Boot-time fetch; state is set inside the async path, not synchronously.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh(); }, [refresh]);

  // Local titles: one fetch, mapped by id, so rows can name the local event.
  useEffect(() => {
    let cancelled = false;
    listEvents()
      .then(evs => { if (!cancelled) setLocalEvents(new Map(evs.map(e => [e.id, e]))); })
      .catch(() => { /* rows fall back to the id */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { rootRef.current?.focus({ preventScroll: true }); }, []);

  const groups = useMemo(() => {
    const out = new Map<string, SyncReviewItem[]>();
    for (const it of items ?? []) {
      const list = out.get(it.connection_display_name) ?? [];
      list.push(it);
      out.set(it.connection_display_name, list);
    }
    return [...out.entries()];
  }, [items]);

  const selected = useMemo(() => items?.find(i => i.id === selectedId) ?? null, [items, selectedId]);
  const localFor = (it: SyncReviewItem | null): Event | undefined =>
    it?.local_event_id != null ? localEvents.get(it.local_event_id) : undefined;

  function move(delta: number) {
    if (!items?.length) return;
    const idx = items.findIndex(i => i.id === selectedId);
    const next = items[Math.min(items.length - 1, Math.max(0, idx + delta))];
    setSelectedId(next.id);
    document.getElementById(`review-row-${next.id}`)?.scrollIntoView({ block: 'nearest' });
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      addNotification({ type: 'success', title: label, autoRemoveMs: 3000 });
      await refresh();
      await refreshStatuses();
    } catch (e) {
      addNotification({ type: 'error', title: `${label} failed`, message: errMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const approve = (id: string) => run('Approved as a new event', () => approveReview(id));
  const replace = (id: string) => run('Replaced the local event', () => replaceLocalReview(id));
  const reject  = (id: string, remember: boolean) =>
    run(remember ? 'Rejected and remembered' : 'Rejected', () => rejectReview(id, remember));

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'j' || k === 'arrowdown') { e.preventDefault(); move(1); return; }
    if (k === 'k' || k === 'arrowup')   { e.preventDefault(); move(-1); return; }
    if (!selected || busy) return;
    if (k === 'enter' && tag !== 'BUTTON') { e.preventDefault(); openSyncMerge(selected.id); }
    else if (k === 'a') { e.preventDefault(); approve(selected.id); }
    else if (k === 'l') { e.preventDefault(); replace(selected.id); }
    else if (k === 'r') { e.preventDefault(); reject(selected.id, e.shiftKey); }
  }

  const loading = items === null;
  const count = items?.length ?? 0;

  return (
    <Page bare>
      <div ref={rootRef} className={styles.root} tabIndex={0} onKeyDown={onKeyDown} aria-label="Sync review">
        <aside className={styles.list} aria-label="Items to review">
          <header className={styles.listHeader}>
            <div className={styles.listTitleRow}>
              <h1 className={styles.listTitle}>Sync review</h1>
              {!loading && <Badge tone={count > 0 ? 'warning' : 'neutral'}>{count === 1 ? '1 item' : `${count} items`}</Badge>}
            </div>
            <p className={styles.listHint}>
              <Kbd small>J</Kbd> <Kbd small>K</Kbd> move · <Kbd small>↵</Kbd> merge · <Kbd small>R</Kbd> reject
            </p>
          </header>

          <div className={styles.listScroll} role="listbox" aria-label="Review queue" aria-busy={loading}>
            {loading && (
              <div className={styles.skeletonList}>
                {[0, 1, 2].map(i => (
                  <div key={i} className={styles.skeletonRow}>
                    <Skeleton width="40%" height={12} />
                    <Skeleton width="85%" />
                    <Skeleton width="65%" />
                  </div>
                ))}
              </div>
            )}
            {!loading && loadError && (
              <div className={styles.inlineError} role="alert">
                <Icon d={Icons.alertCircle} size={14} />
                <span>{loadError}</span>
                <Button size="sm" variant="ghost" onClick={refresh}>Retry</Button>
              </div>
            )}
            {!loading && !loadError && count === 0 && (
              <p className={styles.listEmpty}>Nothing waiting for a decision.</p>
            )}
            {groups.map(([group, groupItems]) => (
              <section key={group} className={styles.group} aria-label={group}>
                <div className={styles.groupHeader}>
                  <Icon d={Icons.sync} size={12} />
                  <span className={styles.groupName}>{group}</span>
                  <span className={styles.groupCount}>{groupItems.length}</span>
                </div>
                {groupItems.map(it => {
                  const meta = kindMeta(it.kind);
                  const inc = it.incoming_payload as Incoming;
                  const local = localFor(it);
                  const active = it.id === selectedId;
                  return (
                    <button
                      key={it.id}
                      id={`review-row-${it.id}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      tabIndex={-1}
                      className={`${styles.row} ${active ? styles.rowActive : ''}`}
                      onClick={() => setSelectedId(it.id)}
                    >
                      <div className={styles.rowTop}>
                        <Badge tone={meta.tone} size="sm">{meta.label}</Badge>
                        {it.match_score != null && <span className={styles.rowScore}>{Math.round(it.match_score * 100)}% match</span>}
                        <span className={styles.rowTime}>{formatTime(inc.start_time)}</span>
                      </div>
                      <dl className={styles.rowPairs}>
                        <dt>Local</dt>
                        <dd className={local ? '' : styles.rowDim}>{local?.title ?? (it.local_event_id != null ? `Event #${it.local_event_id}` : 'No local match')}</dd>
                        <dt>Incoming</dt>
                        <dd>{inc.title || 'Untitled'}</dd>
                      </dl>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        </aside>

        <section className={styles.detail} aria-label="Selected item">
          {loading && (
            <div className={styles.detailSkeleton} aria-busy="true">
              <Skeleton width={140} height={20} />
              <Skeleton width="60%" height={24} />
              <Skeleton width="40%" />
              <div className={styles.compare}>
                <Skeleton width="100%" height={140} radius={12} />
                <Skeleton width="100%" height={140} radius={12} />
              </div>
            </div>
          )}
          {!loading && !selected && (
            <EmptyState
              icon={Icons.checkCircle}
              title="Nothing to review"
              description="Ambiguous matches from a sync land here. Run a sync from the sync center to check again."
              action={{ label: 'Back to calendar', icon: Icons.arrowLeft, onClick: () => navigate('/calendar') }}
            />
          )}
          {!loading && selected && (
            <ReviewDetail
              item={selected}
              local={localFor(selected)}
              busy={busy}
              onMerge={() => openSyncMerge(selected.id)}
              onApprove={() => approve(selected.id)}
              onReplace={() => replace(selected.id)}
              onReject={remember => reject(selected.id, remember)}
            />
          )}
        </section>
      </div>
    </Page>
  );
}

function ReviewDetail({
  item, local, busy, onMerge, onApprove, onReplace, onReject,
}: {
  item: SyncReviewItem;
  local: Event | undefined;
  busy: boolean;
  onMerge: () => void;
  onApprove: () => void;
  onReplace: () => void;
  onReject: (remember: boolean) => void;
}) {
  const inc = item.incoming_payload as Incoming;
  const meta = kindMeta(item.kind);

  return (
    <div className={styles.detailInner}>
      <div className={styles.detailBadges}>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <Badge tone="neutral" outline>{item.connection_display_name}</Badge>
        {item.match_score != null && <span className={styles.detailScore}>{Math.round(item.match_score * 100)}% match</span>}
      </div>
      <h2 className={styles.detailTitle}>{inc.title || 'Untitled'}</h2>
      <p className={styles.detailMeta}>
        {formatTime(inc.start_time)}
        {inc.location ? ` · ${inc.location}` : ''}
      </p>

      <div className={styles.compare}>
        <CompareCard
          heading="On this device"
          tone="local"
          fields={local ? [
            ['Title', local.title],
            ['Time', `${formatTime(local.start_time)} → ${formatTime(local.end_time)}`],
            ['Location', local.location ?? ''],
            ['Description', local.description ?? ''],
          ] : [
            ['Event', item.local_event_id != null ? `#${item.local_event_id} (not loaded)` : 'No matching local event'],
          ]}
        />
        <CompareCard
          heading="Incoming"
          tone="incoming"
          fields={[
            ['Title', inc.title ?? ''],
            ['Time', inc.start_time ? `${formatTime(inc.start_time)} → ${formatTime(inc.end_time)}` : ''],
            ['Location', inc.location ?? ''],
            ['Description', inc.description ?? ''],
          ]}
        />
      </div>

      <h3 className={styles.reasonsHeading}>Why it was flagged</h3>
      {item.match_reasons?.length ? (
        <ul className={styles.reasons}>
          {item.match_reasons.map((r, i) => (
            <li key={i}>
              <code className={styles.code}>{r.field}</code> {Math.round(r.similarity * 100)}% similar
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.reasonsEmpty}>No reasoning recorded.</p>
      )}

      <div className={styles.actions}>
        <Button variant="primary" icon={Icons.sync} kbd="↵" disabled={busy} onClick={onMerge}>Merge…</Button>
        <Button variant="secondary" kbd="A" disabled={busy} onClick={onApprove}>Approve as new</Button>
        <Button variant="secondary" kbd="L" disabled={busy} onClick={onReplace}>Replace local</Button>
        <span className={styles.spacer} />
        <Button variant="ghost" kbd="R" disabled={busy} onClick={() => onReject(false)}>Reject</Button>
        <Button variant="danger" kbd="⇧R" disabled={busy} onClick={() => onReject(true)}>Reject &amp; remember</Button>
      </div>
    </div>
  );
}

function CompareCard({ heading, tone, fields }: { heading: string; tone: 'local' | 'incoming'; fields: Array<[string, string]> }) {
  return (
    <div className={styles.compareCard}>
      <div className={`${styles.compareHeading} ${tone === 'local' ? styles.compareLocal : styles.compareIncoming}`}>{heading}</div>
      <dl className={styles.fields}>
        {fields.map(([k, v]) => (
          <div key={k} className={styles.field}>
            <dt>{k}</dt>
            <dd className={v ? '' : styles.fieldEmpty}>{v || '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
