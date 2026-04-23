import styles from './AppDrawer.module.css';
import { Icon, Icons } from './Icon';

type Destination = 'calendar' | 'tasks' | 'focus' | 'settings';

interface AppDrawerProps {
  active: Destination;
  onNavigate: (dest: Destination) => void;
}

const NAV_ITEMS: { id: Destination; label: string; icon: React.ReactNode; kbd: string }[] = [
  { id: 'calendar', label: 'Calendar',   icon: Icons.calendar, kbd: '1' },
  { id: 'tasks',    label: 'Task Board', icon: Icons.tasks,    kbd: '' },
  { id: 'focus',    label: 'Focus Mode', icon: Icons.focus,    kbd: 'F' },
  { id: 'settings', label: 'Settings',   icon: Icons.settings, kbd: '' },
];

export function AppDrawer({ active, onNavigate }: AppDrawerProps) {
  return (
    <nav className={styles.rail} aria-label="App navigation">
      <div className={styles.logo} aria-hidden="true">L</div>

      {NAV_ITEMS.map(({ id, label, kbd, icon }) => {
        const isActive = id === active;
        return (
          <button
            key={id}
            className={`${styles.navBtn} ${isActive ? styles.navBtnActive : ''}`}
            onClick={() => onNavigate(id)}
            title={kbd ? `${label}  ·  ${kbd}` : label}
            aria-current={isActive ? 'page' : undefined}
          >
            {isActive && <span className={styles.activeBar} aria-hidden="true" />}
            <Icon d={icon} size={18} />
          </button>
        );
      })}

      <div className={styles.spacer} />

      <div className={styles.avatar} aria-hidden="true">AN</div>
    </nav>
  );
}
