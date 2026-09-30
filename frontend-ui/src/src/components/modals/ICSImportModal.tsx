import { useState, useRef, useId } from 'react';
import { ModalShell, ModalFooter, ModalStack, ModalNotice } from './ModalShell';
import { Button, Field, Select, Badge, Icon, Icons } from '../ui';
import { useModal } from '../../contexts/ModalContext';
import { useNotifications } from '../../store/notifications';
import { importICS } from '../../api';
import type { Calendar } from '../../types';
import styles from './FileImport.module.css';

interface ICSImportModalProps {
  timelines: Calendar[];
  onSaved: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ICSImportModal({ timelines, onSaved }: ICSImportModalProps) {
  const { close } = useModal();
  const { addNotification } = useNotifications();
  const ids = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [calendarId, setCalendarId] = useState<number>(timelines[0]?.id ?? 0);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(f: File | null | undefined) {
    if (!f) return;
    if (!/\.ics$/i.test(f.name)) { setError('Choose a .ics calendar file.'); return; }
    setError(null);
    setFile(f);
  }

  async function handleSubmit() {
    if (!file || !calendarId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await importICS(file, calendarId);
      setResult({ added: r.events_added, skipped: r.events_skipped });
      addNotification({
        type: 'success',
        title: 'Calendar file imported',
        message: `${r.events_added} added, ${r.events_skipped} skipped`,
        autoRemoveMs: 4000,
      });
      onSaved();
    } catch {
      setError('Could not import that file. Check that it is a valid iCalendar (.ics) export.');
    } finally {
      setLoading(false);
    }
  }

  const timeline = timelines.find(t => t.id === calendarId);

  return (
    <ModalShell title="Import a calendar file" subtitle="Add events from an .ics export" size="sm" onClose={close}>
      <ModalStack>
        {result ? (
          <div className={styles.result}>
            <span className={styles.resultIcon}><Icon d={Icons.checkCircle} size={20} /></span>
            <div className={styles.resultText}>
              <div className={styles.resultTitle}>Import finished</div>
              <div className={styles.badges}>
                <Badge tone="success" dot>{result.added} added</Badge>
                <Badge tone="neutral" dot>{result.skipped} skipped</Badge>
                {timeline && <Badge color={timeline.color} outline>{timeline.name}</Badge>}
              </div>
              {result.skipped > 0 && <div className={styles.resultHint}>Skipped events already existed on this timeline.</div>}
            </div>
          </div>
        ) : (
          <>
            <label
              className={[styles.dropZone, dragOver ? styles.dropZoneActive : '', file ? styles.dropZoneHasFile : ''].join(' ')}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); }}
            >
              <input
                ref={fileRef}
                id={`${ids}-file`}
                type="file"
                accept=".ics,text/calendar"
                className={styles.fileInput}
                onChange={e => pick(e.target.files?.[0])}
              />
              <span className={styles.dropIcon}><Icon d={file ? Icons.file : Icons.upload} size={20} /></span>
              {file ? (
                <>
                  <span className={styles.dropTitle}>{file.name}</span>
                  <span className={styles.dropHint}>{formatSize(file.size)} · click to choose a different file</span>
                </>
              ) : (
                <>
                  <span className={styles.dropTitle}>Drop an .ics file here</span>
                  <span className={styles.dropHint}>or click to browse</span>
                </>
              )}
            </label>

            <Field label="Add to timeline" htmlFor={`${ids}-tl`}>
              <Select id={`${ids}-tl`} value={calendarId} onChange={e => setCalendarId(Number(e.target.value))}>
                {timelines.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>

            {error && <ModalNotice tone="error" icon={<Icon d={Icons.alertCircle} size={13} />}>{error}</ModalNotice>}
          </>
        )}
      </ModalStack>

      <ModalFooter>
        {result ? (
          <Button variant="primary" onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" icon={Icons.download} onClick={() => { void handleSubmit(); }} disabled={!file || !calendarId} loading={loading}>
              Import
            </Button>
          </>
        )}
      </ModalFooter>
    </ModalShell>
  );
}
