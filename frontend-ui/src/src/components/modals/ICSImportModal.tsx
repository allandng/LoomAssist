import { useState, useRef } from 'react';
import { ModalShell, ModalFooter, FieldLabel } from './ModalShell';
import { useModal } from '../../contexts/ModalContext';
import { useNotifications } from '../../store/notifications';
import { importICS } from '../../api';
import type { Calendar } from '../../types';

interface ICSImportModalProps {
  timelines: Calendar[];
  onSaved: () => void;
}

export function ICSImportModal({ timelines, onSaved }: ICSImportModalProps) {
  const { close } = useModal();
  const { addNotification } = useNotifications();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [calendarId, setCalendarId] = useState<number>(timelines[0]?.id ?? 0);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!file || !calendarId) return;
    setLoading(true);
    try {
      const result = await importICS(file, calendarId);
      addNotification({
        type: 'success',
        title: 'ICS imported',
        message: `${result.events_added} added, ${result.events_skipped} skipped`,
        autoRemoveMs: 4000,
      });
      onSaved();
      close();
    } catch {
      addNotification({ type: 'error', title: 'Import failed', message: 'Could not import ICS file.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell title="Import ICS" width={420} onClose={close}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <FieldLabel>ICS file</FieldLabel>
          <input
            ref={fileRef}
            type="file"
            accept=".ics"
            className="loom-field"
            style={{ padding: '6px 8px', cursor: 'pointer' }}
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <FieldLabel>Add to timeline</FieldLabel>
          <select
            className="loom-field"
            value={calendarId}
            onChange={e => setCalendarId(Number(e.target.value))}
          >
            {timelines.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>
      <ModalFooter>
        <button className="loom-btn-ghost" onClick={close}>Cancel</button>
        <button
          className="loom-btn-primary"
          onClick={handleSubmit}
          disabled={!file || !calendarId || loading}
        >
          {loading ? 'Importing…' : 'Import'}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}
