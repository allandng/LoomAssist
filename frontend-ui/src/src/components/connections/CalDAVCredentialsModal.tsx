// CalDAVCredentialsModal — server URL + username + password + inline
// "Test connection" (POST /connections/caldav/test). The iCloud preset
// prefills https://caldav.icloud.com and explains app-specific passwords.

import { useId, useState } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useSync } from '../../contexts/SyncContext';
import { useNotifications } from '../../store/notifications';
import { ModalShell, ModalFooter, ModalStack, ModalNotice } from '../modals/ModalShell';
import { Button, Field, Input, Badge, Icon, Icons } from '../ui';
import { ProviderGlyph } from './ProviderGlyph';
import { testCalDAV, createCalDAVConnection } from '../../api';
import styles from './connections.module.css';

const ICLOUD_BASE = 'https://caldav.icloud.com';

export function CalDAVCredentialsModal({
  kind,
  onCreated,
}: {
  kind: 'caldav_icloud' | 'caldav_generic';
  onCreated?: (connectionId: string) => void;
}) {
  const { close, openSubscribeDrawer } = useModal();
  const { refreshConnections, refreshStatuses } = useSync();
  const { addNotification } = useNotifications();
  const ids = useId();

  const [baseUrl, setBaseUrl]   = useState(kind === 'caldav_icloud' ? ICLOUD_BASE : '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [test, setTest]         = useState<{ ok?: boolean; error?: string } | null>(null);
  const [busy, setBusy]         = useState<'test' | 'save' | null>(null);
  const [err, setErr]           = useState<string | null>(null);

  const complete = !!baseUrl && !!username && !!password;
  const isICloud = kind === 'caldav_icloud';

  async function handleTest() {
    if (!complete) return;
    setBusy('test'); setTest(null); setErr(null);
    try {
      const r = await testCalDAV(baseUrl, username, password);
      setTest(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    setBusy('save'); setErr(null);
    try {
      const conn = await createCalDAVConnection({ kind, base_url: baseUrl, username, password });
      await refreshConnections();
      await refreshStatuses();
      addNotification({ type: 'success', title: 'Connection added', autoRemoveMs: 3000 });
      close();
      onCreated?.(conn.id);
      // Auto-open the subscribe drawer so the user picks which calendars to sync.
      openSubscribeDrawer(conn.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ModalShell
      title={isICloud ? 'Connect iCloud' : 'Connect a CalDAV server'}
      subtitle={isICloud ? 'Apple Calendar over CalDAV' : 'Fastmail, Nextcloud, Radicale and more'}
      size="sm"
      onClose={close}
      confirmOnClose={!!username || !!password}
      headerActions={<span className={styles.headerGlyph}><ProviderGlyph kind={kind} size={16} /></span>}
    >
      <ModalStack>
        {isICloud && (
          <ModalNotice tone="info" icon={<Icon d={Icons.lock} size={13} />}>
            iCloud needs an <strong>app-specific password</strong> from <code className={styles.code}>appleid.apple.com</code> — your normal Apple ID password won’t work.
            It is stored in your system keychain and never leaves this device.
          </ModalNotice>
        )}

        {err && <ModalNotice tone="error" icon={<Icon d={Icons.alertCircle} size={13} />}>{err}</ModalNotice>}

        <Field
          label="Server URL"
          htmlFor={`${ids}-url`}
          hint={!isICloud ? <>Examples: <code className={styles.code}>https://caldav.fastmail.com</code>, <code className={styles.code}>https://your.nextcloud.example/remote.php/dav</code></> : undefined}
        >
          <Input
            id={`${ids}-url`}
            value={baseUrl}
            onChange={e => { setBaseUrl(e.target.value); setTest(null); }}
            placeholder="https://caldav.example.com"
            disabled={isICloud || busy !== null}
            autoComplete="url"
            inputMode="url"
            data-autofocus={!isICloud || undefined}
          />
        </Field>

        <Field label="Username or email" htmlFor={`${ids}-user`}>
          <Input
            id={`${ids}-user`}
            value={username}
            onChange={e => { setUsername(e.target.value); setTest(null); }}
            placeholder="you@example.com"
            disabled={busy !== null}
            autoComplete="username"
            data-autofocus={isICloud || undefined}
          />
        </Field>

        <Field
          label={isICloud ? 'App-specific password' : 'Password'}
          htmlFor={`${ids}-pw`}
          labelRight={(
            <Button variant="subtle" size="sm" icon={showPw ? Icons.eyeOff : Icons.eye} onClick={() => setShowPw(v => !v)} aria-pressed={showPw}>
              {showPw ? 'Hide' : 'Show'}
            </Button>
          )}
        >
          <Input
            id={`${ids}-pw`}
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={e => { setPassword(e.target.value); setTest(null); }}
            disabled={busy !== null}
            autoComplete="current-password"
          />
        </Field>

        <div className={styles.testRow}>
          <Button variant="secondary" size="sm" icon={Icons.wifi} onClick={() => { void handleTest(); }} disabled={!complete || busy !== null} loading={busy === 'test'}>
            Test connection
          </Button>
          {test?.ok && <Badge tone="success" dot>Connected</Badge>}
          {test?.ok === false && <Badge tone="error" dot>{test.error || 'Connection failed'}</Badge>}
        </div>
      </ModalStack>

      <ModalFooter>
        <Button variant="ghost" onClick={close} disabled={busy !== null}>Cancel</Button>
        <Button variant="primary" onClick={() => { void handleSave(); }} disabled={!complete || busy !== null} loading={busy === 'save'}>
          Save connection
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}
