import type { ReactNode } from 'react';
import styles from './ContextSidebar.module.css';
import { Icon, Icons } from '../shared/Icon';

interface ContextSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function ContextSidebar({ collapsed, onToggle, children }: ContextSidebarProps) {
  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      <button
        className={styles.toggleBtn}
        onClick={onToggle}
        title={collapsed ? 'Expand sidebar (B)' : 'Collapse sidebar (B)'}
        aria-expanded={!collapsed}
      >
        <Icon
          d={collapsed ? Icons.chevronRight : Icons.chevronLeft}
          size={14}
        />
      </button>
      {!collapsed && <div className={styles.content}>{children}</div>}
    </aside>
  );
}
