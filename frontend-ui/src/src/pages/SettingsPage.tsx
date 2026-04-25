import { useState, useEffect, useCallback } from 'react';
import type { ChangeEvent } from 'react';
import { exportLogs, clearLogs, backupDatabase, restoreDatabase, getWeeklyReview, reindexSearch } from '../api';
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

      {/* Database */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Database</h2>
        <div className={styles.row}>
          <button className="loom-btn-primary" onClick={handleBackup}>Backup Database</button>
          <button className="loom-btn-ghost" onClick={handleRestore}>Restore Database…</button>
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
