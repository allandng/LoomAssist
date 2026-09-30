// SubscribeDrawer — right-side sheet listing remote calendars with a
// checkbox, a per-row direction picker and a subscribe action.

import { useEffect, useState } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useSync } from '../../contexts/SyncContext';
import { useNotifications } from '../../store/notifications';
import { ModalShell, ModalFooter, ModalNotice } from '../modals/ModalShell';
import { Button, Checkbox, Segmented, Skeleton, EmptyState, Icon, Icons } from '../ui';
import { listRemoteCalendars, subscribeCalendar, type RemoteCalendar } from '../../api';
import styles from './connections.module.css';

type Direction = 'both' | 'pull' | 'push';

interface RowState {
  selected:  boolean;
  direction: Direction;
}

const DIRECTIONS = [
  { value: 'both' as Direction, label: 'Both' },
  { value: 'pull' as Direction, label: 'Pull' },
  { value: 'push' as Direction, label: 'Push' },
];

export function SubscribeDrawerModal({ connectionId }: { connectionId: string }) {
  const { close } = useModal();
  const { refreshStatuses } = useSync();
  const { addNotification } = useNotifications();

  const [remotes, setRemotes] = useState<RemoteCalendar[]>([]);
  const [rows,    setRows]    = useState<Record<string, RowState>>({});
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listRemoteCalendars(connectionId);
        if (cancelled) return;
        setRemotes(list);
        const initial: Record<string, RowState> = {};
        for (const c of list) initial[c.id] = { selected: true, direction: 'both' };
        setRows(initial);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [connectionId]);

  function toggle(id: string) {
    setRows(prev => ({ ...prev, [id]: { ...prev[id], selected: !prev[id].selected } }));
  }

  function setDirection(id: string, direction: Direction) {
    setRows(prev => ({ ...prev, [id]: { ...prev[id], direction } }));
  }

  async function handleSubscribe() {
    setBusy(true); setErr(null);
    try {
      const picks = remotes.filter(r => rows[r.id]?.selected);
      for (const r of picks) {
        await subscribeCalendar(connectionId, {
          remote_calendar_id:  r.id,
          remote_display_name: r.display_name,
          remote_color:        r.color ?? null,
          sync_direction:      rows[r.id].direction,
        });
      }
      addNotification({
        type: 'success',
        title: `Subscribed to ${picks.length} ${picks.length === 1 ? 'calendar' : 'calendars'}`,
        autoRemoveMs: 4000,
      });
      await refreshStatuses();
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = Object.values(rows).filter(r => r.selected).length;
  const allSelected = remotes.length > 0 && selectedCount === remotes.length;

  return (
    <ModalShell
      variant="sheet"
      title="Pick what to sync"
      subtitle="Each calendar becomes a timeline. Pull brings events in, push sends yours out."
      onClose={close}
      flush
    >
      <div className={styles.drawerBody}>
        {loading && (
          <div className={styles.skeletons}>
            {[0, 1, 2].map(i => <Skeleton key={i} height={56} radius={8} />)}
          </div>
        )}

        {err && <ModalNotice tone="error" icon={<Icon d={Icons.alertCircle} size={13} />}>{err}</ModalNotice>}

        {!loading && !err && remotes.length === 0 && (
          <EmptyState
            compact
            icon={Icons.calendar}
            title="No calendars found"
            description="This account has no calendars we can read. Check the account in your provider and try again."
          />
        )}

        {!loading && remotes.length > 0 && (
          <>
            <div className={styles.drawerToolbar}>
              <span className={styles.drawerCount}>{selectedCount} of {remotes.length} selected</span>
              <Button
                variant="subtle"
                size="sm"
                onClick={() => setRows(prev => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, selected: !allSelected }])))}
              >
                {allSelected ? 'Clear' : 'Select all'}
              </Button>
            </div>
            <ul className={styles.calList} aria-label="Remote calendars">
              {remotes.map(r => {
                const row = rows[r.id] ?? { selected: false, direction: 'both' as const };
                return (
                  <li key={r.id} className={[styles.calRow, row.selected ? '' : styles.calRowOff].join(' ')}>
                    <Checkbox checked={row.selected} onChange={() => toggle(r.id)} color={r.color ?? undefined} aria-label={`Sync ${r.display_name}`} />
                    {r.color && <span className={styles.calSwatch} style={{ background: r.color }} aria-hidden="true" />}
                    <span className={styles.calName}>{r.display_name}</span>
                    <Segmented
                      size="sm"
                      value={row.direction}
                      options={DIRECTIONS}
                      onChange={d => setDirection(r.id, d)}
                      aria-label={`Sync direction for ${r.display_name}`}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon={Icons.sync} onClick={() => { void handleSubscribe(); }} disabled={busy || selectedCount === 0} loading={busy}>
          Subscribe{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}
