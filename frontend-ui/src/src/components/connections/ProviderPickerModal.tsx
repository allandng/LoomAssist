// Phase v3.0: ProviderPicker — modal opened from "Add connection" in Settings.
// Four cards: Google · iCloud · Generic CalDAV · Microsoft (disabled, "v3.1").
//
// Picking Google opens the system browser (via tauri-plugin-opener) with the
// Supabase-issued auth URL. iCloud / generic CalDAV open the credentials form.
// Microsoft is disabled per design doc §9 deferred list.

import { useState } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useNotifications } from '../../store/notifications';
import { Icon, Icons } from '../shared/Icon';
import { startGoogleConnection } from '../../api';
import styles from './connections.module.css';

type Kind = 'google' | 'caldav_icloud' | 'caldav_generic';

export function ProviderPickerModal({
  onPicked,
}: {
  onPicked?: (kind: Kind) => void;
}) {
  const { close, openCalDAVCredentials } = useModal();
  const { addNotification } = useNotifications();
  const [busy, setBusy] = useState(false);

  async function handleGoogle() {
    setBusy(true);
    try {
      const { auth_url } = await startGoogleConnection();
      onPicked?.('google');
      close();
      const inv = window.__TAURI_INTERNALS__?.invoke;
      if (inv) {
        try { await inv('plugin:opener|open_url', { url: auth_url }); return; } catch { /* fall through */ }
      }
      window.open(auth_url, '_blank');
      addNotification({
        type: 'info',
        title: 'Complete Google sign-in in your browser',
        message: 'When you’re done, return here and the connection will appear in Settings.',
      });
    } catch (e) {
      addNotification({
        type: 'error',
        title: 'Google sync isn’t configured on this device',
        message: e instanceof Error ? e.message : '',
      });
    } finally {
      setBusy(false);
    }
  }

  function handleCalDAV(kind: 'caldav_icloud' | 'caldav_generic') {
    onPicked?.(kind);
    openCalDAVCredentials(kind, () => {
      addNotification({
        type: 'success',
        title: 'Connection added',
        message: 'Pick which calendars to sync next.',
      });
      // The subscribe drawer is opened by CalDAVCredentialsModal itself via
      // useModal; nothing more to do here.
    });
  }

  return (
    <div className={styles.shell} role="dialog" aria-modal="true" aria-label="Add connection">
      <div className={styles.header}>
        <span className={styles.headerTitle}>Add a calendar connection</span>
        <button className={styles.closeBtn} onClick={() => close()}>
          <Icon d={Icons.x} size={14} />
        </button>
      </div>

      <div className={styles.body}>
        <p className={styles.lede}>
          LoomAssist syncs <em>directly</em> from this device to your calendar provider — no
          LoomAssist server in between. Tokens live in your macOS Keychain.
        </p>
        <div className={styles.providerGrid}>
          <ProviderCard
            icon={Icons.mail}
            name="Google Calendar"
            sub="OAuth 2.0 · sync any of your Google calendars"
            onClick={handleGoogle}
            disabled={busy}
          />
          <ProviderCard
            icon={Icons.upload}
            name="iCloud"
            sub="CalDAV · requires an app-specific password"
            onClick={() => handleCalDAV('caldav_icloud')}
            disabled={busy}
          />
          <ProviderCard
            icon={Icons.doc}
            name="Generic CalDAV"
            sub="Fastmail, Nextcloud, anything CalDAV"
            onClick={() => handleCalDAV('caldav_generic')}
            disabled={busy}
          />
          <ProviderCard
            icon={Icons.help}
            name="Microsoft Outlook"
            sub="Coming in v3.1"
            badge="Soon"
            disabled
          />
        </div>
      </div>
    </div>
  );
}

function ProviderCard({
  icon, name, sub, badge, disabled, onClick,
}: {
  icon: React.ReactNode;
  name: string;
  sub: string;
  badge?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`${styles.providerCard} ${disabled ? styles.providerCardDisabled : ''}`}
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      <div className={styles.providerLogo}><Icon d={icon} size={18} /></div>
      <div style={{ flex: 1 }}>
        <div className={styles.providerName}>
          {name}
          {badge && <span className={styles.soonChip}>{badge}</span>}
        </div>
        <div className={styles.providerSub}>{sub}</div>
      </div>
    </button>
  );
}
