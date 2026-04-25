import { useState, useEffect, useCallback } from 'react';
import type { ChangeEvent } from 'react';
import { exportLogs, clearLogs, backupDatabase, restoreDatabase, getWeeklyReview, reindexSearch,
  listSubscriptions, createSubscription, deleteSubscription, refreshSubscription,
  listCalendars as listCalendarsForSubs,
  exportBackup, importBackup,
} from '../api';
import type { Subscription, Calendar as CalendarType } from '../types';
import { DurationStatsPanel } from '../components/shared/DurationStatsPanel';
import { lastMonday } from '../lib/eventUtils';
import { useModal } from '../contexts/ModalContext';
import { useNotifications } from '../store/notifications';
import {
  loadKeybinds, saveKeybind, resetKeybinds, formatKeyLabel, KEYBIND_DEFAULTS,
  type KeybindAction, type KeybindDef,
} from '../lib/keybindConfig';
import styles from './SettingsPage.module.css';

const ACTION_ORDER: KeybindAction[] = [
  'new_event', 'today', 'sidebar_toggle', 'focus_mode',
  'view_month', 'view_week', 'view_day', 'view_agenda',
];

export function SettingsPage() {
  const { addNotification } = useNotifications();
  const { openWeeklyReview } = useModal();

  // ---- Appearance ----
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('loom-theme') === 'light' ? 'light' : 'dark'),
  );

  useEffect(() => {
    document.body.classList.toggle('light-mode', theme === 'light');
    localStorage.setItem('loom-theme', theme);
  }, [theme]);

  // ---- Subscriptions (Phase 9) ----
  const [subs, setSubs]           = useState<Subscription[]>([]);
  const [subTimelines, setSubTLs] = useState<CalendarType[]>([]);
  const [newSubName, setNewSubName] = useState('');
  const [newSubUrl, setNewSubUrl]   = useState('');
  const [newSubTlId, setNewSubTlId] = useState<number | null>(null);
  const [newSubMin, setNewSubMin]   = useState(360);
  const [addingSub, setAddingSub]   = useState(false);

  const loadSubs = useCallback(() => { listSubscriptions().then(setSubs).catch(() => {}); }, []);
  useEffect(() => {
    loadSubs();
    listCalendarsForSubs().then(cs => { setSubTLs(cs); if (cs[0]) setNewSubTlId(cs[0].id); }).catch(() => {});
  }, [loadSubs]);

  async function handleAddSub() {
    if (!newSubUrl.trim() || !newSubTlId) return;
    await createSubscription({ name: newSubName.trim() || newSubUrl.trim(), url: newSubUrl.trim(), timeline_id: newSubTlId, refresh_minutes: newSubMin, enabled: true });
    setNewSubName(''); setNewSubUrl(''); setAddingSub(false);
    loadSubs();
  }

  async function handleDeleteSub(id: number) {
    await deleteSubscription(id);
    loadSubs();
  }

  async function handleRefreshSub(id: number) {
    try {
      await refreshSubscription(id);
      addNotification({ type: 'success', title: 'Refreshed', autoRemoveMs: 3000 });
      loadSubs();
    } catch {
      addNotification({ type: 'error', title: 'Refresh failed' });
    }
  }

  function subStatus(sub: Subscription): string {
    if (sub.last_error) return `Error: ${sub.last_error.slice(0, 60)}`;
    if (sub.last_synced) {
      const mins = Math.round((Date.now() - new Date(sub.last_synced).getTime()) / 60_000);
      return `Synced ${mins < 1 ? 'just now' : `${mins} min ago`}`;
    }
    return 'Never synced';
  }

  // ---- Crash reports ----
  const [crashReports, setCrashReports] = useState<boolean>(
    () => localStorage.getItem('loom_crash_reports_enabled') !== 'false',
  );

  // ---- Drag shader (Phase 2) ----
  const [dragShader, setDragShader] = useState<boolean>(
    () => localStorage.getItem('loom_drag_shader_enabled') !== 'false',
  );
  function handleDragShaderToggle(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.checked;
    setDragShader(val);
    localStorage.setItem('loom_drag_shader_enabled', val ? 'true' : 'false');
  }

  // ---- Keybinds ----
  const [keybinds, setKeybinds] = useState(loadKeybinds);
  const [capturing, setCapturing] = useState<KeybindAction | null>(null);

  const refreshKeybinds = useCallback(() => setKeybinds(loadKeybinds()), []);

  useEffect(() => {
    window.addEventListener('loom-keybinds-changed', refreshKeybinds);
    return () => window.removeEventListener('loom-keybinds-changed', refreshKeybinds);
  }, [refreshKeybinds]);

  function startCapture(action: KeybindAction) {
    setCapturing(action);
  }

  useEffect(() => {
    if (!capturing) return;

    function onKeyDown(e: globalThis.KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(null); return; }
      // Ignore lone modifiers
      if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;
      const label = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const def: Partial<KeybindDef> = {
        key: e.key.toLowerCase(),
        label,
        ctrl:  e.ctrlKey  || undefined,
        meta:  e.metaKey  || undefined,
        shift: e.shiftKey || undefined,
      };
      if (!capturing) return;
      saveKeybind(capturing, def);
      setCapturing(null);
    }

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [capturing]);

  // ---- Handlers ----
  async function handleExportLogs() {
    try {
      const text = await exportLogs();
      const blob = new Blob([text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `loom-logs-${Date.now()}.log`;
      a.click();
    } catch {
      addNotification({ type: 'error', title: 'Export failed', message: 'Could not export logs.' });
    }
  }

  async function handleClearLogs() {
    try {
      await clearLogs();
      addNotification({ type: 'success', title: 'Logs cleared', autoRemoveMs: 3000 });
    } catch {
      addNotification({ type: 'error', title: 'Clear failed', message: 'Could not clear logs.' });
    }
  }

  function handleCrashToggle(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.checked;
    setCrashReports(val);
    localStorage.setItem('loom_crash_reports_enabled', val ? 'true' : 'false');
  }

  async function handleBackup() {
    try {
      const result = await backupDatabase();
      addNotification({ type: 'success', title: 'Backup created', message: result.path });
    } catch {
      addNotification({ type: 'error', title: 'Backup failed', message: 'Could not create backup.' });
    }
  }

  // ---- Weekly Review ----
  const [reviewLoading, setReviewLoading] = useState(false);

  async function handleWeeklyReview() {
    setReviewLoading(true);
    try {
      const weekStart = lastMonday();
      const result = await getWeeklyReview(weekStart.toISOString());
      openWeeklyReview(result.summary, weekStart.toISOString());
    } catch {
      addNotification({ type: 'error', title: 'Review failed', message: 'Could not generate weekly review. Is Ollama running?' });
    } finally {
      setReviewLoading(false);
    }
  }

  async function handleRestore() {
    const path = window.prompt('Enter backup file path:');
    if (!path?.trim()) return;
    try {
      await restoreDatabase(path.trim());
      addNotification({ type: 'success', title: 'Database restored', autoRemoveMs: 4000 });
    } catch {
      addNotification({ type: 'error', title: 'Restore failed', message: 'Could not restore database.' });
    }
  }

  // ---- Encrypted Backup (Phase 13) ----
  const [encPassphrase, setEncPassphrase]       = useState('');
  const [encIncludeAudio, setEncIncludeAudio]   = useState(false);
  const [encExporting, setEncExporting]         = useState(false);
  const [encImporting, setEncImporting]         = useState(false);
  const [encImportFile, setEncImportFile]       = useState<File | null>(null);
  const [encImportPass, setEncImportPass]       = useState('');

  async function handleEncExport() {
    if (!encPassphrase.trim()) {
      addNotification({ type: 'warning', title: 'Passphrase required', message: 'Enter a passphrase to encrypt the backup.' });
      return;
    }
    setEncExporting(true);
    try {
      const blob = await exportBackup(encPassphrase.trim(), encIncludeAudio);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `loom-backup-${new Date().toISOString().slice(0, 10)}.loombackup`;
      a.click();
      addNotification({ type: 'success', title: 'Backup exported', autoRemoveMs: 4000 });
    } catch (err) {
      addNotification({ type: 'error', title: 'Export failed', message: String(err) });
    } finally {
      setEncExporting(false);
    }
  }

  async function handleEncImport() {
    if (!encImportFile) {
      addNotification({ type: 'warning', title: 'No file selected', message: 'Choose a .loombackup file.' });
      return;
    }
    if (!encImportPass.trim()) {
      addNotification({ type: 'warning', title: 'Passphrase required', message: 'Enter the passphrase used when exporting.' });
      return;
    }
    const confirmed = window.confirm(
      'This will replace your current database. A pre-restore backup will be saved automatically. Proceed?'
    );
    if (!confirmed) return;
    setEncImporting(true);
    try {
      const result = await importBackup(encImportFile, encImportPass.trim());
      addNotification({ type: 'success', title: 'Database restored', message: result.message, autoRemoveMs: 5000 });
      setEncImportFile(null);
      setEncImportPass('');
    } catch (err) {
      addNotification({ type: 'error', title: 'Import failed', message: String(err) });
    } finally {
      setEncImporting(false);
    }
  }

  return (
    <div className={styles.page}>

      {/* Appearance */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Appearance</h2>
        <div className={styles.themeToggle} onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} style={{ cursor: 'pointer' }}>
          <div className={`${styles.toggleTrack} ${theme === 'light' ? styles.on : ''}`}>
            <div className={styles.toggleThumb} />
          </div>
          <span className={styles.themeLabel}>Light mode</span>
        </div>
      </section>

      {/* Keyboard Shortcuts */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Keyboard Shortcuts</h2>
        <div className={styles.kbTable}>
          {ACTION_ORDER.map(action => {
            const def = keybinds[action];
            const isCapturing = capturing === action;
            return (
              <div key={action} className={styles.kbRow}>
                <span className={styles.kbDesc}>{KEYBIND_DEFAULTS[action].description}</span>
                <div className={styles.kbCurrent}>
                  <span className={`${styles.kbChip} ${isCapturing ? styles.kbCapturing : ''}`}>
                    {isCapturing ? 'Press key…' : formatKeyLabel(def)}
                  </span>
                </div>
                <button
                  className={styles.kbEditBtn}
                  onClick={() => isCapturing ? setCapturing(null) : startCapture(action)}
                >
                  {isCapturing ? 'Cancel' : 'Change'}
                </button>
              </div>
            );
          })}
        </div>
        <div className={styles.kbResetRow}>
          <button className="loom-btn-ghost" style={{ fontSize: 12 }} onClick={() => { resetKeybinds(); setCapturing(null); }}>
            Reset to defaults
          </button>
        </div>
      </section>

      {/* Log Viewer */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Log Viewer</h2>
        <div className={styles.row}>
          <button className="loom-btn-primary" onClick={handleExportLogs}>Export Logs</button>
          <button className="loom-btn-ghost" onClick={handleClearLogs}>Clear Logs</button>
        </div>
      </section>

      {/* Crash Reports */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Crash Reports</h2>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={crashReports} onChange={handleCrashToggle} />
          <span>Enable crash reporting</span>
        </label>
      </section>

      {/* Calendar */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Calendar</h2>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={dragShader} onChange={handleDragShaderToggle} />
          <span>Show conflict preview while dragging events</span>
        </label>
      </section>

      {/* Subscriptions */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          iCal Subscriptions
          <button onClick={() => setAddingSub(a => !a)} style={{ marginLeft: 10, fontSize: 11, padding: '2px 8px' }} className="loom-btn-ghost">
            {addingSub ? 'Cancel' : '+ Add'}
          </button>
        </h2>

        {addingSub && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <input className="loom-field" placeholder="Name" value={newSubName} onChange={e => setNewSubName(e.target.value)} style={{ fontSize: 12 }} />
            <input className="loom-field" placeholder="URL (https://…)" value={newSubUrl} onChange={e => setNewSubUrl(e.target.value)} style={{ fontSize: 12 }} />
            <select className="loom-field" value={newSubTlId ?? ''} onChange={e => setNewSubTlId(Number(e.target.value))} style={{ fontSize: 12 }}>
              {subTimelines.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              Refresh every
              <input type="number" min={5} className="loom-field" value={newSubMin} onChange={e => setNewSubMin(Number(e.target.value))} style={{ width: 70, fontSize: 12 }} />
              minutes
            </div>
            <button className="loom-btn-primary" onClick={handleAddSub} style={{ alignSelf: 'flex-start', fontSize: 12 }}>Subscribe</button>
          </div>
        )}

        {subs.length === 0 && !addingSub && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No subscriptions. Add a URL to a public .ics calendar.</div>
        )}

        {subs.map(sub => (
          <div key={sub.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-main)' }}>{sub.name}</div>
              <div style={{ fontSize: 11, color: sub.last_error ? 'var(--error)' : 'var(--text-muted)' }}>{subStatus(sub)}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="loom-btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => handleRefreshSub(sub.id)}>Refresh</button>
              <button className="loom-btn-ghost" style={{ fontSize: 11, padding: '2px 8px', color: 'var(--error)' }} onClick={() => handleDeleteSub(sub.id)}>Delete</button>
            </div>
          </div>
        ))}
      </section>

      {/* Search */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Search</h2>
        <div className={styles.row}>
          <button className="loom-btn-ghost" onClick={async () => {
            try {
              const res = await reindexSearch();
              addNotification({ type: 'success', title: 'Re-indexed', message: `${res.reindexed} events indexed for semantic search.`, autoRemoveMs: 4000 });
            } catch {
              addNotification({ type: 'error', title: 'Re-index failed', message: 'Could not index events.' });
            }
          }}>
            Re-index Semantic Search
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          Run once after enabling semantic search or after a model upgrade.
        </p>
      </section>

      {/* Database — plain backup */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Database</h2>
        <div className={styles.row}>
          <button className="loom-btn-primary" onClick={handleBackup}>Backup Database</button>
          <button className="loom-btn-ghost" onClick={handleRestore}>Restore Database…</button>
        </div>
      </section>

      {/* Backup & Restore (Phase 13 — encrypted) */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Backup &amp; Restore</h2>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          Encrypted backups are AES-256-GCM with a key derived from your passphrase (scrypt). Only you can decrypt them.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 13, color: 'var(--text-main)', fontWeight: 600 }}>Export</label>
          <input
            type="password"
            placeholder="Passphrase"
            value={encPassphrase}
            onChange={e => setEncPassphrase(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-main)', fontSize: 13, width: 260 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={encIncludeAudio} onChange={e => setEncIncludeAudio(e.target.checked)} />
            Include saved journal audio files
          </label>
          <button className="loom-btn-primary" onClick={handleEncExport} disabled={encExporting} style={{ width: 'fit-content' }}>
            {encExporting ? 'Exporting…' : 'Export .loombackup'}
          </button>
        </div>

        <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 13, color: 'var(--text-main)', fontWeight: 600 }}>Import</label>
          <input
            type="file"
            accept=".loombackup"
            onChange={e => setEncImportFile(e.target.files?.[0] ?? null)}
            style={{ fontSize: 12, color: 'var(--text-muted)' }}
          />
          <input
            type="password"
            placeholder="Passphrase"
            value={encImportPass}
            onChange={e => setEncImportPass(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-main)', fontSize: 13, width: 260 }}
          />
          <button className="loom-btn-ghost" onClick={handleEncImport} disabled={encImporting} style={{ width: 'fit-content' }}>
            {encImporting ? 'Restoring…' : 'Restore from .loombackup'}
          </button>
        </div>
      </section>

      {/* Time Accuracy */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Time Accuracy</h2>
        <DurationStatsPanel />
      </section>

      {/* Weekly Review */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Weekly Review</h2>
        <p className={styles.info}>Generate an AI summary of last week and a preview of the week ahead.</p>
        <button className="loom-btn-primary" onClick={handleWeeklyReview} disabled={reviewLoading}>
          {reviewLoading ? 'Generating…' : 'Generate Review'}
        </button>
      </section>

      {/* App Info */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>App Info</h2>
        <p className={styles.info}>
          LoomAssist v1.5<br />
          License: MIT<br />
          Platform: macOS
        </p>
      </section>

    </div>
  );
}

export function SettingsSidebarContent() {
  return null;
}
