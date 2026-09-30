import type { ReactNode } from 'react';
import styles from './ContextSidebar.module.css';
import { Icons } from '../shared/Icon';
import { IconButton, Tooltip } from '../ui';

interface ContextSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * Page-level context panel (DESIGN.md §4): a `--panel-w` aside on the left of
 * a page's content, collapsible to a thin strip. The page owns the collapsed
 * state (stored under `loom:panel:<page>`).
 */
export function ContextSidebar({ collapsed, onToggle, children }: ContextSidebarProps) {
  return (
    <aside className={[styles.sidebar, collapsed ? styles.collapsed : ''].join(' ')} aria-label="Context panel">
      <div className={styles.toggle}>
        <Tooltip content={collapsed ? 'Expand panel (B)' : 'Collapse panel (B)'} side="right">
          <IconButton
            icon={collapsed ? Icons.chevronsRight : Icons.chevronsLeft}
            label={collapsed ? 'Expand panel' : 'Collapse panel'}
            size="sm"
            onClick={onToggle}
            aria-expanded={!collapsed}
          />
        </Tooltip>
      </div>
      {!collapsed && <div className={styles.content}>{children}</div>}
    </aside>
  );
}
