import {
  createContext, useContext, useReducer, useCallback, useMemo, useState, useEffect,
  type ReactNode,
} from 'react';

/**
 * WS7 — severity gating.
 *  - 'ambient'   : sync-phase noise / boot briefing. Never increments the bell
 *                  badge and auto-removes (defaults to a short TTL if the caller
 *                  didn't set one).
 *  - 'standard'  : default. Counts toward the badge until read.
 *  - 'important' : crash flags, "weekly review ready". Counts toward the badge
 *                  AND persists to localStorage so it survives a restart.
 */
export type Severity = 'ambient' | 'standard' | 'important';

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'progress';
  title: string;
  message?: string;
  timestamp: Date;
  read: boolean;
  dismissible?: boolean;
  actionable?: boolean;
  actionLabel?: string;
  actionFn?: () => void | Promise<void>;
  progress?: number;       // 0-100 for progress type
  autoRemoveMs?: number;
  severity?: Severity;
  // Phase v3.0 §8 ride-along #5: identical collapseKey across N notifications
  // collapses them in the bell panel into a single row. Useful for noisy
  // sources (e.g. several Google sync cycles in an hour). Optional.
  collapseKey?: string;
  // Aggregate count when this notification represents a collapsed group.
  // Set automatically by the reducer; consumers should not pass this.
  collapsedCount?: number;
  // WS7 #3 — the individual notifications folded into a summary row. Kept so
  // the panel can expand the group and act on / dismiss each child, rather than
  // silently discarding earlier items. Set automatically by the reducer.
  collapsedChildren?: Notification[];
}

type AddPayload = Omit<Notification, 'id' | 'timestamp' | 'read'>;
type UpdatePayload = Partial<Omit<Notification, 'id' | 'timestamp'>>;

export type { AddPayload };

type Action =
  | { type: 'add';         notif: Notification }
  | { type: 'update';      id: string; patch: UpdatePayload }
  | { type: 'dismiss';     id: string }
  | { type: 'dismissChild'; summaryId: string; childId: string }
  | { type: 'clear' }
  | { type: 'markAllRead' };

// Phase v3.0 §8 #5: when 3 or more unresolved notifications share a
// collapseKey, they fold into a single summary row. WS7 keeps the folded
// children on the summary so nothing is lost.
const COLLAPSE_THRESHOLD = 3;

// WS7 #4 — important-severity persistence.
const IMPORTANT_KEY = 'loom_notifs_important';
const IMPORTANT_CAP = 20;
const AMBIENT_DEFAULT_TTL_MS = 6000;

function summaryMessage(key: string, count: number): string {
  return `${count} notifications from ${key}`;
}

function applyCollapse(state: Notification[], incoming: Notification): Notification[] {
  if (!incoming.collapseKey) return [incoming, ...state];
  const sameKey = state.filter(n => n.collapseKey === incoming.collapseKey);
  const hasSummary = sameKey.some(n => n.collapsedChildren && n.collapsedChildren.length);
  if (!hasSummary && sameKey.length < COLLAPSE_THRESHOLD - 1) {
    // Not yet at threshold and no summary to grow — just prepend.
    return [incoming, ...state];
  }
  // Fold everything in this group into one summary that RETAINS its children
  // (WS7 #3 — earlier items must stay recoverable/actionable).
  const others = state.filter(n => n.collapseKey !== incoming.collapseKey);
  const children: Notification[] = [incoming];
  for (const n of sameKey) {
    if (n.collapsedChildren && n.collapsedChildren.length) children.push(...n.collapsedChildren);
    else children.push(n);
  }
  const total = children.length;
  const summary: Notification = {
    ...incoming,
    message:          summaryMessage(incoming.collapseKey, total),
    collapsedCount:   total,
    collapsedChildren: children,
    actionable:       false,   // act on individual children after expanding
  };
  return [summary, ...others];
}

function reducer(state: Notification[], action: Action): Notification[] {
  switch (action.type) {
    case 'add':       return applyCollapse(state, action.notif);
    case 'update':    return state.map(n => n.id === action.id ? { ...n, ...action.patch } : n);
    case 'dismiss':   return state.filter(n => n.id !== action.id);
    case 'dismissChild': {
      return state.flatMap(n => {
        if (n.id !== action.summaryId || !n.collapsedChildren) return [n];
        const remaining = n.collapsedChildren.filter(c => c.id !== action.childId);
        if (remaining.length === 0) return [];
        if (remaining.length === 1) return [remaining[0]];  // un-collapse the last one
        return [{
          ...n,
          collapsedChildren: remaining,
          collapsedCount:    remaining.length,
          message:           summaryMessage(n.collapseKey ?? '', remaining.length),
        }];
      });
    }
    case 'clear':     return [];
    case 'markAllRead': return state.map(n => ({ ...n, read: true }));
    default:          return state;
  }
}

// ---- important-severity persistence helpers -------------------------------

interface PersistedNotif {
  id: string; type: Notification['type']; title: string; message?: string;
  timestamp: string; read: boolean; severity?: Severity; collapseKey?: string;
}

function loadPersisted(): Notification[] {
  try {
    const raw = localStorage.getItem(IMPORTANT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as PersistedNotif[];
    if (!Array.isArray(arr)) return [];
    return arr.map(o => ({
      id:          o.id,
      type:        o.type,
      title:       o.title,
      message:     o.message,
      timestamp:   new Date(o.timestamp),
      read:        !!o.read,
      severity:    o.severity,
      collapseKey: o.collapseKey,
      dismissible: true,
      // actionFn cannot be serialized — a rehydrated important notification is
      // display-only (the row is retained; the action is not).
      actionable:  false,
    }));
  } catch {
    return [];
  }
}

function persistImportant(state: Notification[]): void {
  try {
    const important = state
      .filter(n => n.severity === 'important' && !n.collapsedChildren)
      .slice(0, IMPORTANT_CAP)
      .map<PersistedNotif>(n => ({
        id: n.id, type: n.type, title: n.title, message: n.message,
        timestamp: n.timestamp.toISOString(), read: n.read,
        severity: n.severity, collapseKey: n.collapseKey,
      }));
    if (important.length === 0) localStorage.removeItem(IMPORTANT_KEY);
    else localStorage.setItem(IMPORTANT_KEY, JSON.stringify(important));
  } catch {
    /* quota / private-mode — non-fatal */
  }
}

/**
 * WS7 #6 — standardized mutation toast. Past-tense verb + object with a working
 * Undo button and a 7s auto-dismiss, so a mutation toast is a pointer into the
 * undo stack rather than a separate recovery mechanism.
 */
export function buildMutationToast(opts: {
  verb: string;
  object: string;
  undo: () => void | Promise<void>;
  type?: Notification['type'];
}): AddPayload {
  return {
    type:        opts.type ?? 'success',
    title:       `${opts.verb} "${opts.object}"`,
    severity:    'standard',
    actionable:  true,
    actionLabel: 'Undo',
    actionFn:    opts.undo,
    autoRemoveMs: 7000,
  };
}

interface NotificationsContextValue {
  notifications: Notification[];
  unreadCount: number;
  panelOpen: boolean;
  addNotification: (n: AddPayload) => string;
  updateNotification: (id: string, patch: UpdatePayload) => void;
  dismissNotification: (id: string) => void;
  dismissChild: (summaryId: string, childId: string) => void;
  clearAllNotifications: () => void;
  markAllRead: () => void;
  togglePanel: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

let _idCounter = 0;
// Seed with the module-load time so ids never collide with rehydrated ids from
// a previous session.
const _idSeed = Date.now().toString(36);
function nextId(): string { return `notif-${_idSeed}-${++_idCounter}`; }

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, dispatch] = useReducer(reducer, null, loadPersisted);
  const [panelOpen, setPanelOpen] = useState(false);
  const togglePanel = useCallback(() => setPanelOpen(v => !v), []);

  // Persist important notifications on every change so they survive a restart.
  useEffect(() => { persistImportant(notifications); }, [notifications]);

  const addNotification = useCallback((payload: AddPayload): string => {
    const id = nextId();
    const notif: Notification = {
      id,
      timestamp: new Date(),
      read: false,
      dismissible: true,
      ...payload,
    };
    dispatch({ type: 'add', notif });

    // Ambient notifications auto-remove even if the caller didn't set a TTL.
    const ttl = notif.autoRemoveMs
      ?? (notif.severity === 'ambient' ? AMBIENT_DEFAULT_TTL_MS : undefined);
    if (ttl) {
      setTimeout(() => dispatch({ type: 'dismiss', id }), ttl);
    }

    return id;
  }, []);

  const updateNotification = useCallback((id: string, patch: UpdatePayload) => {
    dispatch({ type: 'update', id, patch });
  }, []);

  const dismissNotification = useCallback((id: string) => {
    dispatch({ type: 'dismiss', id });
  }, []);

  const dismissChild = useCallback((summaryId: string, childId: string) => {
    dispatch({ type: 'dismissChild', summaryId, childId });
  }, []);

  const clearAllNotifications = useCallback(() => dispatch({ type: 'clear' }), []);
  const markAllRead = useCallback(() => dispatch({ type: 'markAllRead' }), []);

  // Ambient severity never contributes to the bell badge (WS7 #4).
  const unreadCount = useMemo(
    () => notifications.filter(n => !n.read && n.severity !== 'ambient').length,
    [notifications],
  );

  const value = useMemo<NotificationsContextValue>(() => ({
    notifications,
    unreadCount,
    panelOpen,
    addNotification,
    updateNotification,
    dismissNotification,
    dismissChild,
    clearAllNotifications,
    markAllRead,
    togglePanel,
  }), [notifications, unreadCount, panelOpen, addNotification, updateNotification, dismissNotification, dismissChild, clearAllNotifications, markAllRead, togglePanel]);

  return <NotificationsContext value={value}>{children}</NotificationsContext>;
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be inside NotificationsProvider');
  return ctx;
}
