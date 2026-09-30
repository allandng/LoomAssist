import { useMemo, type ReactNode } from 'react';
import styles from './Sidebar.module.css';
import { Icon, Icons } from '../shared/Icon';
import { Kbd } from '../shared/Kbd';
import { Badge, Button, IconButton, Tooltip } from '../ui';
import { loadKeybinds, formatKeyLabel } from '../../lib/keybindConfig';
import { modKey } from '../../lib/platform';

export type Destination = 'home' | 'calendar' | 'tasks' | 'focus' | 'inbox' | 'courses' | 'journal' | 'settings';

export interface SidebarProps {
  active: Destination;
  onNavigate: (dest: Destination) => void;
  inboxCount?: number;
  /** Icon rail (var(--rail-w)) instead of the full sidebar. */
  collapsed?: boolean;
  onToggle?: () => void;
  /** Opens the command palette. */
  onSearch?: () => void;
  /** Opens the event editor. */
  onNewEvent?: () => void;
  /** Bottom slot, rendered under Settings (the account row). */
  footer?: ReactNode;
}

interface NavItem {
  id: Destination;
  label: string;
  icon: ReactNode;
  /** Keybind action whose label is shown as the hint, if any. */
  kbd?: string;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

function buildGroups(): NavGroup[] {
  const kb = loadKeybinds();
  return [
    {
      id: 'plan',
      label: 'Plan',
      items: [
        { id: 'home',     label: 'Home',     icon: Icons.home },
        { id: 'calendar', label: 'Calendar', icon: Icons.calendar, kbd: formatKeyLabel(kb.view_month) },
        { id: 'tasks',    label: 'Tasks',    icon: Icons.tasks },
        { id: 'inbox',    label: 'Inbox',    icon: Icons.inbox },
      ],
    },
    {
      id: 'do',
      label: 'Do',
      items: [
        { id: 'focus', label: 'Focus', icon: Icons.focus, kbd: formatKeyLabel(kb.focus_mode) },
      ],
    },
    {
      id: 'learn',
      label: 'Learn',
      items: [
        { id: 'courses', label: 'Courses', icon: Icons.graduation },
        { id: 'journal', label: 'Journal', icon: Icons.journal },
      ],
    },
  ];
}

const SETTINGS_ITEM: NavItem = { id: 'settings', label: 'Settings', icon: Icons.settings };

/**
 * App sidebar (DESIGN.md §4). Brand → search → New event → grouped nav →
 * Settings → account. Collapses to an icon rail; the collapsed state is
 * owned by the Shell (persisted under `loom:sidebar:collapsed`).
 */
export function Sidebar({
  active,
  onNavigate,
  inboxCount = 0,
  collapsed = false,
  onToggle,
  onSearch,
  onNewEvent,
  footer,
}: SidebarProps) {
  const groups = useMemo(() => buildGroups(), []);
  const searchHint = `${modKey}${modKey === 'Ctrl' ? '+' : ''}K`;

  function renderItem(item: NavItem) {
    const isActive = item.id === active;
    const badge = item.id === 'inbox' && inboxCount > 0 ? (inboxCount > 99 ? '99+' : String(inboxCount)) : null;
    const tooltip = item.kbd ? `${item.label} (${item.kbd})` : item.label;

    const button = (
      <button
        type="button"
        className={[styles.item, isActive ? styles.itemActive : ''].join(' ')}
        onClick={() => onNavigate(item.id)}
        aria-current={isActive ? 'page' : undefined}
        aria-label={collapsed ? (badge ? `${item.label}, ${badge} items` : item.label) : undefined}
      >
        <span className={styles.itemIcon}>
          <Icon d={item.icon} size={16} />
          {collapsed && badge && <span className={styles.railBadge} aria-hidden="true">{badge}</span>}
        </span>
        {!collapsed && (
          <>
            <span className={styles.itemLabel}>{item.label}</span>
            {badge ? (
              <Badge tone="accent" size="sm" className={styles.itemBadge}>{badge}</Badge>
            ) : item.kbd ? (
              <Kbd small>{item.kbd}</Kbd>
            ) : null}
          </>
        )}
      </button>
    );

    if (!collapsed) return <li key={item.id}>{button}</li>;
    return (
      <li key={item.id}>
        <Tooltip content={tooltip} side="right">{button}</Tooltip>
      </li>
    );
  }

  return (
    <nav
      className={[styles.sidebar, collapsed ? styles.collapsed : ''].join(' ')}
      aria-label="App navigation"
      data-collapsed={collapsed || undefined}
    >
      {/* Brand */}
      <button
        type="button"
        className={styles.brand}
        onClick={() => onNavigate('home')}
        aria-label="LoomAssist home"
      >
        <img src="/loom-logo.png" alt="" className={styles.logo} aria-hidden="true" />
        {!collapsed && <span className={styles.wordmark}>LoomAssist</span>}
      </button>

      {/* Search + primary action */}
      <div className={styles.actions}>
        {collapsed ? (
          <>
            <Tooltip content={`Search (${searchHint})`} side="right">
              <IconButton icon={Icons.search} label="Search" onClick={onSearch} className={styles.railBtn} />
            </Tooltip>
            <Tooltip content="New event (N)" side="right">
              <Button variant="primary" icon={Icons.plus} aria-label="New event" onClick={onNewEvent} className={styles.railPrimary} />
            </Tooltip>
          </>
        ) : (
          <>
            <button type="button" className={styles.searchBtn} onClick={onSearch}>
              <Icon d={Icons.search} size={14} />
              <span className={styles.searchLabel}>Search</span>
              <Kbd small>{searchHint}</Kbd>
            </button>
            <Button variant="primary" icon={Icons.plus} kbd="N" block onClick={onNewEvent}>
              New event
            </Button>
          </>
        )}
      </div>

      {/* Nav groups */}
      <div className={styles.groups}>
        {groups.map(group => (
          <div key={group.id} className={styles.group} role="group" aria-label={group.label}>
            {!collapsed && <div className={styles.groupLabel}>{group.label}</div>}
            <ul className={styles.list}>{group.items.map(renderItem)}</ul>
          </div>
        ))}
      </div>

      {/* Bottom */}
      <div className={styles.bottom}>
        <ul className={styles.list}>{renderItem(SETTINGS_ITEM)}</ul>
        {footer && <div className={styles.footer}>{footer}</div>}
        {onToggle && (
          <div className={styles.toggleRow}>
            <Tooltip content={collapsed ? 'Expand sidebar (B)' : 'Collapse sidebar (B)'} side={collapsed ? 'right' : 'top'}>
              <IconButton
                icon={collapsed ? Icons.chevronsRight : Icons.chevronsLeft}
                label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                size="sm"
                onClick={onToggle}
                aria-expanded={!collapsed}
              />
            </Tooltip>
          </div>
        )}
      </div>
    </nav>
  );
}
