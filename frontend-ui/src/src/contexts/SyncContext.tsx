// Phase v3.0: SyncContext — owns the connections list, the EventSource on
// /sync/events, and the aggregate review count surfaced in the Calendar
// sidebar's "Pending Review (N)" entry.
//
// Wraps <Shell/> outside the router so route changes don't disconnect the SSE
// stream. EventSource auto-reconnects with a 1.5-second backoff on close.

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  type Connection, type SyncStatus,
  listConnections, getSyncStatus,
  runAllSync, runOneSync,
  pauseConnection, resumeConnection,
  SYNC_EVENTS_URL,
} from '../api';
import { useNotifications } from '../store/notifications';

interface SyncContextValue {
  connections: Connection[];
  statuses:    SyncStatus[];
  reviewCount: number;
  refreshConnections: () => Promise<void>;
  refreshStatuses:    () => Promise<void>;
  runAll:  () => Promise<void>;
  runOne:  (id: string) => Promise<void>;
  pause:   (id: string) => Promise<void>;
  resume:  (id: string) => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [statuses,    setStatuses]    = useState<SyncStatus[]>([]);
  const esRef        = useRef<EventSource | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const { addNotification } = useNotifications();

  // Cache the last connections snapshot inside a ref so the SSE handler can
  // look up display names by id without re-subscribing on every change.
  const connectionsRef = useRef<Connection[]>([]);
  useEffect(() => { connectionsRef.current = connections; }, [connections]);

  const reviewCount = useMemo(
    () => statuses.reduce((acc, s) => acc + (s.pending_review_count || 0), 0),
    [statuses],
  );

  const refreshConnections = useCallback(async () => {
    try { setConnections(await listConnections()); } catch { /* local mode → empty */ }
  }, []);

  const refreshStatuses = useCallback(async () => {
    try { setStatuses(await getSyncStatus()); } catch { /* offline */ }
  }, []);

  // ── Boot fetch ─────────────────────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshConnections();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshStatuses();
  }, [refreshConnections, refreshStatuses]);

  // ── EventSource subscription with backoff ─────────────────────────────────
  useEffect(() => {
    function connect() {
      const es = new EventSource(SYNC_EVENTS_URL);
      esRef.current = es;
      es.onmessage = ev => {
        try {
          const payload = JSON.parse(ev.data);
          // The runner emits {conn_id, phase: 'start'|'done', review_count?, last_synced_at?}.
          // 'done' is the right signal to refresh the cached lists AND post a
          // notification (collapsed under the connection's display name).
          if (payload?.phase === 'done') {
            const conn = connectionsRef.current.find(c => c.id === payload.conn_id);
            const collapseKey = conn?.display_name || payload.conn_id;
            const reviewN = Number(payload.review_count) || 0;
            if (reviewN > 0) {
              addNotification({
                type: 'warning',
                title: `${conn?.display_name ?? 'Sync'} done — ${reviewN} need review`,
                message: 'Open Sync Review to resolve.',
                collapseKey,
                autoRemoveMs: 30_000,
              });
            } else {
              addNotification({
                type: 'info',
                title: `${conn?.display_name ?? 'Sync'} synced`,
                collapseKey,
                autoRemoveMs: 8_000,
              });
            }
            refreshConnections();
            refreshStatuses();
          }
        } catch { /* ignore malformed */ }
      };
      es.onerror = () => {
        es.close();
        esRef.current = null;
        // 1.5s backoff (Guardrail allows 150–250ms transitions; this is a
        // network reconnect, not a UI motion).
        reconnectRef.current = window.setTimeout(connect, 1500);
      };
    }
    connect();
    return () => {
      esRef.current?.close();
      if (reconnectRef.current != null) window.clearTimeout(reconnectRef.current);
    };
  }, [refreshConnections, refreshStatuses, addNotification]);

  // ── Sleep/wake: fire an immediate sync on focus if any connection is stale.
  // Per design doc §11 R8: macOS sleep can leave the in-app data stale at
  // next open; an immediate sync on window focus turns "open the app" into
  // an implicit "sync now" for users with stale state.
  useEffect(() => {
    function onFocus() {
      const STALE_MS = 60_000;
      const stale = connectionsRef.current.some(c => {
        if (c.status !== 'connected') return false;
        if (!c.last_synced_at)        return true;
        const t = new Date(c.last_synced_at).getTime();
        return Date.now() - t > STALE_MS;
      });
      if (stale) {
        runAllSync().catch(() => { /* offline grace — runner will catch next cycle */ });
      }
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const runAll = useCallback(async () => {
    await runAllSync();
    await refreshStatuses();
  }, [refreshStatuses]);

  const runOne = useCallback(async (id: string) => {
    await runOneSync(id);
    await refreshStatuses();
  }, [refreshStatuses]);

  const pause = useCallback(async (id: string) => {
    await pauseConnection(id);
    await Promise.all([refreshConnections(), refreshStatuses()]);
  }, [refreshConnections, refreshStatuses]);

  const resume = useCallback(async (id: string) => {
    await resumeConnection(id);
    await Promise.all([refreshConnections(), refreshStatuses()]);
  }, [refreshConnections, refreshStatuses]);

  const value = useMemo<SyncContextValue>(() => ({
    connections, statuses, reviewCount,
    refreshConnections, refreshStatuses,
    runAll, runOne, pause, resume,
  }), [connections, statuses, reviewCount, refreshConnections, refreshStatuses,
       runAll, runOne, pause, resume]);

  return <SyncContext value={value}>{children}</SyncContext>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside SyncProvider');
  return ctx;
}
