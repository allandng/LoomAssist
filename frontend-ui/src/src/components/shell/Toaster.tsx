import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './Toaster.module.css';
import { Icon, Icons } from '../shared/Icon';
import { Button, IconButton } from '../ui';
import { useNotifications, isToast, toastTtl, type Notification } from '../../store/notifications';

const MAX_VISIBLE = 4;
const EXIT_MS = 160; // keep in sync with --motion-base

const SEVERITY_ICON: Record<Notification['type'], React.ReactNode> = {
  success:  Icons.checkCircle,
  error:    Icons.alertCircle,
  warning:  Icons.warning,
  info:     Icons.info,
  progress: Icons.loader,
};

/**
 * Live, transient feedback (DESIGN.md §1 "Feedback is visible where you are").
 * Bottom-right stack of at most four toasts. A notification becomes a toast per
 * `isToast()`; the bell panel keeps the full history regardless. Closing a
 * toast never removes the row — it only marks it `toastDismissed`.
 */
export function Toaster() {
  const { notifications, dismissToast, dismissNotification } = useNotifications();

  const live = useMemo(
    () => notifications.filter(n => isToast(n) && !n.toastDismissed).slice(0, MAX_VISIBLE),
    [notifications],
  );

  if (live.length === 0) return null;

  return createPortal(
    <div className={styles.stack} aria-label="Notifications" data-testid="toaster">
      {[...live].reverse().map(n => (
        <Toast
          key={n.id}
          notif={n}
          onClose={(markRead) => dismissToast(n.id, markRead)}
          onConsumed={() => dismissNotification(n.id)}
        />
      ))}
    </div>,
    document.body,
  );
}

interface ToastProps {
  notif: Notification;
  /** Close the toast (kept in history). */
  onClose: (markRead: boolean) => void;
  /** The action ran successfully — the row is spent, remove it. */
  onConsumed: () => void;
}

function Toast({ notif, onClose, onConsumed }: ToastProps) {
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  const remaining = useRef(toastTtl(notif));
  const startedAt = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);
  // Latest close callback, read only from timers (never during render).
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  const finish = useCallback((markRead: boolean) => {
    if (leaveTimer.current) return; // already leaving
    setLeaving(true);
    leaveTimer.current = window.setTimeout(() => closeRef.current(markRead), EXIT_MS);
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    if (startedAt.current != null) {
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
      startedAt.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    if (timer.current || busy) return;
    startedAt.current = Date.now();
    // Auto-dismiss counts as "seen" for everyday toasts; important ones keep
    // their unread state so the bell still calls attention to them.
    timer.current = window.setTimeout(() => finish(notif.severity !== 'important'), remaining.current);
  }, [busy, finish, notif.severity]);

  useEffect(() => {
    startTimer();
    return () => {
      clearTimer();
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    };
  }, [startTimer, clearTimer]);

  async function runAction() {
    if (!notif.actionFn) return;
    clearTimer();
    setBusy(true);
    setActionError(false);
    try {
      await notif.actionFn();
      setLeaving(true);
      leaveTimer.current = window.setTimeout(onConsumed, EXIT_MS);
    } catch {
      setActionError(true);
      setBusy(false);
    }
  }

  const isError = notif.type === 'error';
  const hasAction = !!(notif.actionable && notif.actionLabel && notif.actionFn);

  return (
    <div
      className={[styles.toast, styles[`tone_${notif.type}`], leaving ? styles.leaving : ''].join(' ')}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      onMouseEnter={clearTimer}
      onMouseLeave={startTimer}
      onFocus={clearTimer}
      onBlur={startTimer}
    >
      <span className={styles.icon} aria-hidden="true">
        <Icon d={SEVERITY_ICON[notif.type]} size={16} className={notif.type === 'progress' ? styles.spin : undefined} />
      </span>
      <div className={styles.body}>
        <div className={styles.title}>{notif.title}</div>
        {notif.message && <div className={styles.message}>{notif.message}</div>}
        {notif.progress !== undefined && (
          <div className={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(notif.progress)}>
            <div className={styles.progressFill} style={{ width: `${Math.max(0, Math.min(100, notif.progress))}%` }} />
          </div>
        )}
        {actionError && <div className={styles.actionError}>Action failed — try again</div>}
      </div>
      {hasAction && (
        <Button
          variant={notif.actionLabel === 'Undo' ? 'secondary' : 'ghost'}
          size="sm"
          loading={busy}
          onClick={runAction}
          className={styles.action}
        >
          {actionError ? 'Retry' : notif.actionLabel}
        </Button>
      )}
      {notif.dismissible !== false && (
        <IconButton icon={Icons.x} label="Dismiss" size="sm" onClick={() => finish(true)} className={styles.close} />
      )}
    </div>
  );
}
