// Settings section nav — grouped (Account / App), active state from route + hash,
// hash items scroll to their card. Rendered in the settings rail (SettingsLayout)
// and exported through SettingsPage as `SettingsSidebarContent` for the shell.

import { useLocation, useNavigate } from 'react-router-dom';
import { Icon, Icons } from '../ui';
import { HASH_TO_NAV, resolveSettingsHash, scrollToSettingsHash } from './settingsHash';
import styles from './SettingsNav.module.css';

interface NavItem { label: string; to: string; hash?: string; icon: React.ReactNode }
interface NavGroup { heading: string; items: NavItem[] }

const NAV: NavGroup[] = [
  {
    heading: 'Account',
    items: [
      { label: 'Profile',     to: '/settings/account',     icon: Icons.user },
      { label: 'Connections', to: '/settings/connections', icon: Icons.cloud },
    ],
  },
  {
    heading: 'App',
    items: [
      { label: 'Appearance',    to: '/settings', hash: 'appearance',    icon: Icons.palette },
      { label: 'Keyboard',      to: '/settings', hash: 'keybindings',   icon: Icons.keyboard },
      { label: 'Notifications', to: '/settings', hash: 'notifications', icon: Icons.bell },
      { label: 'Data & backup', to: '/settings', hash: 'data',          icon: Icons.database },
      { label: 'Sync',          to: '/settings', hash: 'sync',          icon: Icons.sync },
      { label: 'Advanced',      to: '/settings', hash: 'advanced',      icon: Icons.settings },
    ],
  },
];

export function SettingsNav({ collapsed = false }: { collapsed?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();

  const currentHash = resolveSettingsHash(location.hash);
  const activeHash = location.pathname === '/settings' ? (HASH_TO_NAV[currentHash] ?? 'appearance') : null;

  function isActive(item: NavItem): boolean {
    if (item.hash) return activeHash === item.hash;
    return location.pathname === item.to || location.pathname.startsWith(item.to + '/');
  }

  function go(item: NavItem) {
    if (item.hash) {
      if (location.pathname === '/settings' && location.hash === `#${item.hash}`) {
        scrollToSettingsHash(item.hash); // same hash — the router won't fire, scroll manually
      } else {
        navigate(`/settings#${item.hash}`);
      }
      return;
    }
    navigate(item.to);
  }

  return (
    <nav className={`${styles.nav} ${collapsed ? styles.navCollapsed : ''}`} aria-label="Settings sections">
      {NAV.map(group => (
        <div key={group.heading} className={styles.group}>
          {!collapsed && <div className={styles.heading}>{group.heading}</div>}
          {group.items.map(item => {
            const active = isActive(item);
            return (
              <button
                key={item.label}
                type="button"
                className={`${styles.item} ${active ? styles.itemActive : ''}`}
                aria-current={active ? 'page' : undefined}
                aria-label={collapsed ? item.label : undefined}
                title={collapsed ? item.label : undefined}
                onClick={() => go(item)}
              >
                <Icon d={item.icon} size={15} className={styles.icon} />
                {!collapsed && <span className={styles.label}>{item.label}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
