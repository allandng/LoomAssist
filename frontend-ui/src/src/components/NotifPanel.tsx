import { useState, useCallback } from 'react';
import styles from './NotifPanel.module.css';
import { Icon, Icons } from './shared/Icon';
import { Button, EmptyState, IconButton, Popover } from './ui';
import { relativeTime } from '../lib/time';
import { useNotifications, type Notification } from '../store/notifications';

interface NotifPanelProps {
  open: boolean;
  onClose: () => void;
  /** The bell button; the panel anchors under it (right-aligned). */
  anchor: HTMLElement | null;
}

const PANEL_WIDTH = 360;

const SEVERITY_ICON: Record<Notification['type'], React.ReactNode> = {
  success:  Icons.checkCircle,
  error:    Icons.alertCircle,
  warning:  Icons.warning,
  info:     Icons.info,
  progress: Icons.loader,
};

/** Bucket a timestamp for the grouped list. */
function bucket(ts: Date, now: Date): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const delta = Math.round((day(now) - day(ts)) / 86_400_000);
  if (delta <= 0) return 'Today';
  if (delta === 1) return 'Yesterday';
  if (delta < 7) return 'This week';
  return 'Earlier';
}

/** Runs the notification's action, keeping the row up (with Retry) on failure. */
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
      <Button size="sm" variant="ghost" loading={state === 'running'} onClick={run}>
        {state === 'error' ? `Retry ${notif.actionLabel}` : notif.actionLabel}
      </Button>
      {state === 'error' && <span className={styles.actionError}>Action failed</span>}
    </div>
  );
}

function NotifRow({
  notif, onDismiss, onGroupChildDismiss, isChild, groupId, now,
}: {
  notif: Notification;
  onDismiss: (id: string) => void;
  onGroupChildDismiss: (summaryId: string, childId: string) => void;
  isChild?: boolean;
  groupId?: string;
  now: Date;
}) {
  const [expanded, setExpanded] = useState(false);
  const isSummary = !!(notif.collapsedChildren && notif.collapsedChildren.length);

  // A child dismiss removes just that child from its group; a top-level dismiss
  // (summary or plain) removes the whole row in a single step.
  const dismiss = isChild && groupId
    ? () => onGroupChildDismiss(groupId, notif.id)
    : () => onDismiss(notif.id);

  return (
    <li className={[styles.row, styles[`tone_${notif.type}`], isChild ? styles.rowChild : '', notif.read ? '' : styles.rowUnread].join(' ')}>
      <span className={styles.rowIcon} aria-hidden="true">
        <Icon d={SEVERITY_ICON[notif.type]} size={15} />
      </span>
      <div className={styles.rowBody}>
        <div className={styles.rowTop}>
          <span className={styles.rowTitle}>
            {!notif.read && <span className={styles.unreadDot} aria-label="Unread" />}
            {notif.title}
          </span>
          <time className={styles.rowTime} dateTime={notif.timestamp.toISOString()} title={notif.timestamp.toLocaleString()}>
            {relativeTime(notif.timestamp, now)}
          </time>
        </div>
        {notif.message && <div className={styles.rowMsg}>{notif.message}</div>}

        {notif.progress !== undefined && (
          <div className={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(notif.progress)}>
            <div className={styles.progressFill} style={{ width: `${Math.max(0, Math.min(100, notif.progress))}%` }} />
          </div>
        )}

        {isSummary && (
          <button type="button" className={styles.expandBtn} onClick={() => setExpanded(e => !e)} aria-expanded={expanded}>
            <Icon d={expanded ? Icons.chevronUp : Icons.chevronDown} size={12} />
            {expanded ? 'Hide' : `Show all ${notif.collapsedCount}`}
          </button>
        )}
        {isSummary && expanded && (
          <ul className={styles.childList}>
            {notif.collapsedChildren!.map(child => (
              <NotifRow
                key={child.id}
                notif={child}
                onDismiss={onDismiss}
                onGroupChildDismiss={onGroupChildDismiss}
                isChild
                groupId={notif.id}
                now={now}
              />
            ))}
          </ul>
        )}

        {notif.actionable && notif.actionLabel && notif.actionFn && (
          <ActionButton notif={notif} onResolve={dismiss} />
        )}
      </div>
      {notif.dismissible !== false && (
        <IconButton icon={Icons.x} label="Dismiss" size="sm" onClick={dismiss} className={styles.rowDismiss} />
      )}
    </li>
  );
}

/**
 * Notification history, anchored under the bell. Light-dismiss popover: no
 * scrim, closes on Escape (shared escape stack) and outside click. Marking
 * read is explicit ("Mark all read"), never a side effect of opening.
 */
export function NotifPanel({ open, onClose, anchor }: NotifPanelProps) {
  const { notifications, unreadCount, dismissNotification, dismissChild, clearAllNotifications, markAllRead } = useNotifications();
  const now = new Date();

  const groups: { label: string; items: Notification[] }[] = [];
  for (const n of notifications) {
    const label = bucket(n.timestamp, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <Popover open={open} onClose={onClose} anchor={anchor} align="end" width={PANEL_WIDTH} label="Notifications" className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Notifications</h2>
        <div className={styles.headerActions}>
          {unreadCount > 0 && (
            <Button size="sm" variant="subtle" onClick={markAllRead}>Mark all read</Button>
          )}
          {notifications.length > 0 && (
            <Button size="sm" variant="subtle" onClick={clearAllNotifications}>Clear</Button>
          )}
        </div>
      </div>

      <div className={styles.list}>
        {notifications.length === 0 ? (
          <EmptyState
            compact
            icon={Icons.bell}
            title="You're all caught up"
            description="Sync results, reminders and undo actions will show up here."
          />
        ) : (
          groups.map(g => (
            <section key={g.label} className={styles.group} aria-label={g.label}>
              <div className={styles.groupLabel}>{g.label}</div>
              <ul className={styles.groupList}>
                {g.items.map(n => (
                  <NotifRow
                    key={n.id}
                    notif={n}
                    onDismiss={dismissNotification}
                    onGroupChildDismiss={dismissChild}
                    now={now}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </Popover>
  );
}
