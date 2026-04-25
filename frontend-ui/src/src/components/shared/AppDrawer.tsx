import styles from './AppDrawer.module.css';
import { Icon, Icons } from './Icon';

export type Destination = 'calendar' | 'tasks' | 'focus' | 'inbox' | 'courses' | 'settings';

interface AppDrawerProps {
  active: Destination;
  onNavigate: (dest: Destination) => void;
  inboxCount?: number;
}

const NAV_ITEMS: { id: Destination; label: string; icon: React.ReactNode; kbd: string }[] = [
  { id: 'calendar', label: 'Calendar',   icon: Icons.calendar, kbd: '1' },
  { id: 'tasks',    label: 'Task Board', icon: Icons.tasks,    kbd: '' },
  { id: 'focus',    label: 'Focus Mode', icon: Icons.focus,    kbd: 'F' },
  { id: 'inbox',    label: 'Inbox',      icon: Icons.mail,     kbd: 'I' },
  { id: 'courses',  label: 'Courses',    icon: Icons.doc,      kbd: '' },
  { id: 'settings', label: 'Settings',   icon: Icons.settings, kbd: '' },
];

export function AppDrawer({ active, onNavigate, inboxCount = 0 }: AppDrawerProps) {
  return (
    <nav className={styles.rail} aria-label="App navigation">
      <div className={styles.logo} aria-hidden="true">L</div>

      {NAV_ITEMS.map(({ id, label, kbd, icon }) => {
        const isActive = id === active;
        const badge = id === 'inbox' && inboxCount > 0;
        return (
          <button
            key={id}
            className={`${styles.navBtn} ${isActive ? styles.navBtnActive : ''}`}
            onClick={() => onNavigate(id)}
            title={kbd ? `${label}  ·  ${kbd}` : label}
            aria-current={isActive ? 'page' : undefined}
            style={{ position: 'relative' }}
          >
            {isActive && <span className={styles.activeBar} aria-hidden="true" />}
            <Icon d={icon} size={18} />
            {badge && (
              <span style={{
                position: 'absolute', top: 6, right: 6,
                background: 'var(--accent)', color: '#fff',
                fontSize: 9, fontWeight: 700, borderRadius: 99,
                minWidth: 14, height: 14, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                padding: '0 3px', lineHeight: 1,
              }}>
                {inboxCount > 99 ? '99+' : inboxCount}
              </span>
            )}
          </button>
        );
      })}

      <div className={styles.spacer} />

      <div className={styles.avatar} aria-hidden="true">AN</div>
    </nav>
  );
}
