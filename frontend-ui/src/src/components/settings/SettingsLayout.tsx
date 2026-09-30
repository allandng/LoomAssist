// Shared frame for every /settings route: a collapsible left rail with the
// section nav (state under `loom:panel:settings`) and a narrow, scrollable
// content column. Mirrors the "page with its own left panel" grammar used by
// Calendar and Focus.

import { useState, type ReactNode } from 'react';
import { Page, IconButton, Icons } from '../ui';
import { SettingsNav } from './SettingsNav';
import styles from './SettingsLayout.module.css';

const PANEL_KEY = 'loom:panel:settings';

function readCollapsed(): boolean {
  try { return localStorage.getItem(PANEL_KEY) === 'collapsed'; } catch { return false; }
}

export function SettingsLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(PANEL_KEY, next ? 'collapsed' : 'open'); } catch { /* ignore */ }
  }

  return (
    <Page bare>
      <aside className={`${styles.rail} ${collapsed ? styles.railCollapsed : ''}`}>
        <div className={styles.railScroll}>
          <SettingsNav collapsed={collapsed} />
        </div>
        <div className={styles.railFoot}>
          <IconButton
            size="sm"
            icon={collapsed ? Icons.chevronsRight : Icons.chevronsLeft}
            label={collapsed ? 'Expand settings navigation' : 'Collapse settings navigation'}
            aria-expanded={!collapsed}
            onClick={toggle}
          />
        </div>
      </aside>
      <Page narrow className={styles.content}>
        {children}
      </Page>
    </Page>
  );
}
