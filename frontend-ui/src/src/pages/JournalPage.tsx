import { useState, useEffect, useCallback } from 'react';
import { listJournal, deleteJournalEntry } from '../api';
import type { JournalEntry } from '../types';
import { JournalRecorder } from '../components/journal/JournalRecorder';
import { Icon, Icons } from '../components/shared/Icon';

const MOOD_ICON: Record<string, string> = { great: '😊', ok: '😐', rough: '😔' };

export function JournalPage() {
  const [entries, setEntries]     = useState<JournalEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saveAudio, setSaveAudio] = useState(
    () => localStorage.getItem('loom_journal_save_audio') === 'true',
  );

  const load = useCallback(() => {
    setLoading(true);
    listJournal().then(setEntries).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleSaveAudio() {
    setSaveAudio(v => {
      const next = !v;
      localStorage.setItem('loom_journal_save_audio', next ? 'true' : 'false');
      return next;
    });
  }

  async function handleDelete(id: number) {
    await deleteJournalEntry(id);
    load();
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>Voice Journal</h1>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={saveAudio} onChange={toggleSaveAudio} />
          Save audio files
        </label>
      </div>

      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 24 }}>
        <JournalRecorder saveAudio={saveAudio} onSaved={entry => { setEntries(prev => [entry, ...prev]); }} />
      </div>

      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>}

      {!loading && entries.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', marginTop: 40 }}>
          No journal entries yet. Record your first reflection above.
        </div>
      )}

      {/* Mood timeline */}
      {entries.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
          {entries.slice(0, 14).map(e => (
            <div key={e.id} title={`${e.date}: ${e.mood ?? 'no mood'}`} style={{ fontSize: 18 }}>
              {e.mood ? MOOD_ICON[e.mood] : '⬜'}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map(entry => (
          <div key={entry.id} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>{entry.date}</span>
                {entry.mood && <span style={{ fontSize: 16 }}>{MOOD_ICON[entry.mood]}</span>}
              </div>
              <button onClick={() => handleDelete(entry.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <Icon d={Icons.x} size={14} />
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-main)', lineHeight: 1.6 }}>{entry.transcript || <em style={{ color: 'var(--text-muted)' }}>No transcript</em>}</p>
            {entry.audio_path && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-dim)' }}>Audio saved</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function JournalSidebarContent() { return null; }
