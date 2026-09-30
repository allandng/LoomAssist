import { useNavigate } from 'react-router-dom';
import styles from './SidebarAccount.module.css';
import { Avatar, Tooltip } from '../ui';
import { useAccount } from '../../contexts/AccountContext';
import { useSync } from '../../contexts/SyncContext';
import { useCalendarNav } from '../../contexts/CalendarNavContext';

interface SidebarAccountProps {
  collapsed?: boolean;
}

/**
 * Bottom-of-sidebar account row: avatar + display name + a sync status dot.
 * Clicking opens the account settings. Lives in its own component so the
 * Sidebar itself stays provider-free.
 */
export function SidebarAccount({ collapsed = false }: SidebarAccountProps) {
  const navigate = useNavigate();
  const { account, status } = useAccount();
  const { connections, reviewCount } = useSync();
  const { syncStatus } = useCalendarNav();

  const signedIn = status === 'signedIn' && !!account;
  const name = signedIn ? (account!.display_name || account!.email) : status === 'loading' ? 'Loading…' : 'Local mode';
  const detail = signedIn ? account!.email : 'Data stays on this device';

  const connError = connections.some(c => c.status === 'auth_expired' || c.status === 'error');
  const tone: 'error' | 'warning' | 'ok' | 'off' =
    connError || syncStatus?.error ? 'error'
    : reviewCount > 0 ? 'warning'
    : connections.length > 0 || syncStatus ? 'ok'
    : 'off';
  const dotLabel =
    tone === 'error' ? (syncStatus?.error ? syncStatus.label : 'Sync needs attention')
    : tone === 'warning' ? `${reviewCount} to review`
    : tone === 'ok' ? (syncStatus?.label ?? 'Synced')
    : 'Not syncing';

  const row = (
    <button
      type="button"
      className={[styles.row, collapsed ? styles.collapsed : ''].join(' ')}
      onClick={() => navigate('/settings/account')}
      aria-label={collapsed ? `${name} — ${dotLabel}` : undefined}
      title={collapsed ? undefined : `${detail} · ${dotLabel}`}
    >
      <span className={styles.avatarWrap}>
        <Avatar name={signedIn ? name : null} size={collapsed ? 28 : 26} className={signedIn ? '' : styles.avatarLocal} />
        <span className={[styles.dot, styles[`dot_${tone}`]].join(' ')} aria-hidden="true" />
      </span>
      {!collapsed && (
        <span className={styles.text}>
          <span className={styles.name}>{name}</span>
          <span className={styles.status}>{dotLabel}</span>
        </span>
      )}
    </button>
  );

  if (!collapsed) return row;
  return <Tooltip content={`${name} · ${dotLabel}`} side="right">{row}</Tooltip>;
}
