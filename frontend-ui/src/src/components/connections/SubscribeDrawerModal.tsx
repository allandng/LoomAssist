// Phase v3.0: SubscribeDrawer — list of remote calendars with checkboxes,
// per-row direction picker, and a target-timeline picker (default: auto-create).
//
// Per design doc §6 Flow B: a slide-over panel from the right (rendered as a
// modal here for the v3 first cut — the visual treatment matches the mockup).

import { useEffect, useState } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useSync } from '../../contexts/SyncContext';
import { useNotifications } from '../../store/notifications';
import { Icon, Icons } from '../shared/Icon';
import { listRemoteCalendars, subscribeCalendar, type RemoteCalendar } from '../../api';
import styles from './connections.module.css';

interface RowState {
  selected:    boolean;
  direction:   'both' | 'pull' | 'push';
}

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

  function setDirection(id: string, direction: 'both' | 'pull' | 'push') {
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

  return (
    <div className={`${styles.shell} ${styles.shellWide}`} role="dialog" aria-modal="true" aria-label="Subscribe to calendars">
      <div className={styles.header}>
        <span className={styles.headerTitle}>Pick what to sync</span>
        <button className={styles.closeBtn} onClick={() => close()}>
          <Icon d={Icons.x} size={14} />
        </button>
      </div>

      <div className={styles.body}>
        {loading && <div style={{ color: 'var(--text-muted)', padding: 24, textAlign: 'center' }}>Fetching your calendars…</div>}
        {err && <div className={styles.errorBox}>{err}</div>}

        {!loading && !err && remotes.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: 24, textAlign: 'center' }}>
            No calendars found on this connection.
          </div>
        )}

        {remotes.map(r => {
          const row = rows[r.id] ?? { selected: false, direction: 'both' as const };
          return (
            <div key={r.id} className={styles.calRow}>
              <button
                type="button"
                className={`${styles.calCheckbox} ${row.selected ? styles.calCheckboxChecked : ''}`}
                onClick={() => toggle(r.id)}
                aria-pressed={row.selected}
              >
                {row.selected && <Icon d={Icons.check} size={10} stroke="white" strokeWidth={2.5} />}
              </button>
              {r.color && <span className={styles.calSwatch} style={{ background: r.color }} />}
              <span className={styles.calName}>{r.display_name}</span>
              <div className={styles.directionPicker}>
                {(['both', 'pull', 'push'] as const).map(d => (
                  <button
                    key={d}
                    className={`${styles.directionPill} ${row.direction === d ? styles.directionPillActive : ''}`}
                    onClick={() => setDirection(r.id, d)}
                    type="button"
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.footer}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {selectedCount} selected
        </span>
        <span className={styles.spacer} />
        <button className="loom-btn-ghost" onClick={() => close()} disabled={busy}>Cancel</button>
        <button
          className="loom-btn-primary"
          onClick={handleSubscribe}
          disabled={busy || selectedCount === 0}
        >
          Subscribe
        </button>
      </div>
    </div>
  );
}
