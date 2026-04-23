import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './NotifPanel.module.css';
import { Icon, Icons } from './shared/Icon';
import { useNotifications, type Notification } from '../store/notifications';

interface NotifPanelProps {
  onClose: () => void;
}

function NotifCard({ notif, onDismiss }: { notif: Notification; onDismiss: (id: string) => void }) {
  const colorClass = {
    success: styles.borderSuccess,
    warning: styles.borderWarning,
    error:   styles.borderError,
    info:    styles.borderInfo,
    progress: styles.borderProgress,
  }[notif.type];

  const actionColor = {
    success: 'var(--success)', warning: 'var(--warning)',
    error: 'var(--error)', info: 'var(--info)', progress: 'var(--accent)',
  }[notif.type];

  const ts = notif.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`${styles.card} ${colorClass}`}>
      <div className={styles.cardTop}>
        <span className={styles.cardTitle}>{notif.title}</span>
        {notif.dismissible && (
          <button className={styles.cardDismiss} onClick={() => onDismiss(notif.id)} aria-label="Dismiss">
            <Icon d={Icons.x} size={12} />
          </button>
        )}
      </div>
      {notif.message && <div className={styles.cardMsg}>{notif.message}</div>}
      {notif.progress !== undefined && (
        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{ width: `${notif.progress}%` }}
          />
          {/* shimmer for progress type */}
          {notif.type === 'progress' && notif.progress < 100 && (
            <div className={styles.progressShimmer} />
          )}
        </div>
      )}
      {notif.actionable && notif.actionLabel && (
        <button
          className={styles.cardAction}
          style={{ color: actionColor }}
          onClick={() => { notif.actionFn?.(); onDismiss(notif.id); }}
        >{notif.actionLabel} →</button>
      )}
      <div className={styles.cardTs}>{ts}</div>
    </div>
  );
}

export function NotifPanel({ onClose }: NotifPanelProps) {
  const { notifications, dismissNotification, clearAllNotifications, markAllRead } = useNotifications();
  const panelRef = useRef<HTMLDivElement>(null);

  // Tab trap + mark read on open
  useEffect(() => {
    markAllRead();
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>('button, [href], input');
    firstFocusable?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const focusables = panelRef.current?.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])') ?? [];
        const arr = Array.from(focusables);
        if (arr.length === 0) return;
        const first = arr[0], last = arr[arr.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, markAllRead]);

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className={styles.panel} role="dialog" aria-label="Notifications" aria-modal="true">
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>NOTIFICATIONS · {notifications.length}</span>
          <div className={styles.panelActions}>
            <button className={styles.markRead} onClick={markAllRead}>Mark all read</button>
            {notifications.length > 0 && (
              <button className={styles.markRead} onClick={clearAllNotifications}>Clear all</button>
            )}
          </div>
        </div>
        <div className={styles.list}>
          {notifications.length === 0 && (
            <div className={styles.empty}>No notifications</div>
          )}
          {notifications.map(n => (
            <NotifCard key={n.id} notif={n} onDismiss={dismissNotification} />
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}
