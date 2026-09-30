import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './JournalPage.module.css';
import {
  Badge, Button, Card, EmptyState, Icons, Page, PageHeader, Section, Skeleton, Switch, confirm,
} from '../components/ui';
import { listJournal, deleteJournalEntry, listEvents } from '../api';
import type { JournalEntry } from '../types';
import { useNotifications } from '../store/notifications';
import { JournalRecorder, RECORD_BUTTON_ID } from '../components/journal/JournalRecorder';
import { JournalEntryRow } from '../components/journal/JournalEntryRow';
import { MoodTimeline } from '../components/journal/MoodTimeline';
import { dayHeading } from '../components/inbox/timeFormat';

const SAVE_AUDIO_KEY = 'loom_journal_save_audio';

function readSaveAudio(): boolean {
  try { return localStorage.getItem(SAVE_AUDIO_KEY) === 'true'; } catch { return false; }
}

export function JournalPage() {
  const { addNotification } = useNotifications();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [saveAudio, setSaveAudio] = useState(readSaveAudio);
  const [eventTitles, setEventTitles] = useState<Record<number, string>>({});

  // State is only set inside promise callbacks so the mount effect never sets
  // state synchronously (react-hooks/set-state-in-effect).
  const fetchEntries = useCallback(() =>
    listJournal()
      .then(rows => { setEntries(rows); setError(null); })
      .catch(() => { setError('Could not load journal entries. Is the backend running?'); })
      .finally(() => { setLoading(false); }),
  []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  function retry() { setLoading(true); fetchEntries(); }

  // Resolve linked event titles once, only when some entry points at an event.
  const needsEvents = useMemo(() => entries.some(e => e.event_id != null), [entries]);
  useEffect(() => {
    if (!needsEvents) return;
    let cancelled = false;
    listEvents()
      .then(evs => {
        if (cancelled) return;
        const map: Record<number, string> = {};
        for (const ev of evs) map[ev.id] = ev.title;
        setEventTitles(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [needsEvents]);

  function toggleSaveAudio(next: boolean) {
    setSaveAudio(next);
    try { localStorage.setItem(SAVE_AUDIO_KEY, next ? 'true' : 'false'); } catch { /* storage unavailable */ }
  }

  const handleSaved = useCallback((entry: JournalEntry) => {
    setEntries(prev => [entry, ...prev.filter(e => e.id !== entry.id)]);
    addNotification({ type: 'success', title: 'Entry saved', message: entry.transcript ? undefined : 'No speech was detected.', autoRemoveMs: 3500 });
  }, [addNotification]);

  const removeEntry = useCallback(async (entry: JournalEntry, ask: boolean): Promise<boolean> => {
    if (ask) {
      const ok = await confirm({
        title: 'Delete this entry?',
        description: `The transcript${entry.audio_path ? ' and its audio file' : ''} will be removed. This cannot be undone.`,
        destructive: true,
        confirmLabel: 'Delete',
      });
      if (!ok) return false;
    }
    setDeletingId(entry.id);
    try {
      await deleteJournalEntry(entry.id);
      setEntries(prev => prev.filter(e => e.id !== entry.id));
      return true;
    } catch {
      addNotification({ type: 'error', title: 'Could not delete the entry', autoRemoveMs: 5000 });
      return false;
    } finally {
      setDeletingId(null);
    }
  }, [addNotification]);

  const handleDiscard = useCallback((entry: JournalEntry) => removeEntry(entry, true), [removeEntry]);
  const handleDelete = useCallback((entry: JournalEntry) => { removeEntry(entry, true); }, [removeEntry]);

  const groups = useMemo(() => {
    const sorted = [...entries].sort((a, b) => (b.date.localeCompare(a.date)) || b.created_at.localeCompare(a.created_at));
    const out: { date: string; rows: JournalEntry[] }[] = [];
    for (const e of sorted) {
      const last = out[out.length - 1];
      if (last && last.date === e.date) last.rows.push(e);
      else out.push({ date: e.date, rows: [e] });
    }
    return out;
  }, [entries]);

  return (
    <Page narrow>
      <PageHeader
        title="Journal"
        description="A one-minute reflection a day. Everything stays on this device."
        actions={<Switch checked={saveAudio} onChange={toggleSaveAudio} label="Save audio files" size="sm" />}
      />

      <div className={styles.stack}>
        <JournalRecorder saveAudio={saveAudio} onSaved={handleSaved} onDiscard={handleDiscard} />

        {!loading && entries.length > 0 && (
          <Section title="Mood" description="Last 30 days" small>
            <Card>
              <div className={styles.timelineBody}>
                <MoodTimeline entries={entries} />
              </div>
            </Card>
          </Section>
        )}

        {loading && (
          <Section title="Entries" small>
            <Card flush>
              <div aria-busy="true">
                {[0, 1, 2].map(i => (
                  <div key={i} className={styles.skeletonRow}>
                    <div className={styles.skeletonMeta}>
                      <Skeleton width={64} height={17} radius={999} />
                      <Skeleton width={48} height={11} />
                    </div>
                    <Skeleton width="92%" height={13} />
                    <Skeleton width="70%" height={13} />
                  </div>
                ))}
              </div>
            </Card>
          </Section>
        )}

        {!loading && error && (
          <Card>
            <div className={styles.errorRow}>
              <Badge tone="error" dot>{error}</Badge>
              <Button size="sm" variant="subtle" onClick={retry}>Retry</Button>
            </div>
          </Card>
        )}

        {!loading && !error && entries.length === 0 && (
          <Card>
            <EmptyState
              icon={Icons.journal}
              title="No entries yet"
              description="Record your first reflection above, or write one down."
              action={{ label: 'Record', icon: Icons.mic, onClick: () => document.getElementById(RECORD_BUTTON_ID)?.focus() }}
            />
          </Card>
        )}

        {!loading && groups.map(group => (
          <Section key={group.date} title={dayHeading(group.date)} small>
            <Card flush>
              <ul className={styles.entryList}>
                {group.rows.map(entry => (
                  <JournalEntryRow
                    key={entry.id}
                    entry={entry}
                    eventTitle={entry.event_id != null ? eventTitles[entry.event_id] ?? null : null}
                    onDelete={handleDelete}
                    deleting={deletingId === entry.id}
                  />
                ))}
              </ul>
            </Card>
          </Section>
        ))}
      </div>
    </Page>
  );
}
