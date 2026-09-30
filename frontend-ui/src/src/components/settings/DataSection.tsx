import { useRef, useState } from 'react';
import { Card, CardHeader, CardBody, Row, Button, Input, Checkbox, Badge, Icon, Icons, confirm, prompt } from '../ui';
import {
  backupDatabase, restoreDatabase, exportBackup, importBackup,
  exportLogs, clearLogs,
} from '../../api';
import { useNotifications } from '../../store/notifications';
import { downloadBlob, errMessage, todayStamp } from './util';
import styles from './settings.module.css';

/** Settings → Data & backup: one backup flow (plain or encrypted), restore, logs. */
export function DataSection() {
  const { addNotification } = useNotifications();

  // ── Backup ──
  const [passphrase, setPassphrase]     = useState('');
  const [includeAudio, setIncludeAudio] = useState(false);
  const [downloading, setDownloading]   = useState(false);
  const [restoring, setRestoring]       = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleDownload() {
    setDownloading(true);
    try {
      if (passphrase.trim()) {
        const blob = await exportBackup(passphrase.trim(), includeAudio);
        downloadBlob(blob, `loom-backup-${todayStamp()}.loombackup`);
        addNotification({ type: 'success', title: 'Encrypted backup saved', message: 'Keep the passphrase somewhere safe — it is the only key.', autoRemoveMs: 5000 });
      } else {
        const blob = await backupDatabase();
        downloadBlob(blob, `loom-backup-${todayStamp()}.sqlite3`);
        addNotification({ type: 'success', title: 'Backup saved', autoRemoveMs: 3000 });
      }
    } catch (e) {
      addNotification({ type: 'error', title: 'Backup failed', message: errMessage(e) });
    } finally {
      setDownloading(false);
    }
  }

  async function handleRestoreFile(file: File) {
    setRestoreError(null);
    const encrypted = /\.loombackup$/i.test(file.name);
    let pass: string | null = null;
    if (encrypted) {
      pass = await prompt({
        title: 'Backup passphrase',
        description: `Enter the passphrase used when "${file.name}" was created.`,
        label: 'Passphrase',
        validate: v => (v.trim() ? null : 'A passphrase is required to decrypt this file.'),
      });
      if (pass === null) return;
    }
    const ok = await confirm({
      title: 'Replace the current database?',
      description: `Everything on this device will be replaced with the contents of "${file.name}". A copy of the current database is kept next to it in case you need to go back.`,
      confirmLabel: 'Restore',
      destructive: true,
    });
    if (!ok) return;
    setRestoring(true);
    try {
      if (encrypted) await importBackup(file, pass!.trim());
      else           await restoreDatabase(file);
      addNotification({ type: 'success', title: 'Database restored', autoRemoveMs: 4000 });
      const reload = await confirm({
        title: 'Reload LoomAssist?',
        description: 'The restored data appears after a reload.',
        confirmLabel: 'Reload now',
        cancelLabel: 'Later',
      });
      if (reload) window.location.reload();
    } catch (e) {
      setRestoreError(errMessage(e, 'Could not restore this file.'));
    } finally {
      setRestoring(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // ── Logs ──
  const [logText, setLogText]       = useState<string | null>(null);
  const [logBusy, setLogBusy]       = useState(false);

  async function handleExportLogs() {
    try {
      const text = await exportLogs();
      downloadBlob(new Blob([text], { type: 'text/plain' }), `loom-logs-${todayStamp()}.log`);
    } catch (e) {
      addNotification({ type: 'error', title: 'Export failed', message: errMessage(e, 'Could not export logs.') });
    }
  }

  async function handleViewLogs() {
    if (logText !== null) { setLogText(null); return; }
    setLogBusy(true);
    try {
      const text = await exportLogs();
      setLogText(text.trim() ? text : 'The log is empty.');
    } catch (e) {
      addNotification({ type: 'error', title: 'Could not load logs', message: errMessage(e) });
    } finally {
      setLogBusy(false);
    }
  }

  async function handleClearLogs() {
    const ok = await confirm({
      title: 'Clear the log file?',
      description: 'Removes every log line stored on this device. Crash diagnostics from before now will be lost.',
      confirmLabel: 'Clear logs',
      destructive: true,
    });
    if (!ok) return;
    try {
      await clearLogs();
      setLogText(prev => (prev === null ? null : 'The log is empty.'));
      addNotification({ type: 'success', title: 'Logs cleared', autoRemoveMs: 3000 });
    } catch (e) {
      addNotification({ type: 'error', title: 'Clear failed', message: errMessage(e, 'Could not clear logs.') });
    }
  }

  return (
    <div className={styles.stackLg} id="data">
      <Card as="section" aria-labelledby="settings-backup-title">
        <CardHeader
          title={<span id="settings-backup-title">Data &amp; backup</span>}
          description="Your database lives on this device. Save a copy before big changes and restore it here."
        />
        <CardBody>
          <Row label="Download backup" description="Saves a copy of the local database. Leave the passphrase empty for a plain .sqlite3 file.">
            <Button variant="primary" icon={Icons.download} loading={downloading} onClick={handleDownload}>Download</Button>
          </Row>
          <Row
            top
            label="Encrypt with a passphrase"
            description="Optional. Encrypted backups use AES-256-GCM with a key derived from the passphrase; only that passphrase can open them."
          >
            <div className={styles.stack}>
              <Input
                type="password"
                className={styles.ctlInput}
                placeholder="Passphrase (optional)"
                aria-label="Backup passphrase"
                autoComplete="off"
                value={passphrase}
                onChange={e => setPassphrase(e.target.value)}
              />
              <Checkbox
                label="Include journal audio"
                checked={includeAudio}
                disabled={!passphrase.trim()}
                onChange={e => setIncludeAudio(e.target.checked)}
              />
            </div>
          </Row>
          <Row label="Restore from file" description="Replace the current database with a .sqlite3 or .loombackup file." divider={false}>
            <input
              ref={fileRef}
              type="file"
              accept=".sqlite3,.db,.loombackup"
              className={styles.fileInput}
              aria-label="Choose a backup file to restore"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleRestoreFile(f); }}
            />
            <Button variant="secondary" icon={Icons.upload} loading={restoring} onClick={() => fileRef.current?.click()}>
              Choose file…
            </Button>
          </Row>
          {restoreError && (
            <div className={`${styles.alert} ${styles.alertError}`} role="alert">
              <Icon d={Icons.alertCircle} size={14} className={styles.alertIcon} />
              <span className={styles.alertText}>{restoreError}</span>
            </div>
          )}
        </CardBody>
      </Card>

      <Card as="section" id="logs" aria-labelledby="settings-logs-title">
        <CardHeader
          title={<span id="settings-logs-title">Logs</span>}
          description="Diagnostics written by the app. Useful when reporting a problem."
          actions={logText !== null ? <Badge tone="neutral">Showing last 500 lines</Badge> : undefined}
        />
        <CardBody>
          <Row label="Export logs" description="Download the most recent log lines as a text file.">
            <Button variant="secondary" icon={Icons.download} onClick={handleExportLogs}>Export</Button>
          </Row>
          <Row label="View logs" description="Show the recent log lines here.">
            <Button variant="secondary" icon={logText !== null ? Icons.eyeOff : Icons.eye} loading={logBusy} onClick={handleViewLogs}>
              {logText !== null ? 'Hide' : 'View'}
            </Button>
          </Row>
          <Row label="Clear logs" description="Delete the local log file." divider={false}>
            <Button variant="ghost" icon={Icons.trash} onClick={handleClearLogs}>Clear…</Button>
          </Row>
          {logText !== null && (
            <pre className={styles.logView} tabIndex={0} aria-label="Recent log lines">{logText}</pre>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
