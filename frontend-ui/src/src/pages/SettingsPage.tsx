// Settings — one narrow column of cards inside the settings frame (rail + content).
//
// Hash links from the command palette (/settings#keybindings, #lan-sync, …)
// scroll to the matching card on mount and whenever the hash changes. The rail
// nav lives in components/settings/SettingsNav; `SettingsSidebarContent` keeps
// its name so the shell can still mount the same nav elsewhere if it wants to.

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { SettingsLayout } from '../components/settings/SettingsLayout';
import { SettingsNav } from '../components/settings/SettingsNav';
import { scrollToSettingsHash } from '../components/settings/settingsHash';
import { AppearanceSection } from '../components/settings/AppearanceSection';
import { KeyboardSection } from '../components/settings/KeyboardSection';
import { NotificationsSection } from '../components/settings/NotificationsSection';
import { DataSection } from '../components/settings/DataSection';
import { SyncSection } from '../components/settings/SyncSection';
import { AboutSection } from '../components/settings/AboutSection';
import styles from './SettingsPage.module.css';

export function SettingsPage() {
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) return;
    // Wait one frame so every card has mounted before measuring.
    const raf = requestAnimationFrame(() => scrollToSettingsHash(location.hash));
    return () => cancelAnimationFrame(raf);
  }, [location.hash]);

  return (
    <SettingsLayout>
      <PageHeader
        title="Settings"
        description="Preferences for this device. Your profile and calendar connections are under Account."
      />
      <div className={styles.sections}>
        <AppearanceSection />
        <KeyboardSection />
        <NotificationsSection />
        <DataSection />
        <SyncSection />
        <AboutSection />
      </div>
    </SettingsLayout>
  );
}

/** Settings nav for a shell-provided sidebar (same component the settings rail uses). */
export function SettingsSidebarContent() {
  return <SettingsNav />;
}
