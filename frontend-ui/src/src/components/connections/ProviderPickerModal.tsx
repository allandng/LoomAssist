// ProviderPicker — opened from "Add connection" in Settings.
// Google · iCloud · Generic CalDAV · Microsoft (unavailable).
//
// Picking Google opens the system browser (via tauri-plugin-opener) with the
// Supabase-issued auth URL. iCloud / generic CalDAV open the credentials form.

import { useState } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useNotifications } from '../../store/notifications';
import { ModalShell, ModalStack } from '../modals/ModalShell';
import { Badge, Icon, Icons } from '../ui';
import { ProviderGlyph, type ProviderGlyphKind } from './ProviderGlyph';
import { startGoogleConnection } from '../../api';
import styles from './connections.module.css';

type Kind = 'google' | 'caldav_icloud' | 'caldav_generic';

export function ProviderPickerModal({ onPicked }: { onPicked?: (kind: Kind) => void }) {
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
        title: 'Finish Google sign-in in your browser',
        message: 'When you’re done, come back here — the connection appears in Settings.',
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
      // The subscribe drawer is opened by CalDAVCredentialsModal itself.
    });
  }

  return (
    <ModalShell title="Add a calendar connection" subtitle="Sync runs from this device straight to your provider" size="md" onClose={close}>
      <ModalStack>
        <p className={styles.lede}>
          No LoomAssist server sits in between. Sign-in tokens are stored in your system keychain and never leave this device.
        </p>
        <div className={styles.providerGrid}>
          <ProviderCard
            glyph="google"
            name="Google Calendar"
            sub="Sign in with Google · sync any of your calendars"
            onClick={() => { void handleGoogle(); }}
            disabled={busy}
            loading={busy}
          />
          <ProviderCard
            glyph="caldav_icloud"
            name="iCloud"
            sub="CalDAV · needs an app-specific password"
            onClick={() => handleCalDAV('caldav_icloud')}
            disabled={busy}
          />
          <ProviderCard
            glyph="caldav_generic"
            name="CalDAV server"
            sub="Fastmail, Nextcloud, anything CalDAV"
            onClick={() => handleCalDAV('caldav_generic')}
            disabled={busy}
          />
          <ProviderCard
            glyph="microsoft"
            name="Microsoft Outlook"
            sub="Outlook and Microsoft 365 calendars"
            badge="Unavailable"
            disabled
          />
        </div>
      </ModalStack>
    </ModalShell>
  );
}

function ProviderCard({
  glyph, name, sub, badge, disabled, loading, onClick,
}: {
  glyph: ProviderGlyphKind;
  name: string;
  sub: string;
  badge?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={[styles.providerCard, disabled && !loading ? styles.providerCardDisabled : ''].join(' ')}
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
    >
      <span className={styles.providerLogo}>
        {loading ? <Icon d={Icons.loader} size={18} className={styles.spin} /> : <ProviderGlyph kind={glyph} size={18} />}
      </span>
      <span className={styles.providerText}>
        <span className={styles.providerName}>
          {name}
          {badge && <Badge size="sm" outline>{badge}</Badge>}
        </span>
        <span className={styles.providerSub}>{sub}</span>
      </span>
      {!disabled && <span className={styles.providerArrow}><Icon d={Icons.chevronRight} size={14} /></span>}
    </button>
  );
}
