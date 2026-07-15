import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styles from './NotifPanel.module.css';
import { Icon, Icons } from './shared/Icon';
import { useNotifications, type Notification } from '../store/notifications';

interface NotifPanelProps {
  onClose: () => void;
}

const ACTION_COLORS: Record<Notification['type'], string> = {
  success: 'var(--success)', warning: 'var(--warning)',
  error: 'var(--error)', info: 'var(--info)', progress: 'var(--accent)',
};

const BORDER_CLASSES: Record<Notification['type'], string> = {
  success: styles.borderSuccess,
  warning: styles.borderWarning,
  error:   styles.borderError,
  info:    styles.borderInfo,
  progress: styles.borderProgress,
};

/** A single actionable notification button that awaits its promise before the
 *  row dismisses. On rejection the row stays with an error note + Retry. */
function ActionButton({ notif, onResolve }: { notif: Notification; onResolve: () => void }) {
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle');

  const run = useCallback(async () => {
    setState('running');
    try {
      await notif.actionFn?.();
      onResolve();
    } catch {
      setState('error');
    }
  }, [notif, onResolve]);

  return (
    <div className={styles.actionRow}>
      <button
        className={styles.cardAction}
        style={{ color: ACTION_COLORS[notif.type] }}
        onClick={run}
        disabled={state === 'running'}
      >
        {state === 'running'
          ? 'Working…'
          : state === 'error'
            ? `Retry ${notif.actionLabel}`
            : `${notif.actionLabel} →`}
      </button>
      {state === 'error' && (
        <span className={styles.actionError}>Action failed</span>
      )}
    </div>
  );
}

function NotifCard({
  notif, onDismiss, onGroupChildDismiss, isChild, groupId,
}: {
  notif: Notification;
  onDismiss: (id: string) => void;
  onGroupChildDismiss: (summaryId: string, childId: string) => void;
  isChild?: boolean;
  groupId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isSummary = !!(notif.collapsedChildren && notif.collapsedChildren.length);

  const ts = notif.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // A child dismiss removes just that child from its group; a top-level dismiss
  // (summary or plain) removes the whole row in a single step.
  const dismiss = isChild && groupId
    ? () => onGroupChildDismiss(groupId, notif.id)
    : () => onDismiss(notif.id);

  return (
    <div className={`${styles.card} ${BORDER_CLASSES[notif.type]} ${isChild ? styles.childCard : ''}`}>
      <div className={styles.cardTop}>
        <span className={styles.cardTitle}>{notif.title}</span>
        {notif.dismissible && (
          <button className={styles.cardDismiss} onClick={dismiss} aria-label="Dismiss">
            <Icon d={Icons.x} size={12} />
          </button>
        )}
      </div>
      {notif.message && <div className={styles.cardMsg}>{notif.message}</div>}

      {isSummary && (
        <button
          className={styles.expandBtn}
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
        >
          {expanded ? 'Hide' : `Show all ${notif.collapsedCount}`}
        </button>
      )}
      {isSummary && expanded && (
        <div className={styles.childList}>
          {notif.collapsedChildren!.map(child => (
            <NotifCard
              key={child.id}
              notif={child}
              onDismiss={onDismiss}
              onGroupChildDismiss={onGroupChildDismiss}
              isChild
              groupId={notif.id}
            />
          ))}
        </div>
      )}

      {notif.progress !== undefined && (
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${notif.progress}%` }} />
          {notif.type === 'progress' && notif.progress < 100 && (
            <div className={styles.progressShimmer} />
          )}
        </div>
      )}

      {notif.actionable && notif.actionLabel && notif.actionFn && (
        <ActionButton notif={notif} onResolve={dismiss} />
      )}

      <div className={styles.cardTs}>{ts}</div>
    </div>
  );
}

export function NotifPanel({ onClose }: NotifPanelProps) {
  const { notifications, dismissNotification, dismissChild, clearAllNotifications, markAllRead } = useNotifications();
  const panelRef = useRef<HTMLDivElement>(null);

  // Light-dismiss popover (WS7 #5): no dimming backdrop, no aria-modal. Esc,
  // click-outside, and a panel-scoped Tab trap. Marking read is now an explicit
  // user action (the "Mark all read" button) — not a side effect of opening.
  useEffect(() => {
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>('button, [href], input');
    firstFocusable?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Tab') {
        const focusables = panelRef.current?.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])') ?? [];
        const arr = Array.from(focusables).filter(el => !(el as HTMLButtonElement).disabled);
        if (arr.length === 0) return;
        const first = arr[0], last = arr[arr.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      // The bell toggles the panel itself — don't double-fire on it.
      if (target.closest('[aria-label="Notifications"]')) return;
      onClose();
    }

    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onClose]);

  return createPortal(
    <div ref={panelRef} className={styles.panel} role="dialog" aria-label="Notifications">
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
          <NotifCard
            key={n.id}
            notif={n}
            onDismiss={dismissNotification}
            onGroupChildDismiss={dismissChild}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}
