import {
  createContext, useContext, useReducer, useCallback, useMemo, useState,
  type ReactNode,
} from 'react';

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
  actionFn?: () => void;
  progress?: number;       // 0-100 for progress type
  autoRemoveMs?: number;
  // Phase v3.0 §8 ride-along #5: identical collapseKey across N notifications
  // collapses them in the bell panel into a single row. Useful for noisy
  // sources (e.g. several Google sync cycles in an hour). Optional.
  collapseKey?: string;
  // Aggregate count when this notification represents a collapsed group.
  // Set automatically by the reducer; consumers should not pass this.
  collapsedCount?: number;
}

type AddPayload = Omit<Notification, 'id' | 'timestamp' | 'read'>;
type UpdatePayload = Partial<Omit<Notification, 'id' | 'timestamp'>>;

type Action =
  | { type: 'add';     notif: Notification }
  | { type: 'update';  id: string; patch: UpdatePayload }
  | { type: 'dismiss'; id: string }
  | { type: 'clear' }
  | { type: 'markAllRead' };

// Phase v3.0 §8 #5: when 3 or more unresolved notifications share a
// collapseKey, the oldest (3rd back) is replaced in place by a single
// summary row. Threshold matches the design doc: "more than 3 sync
// notifications from the same connection are present, collapse them
// into a single row."
const COLLAPSE_THRESHOLD = 3;

function applyCollapse(state: Notification[], incoming: Notification): Notification[] {
  if (!incoming.collapseKey) return [incoming, ...state];
  const sameKey = state.filter(n => n.collapseKey === incoming.collapseKey);
  if (sameKey.length < COLLAPSE_THRESHOLD - 1) {
    // Not yet at threshold — just prepend.
    return [incoming, ...state];
  }
  // Drop everything in this group, replace with a single summary entry.
  const others = state.filter(n => n.collapseKey !== incoming.collapseKey);
  const total  = sameKey.length + 1;
  const summary: Notification = {
    ...incoming,
    title:          incoming.title,
    message:        `${total} notifications from ${incoming.collapseKey}`,
    collapsedCount: total,
  };
  return [summary, ...others];
}

function reducer(state: Notification[], action: Action): Notification[] {
  switch (action.type) {
    case 'add':       return applyCollapse(state, action.notif);
    case 'update':    return state.map(n => n.id === action.id ? { ...n, ...action.patch } : n);
    case 'dismiss':   return state.filter(n => n.id !== action.id);
    case 'clear':     return [];
    case 'markAllRead': return state.map(n => ({ ...n, read: true }));
    default:          return state;
  }
}

interface NotificationsContextValue {
  notifications: Notification[];
  unreadCount: number;
  panelOpen: boolean;
  addNotification: (n: AddPayload) => string;
  updateNotification: (id: string, patch: UpdatePayload) => void;
  dismissNotification: (id: string) => void;
  clearAllNotifications: () => void;
  markAllRead: () => void;
  togglePanel: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

let _idCounter = 0;
function nextId(): string { return `notif-${++_idCounter}`; }

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, dispatch] = useReducer(reducer, []);
  const [panelOpen, setPanelOpen] = useState(false);
  const togglePanel = useCallback(() => setPanelOpen(v => !v), []);

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

    if (notif.autoRemoveMs) {
      setTimeout(() => dispatch({ type: 'dismiss', id }), notif.autoRemoveMs);
    }

    return id;
  }, []);

  const updateNotification = useCallback((id: string, patch: UpdatePayload) => {
    dispatch({ type: 'update', id, patch });
  }, []);

  const dismissNotification = useCallback((id: string) => {
    dispatch({ type: 'dismiss', id });
  }, []);

  const clearAllNotifications = useCallback(() => dispatch({ type: 'clear' }), []);
  const markAllRead = useCallback(() => dispatch({ type: 'markAllRead' }), []);

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  const value = useMemo<NotificationsContextValue>(() => ({
    notifications,
    unreadCount,
    panelOpen,
    addNotification,
    updateNotification,
    dismissNotification,
    clearAllNotifications,
    markAllRead,
    togglePanel,
  }), [notifications, unreadCount, panelOpen, addNotification, updateNotification, dismissNotification, clearAllNotifications, markAllRead, togglePanel]);

  return <NotificationsContext value={value}>{children}</NotificationsContext>;
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be inside NotificationsProvider');
  return ctx;
}
