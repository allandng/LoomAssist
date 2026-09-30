import { useState, useEffect, useId } from 'react';
import { ModalShell, ModalFooter, ModalStack, ModalNotice } from './ModalShell';
import { Button, Field, Select, Checkbox, Badge, Icon, Icons } from '../ui';
import { useModal } from '../../contexts/ModalContext';
import { useNotifications } from '../../store/notifications';
import { extractSyllabus, saveApprovedEvents, listCourses } from '../../api';
import type { SyllabusEvent, Course } from '../../types';
import styles from './FileImport.module.css';

interface SyllabusModalProps {
  onSaved: () => void;
}

function formatDate(ds: string): string {
  const d = new Date(`${ds}T00:00`);
  return isNaN(d.getTime()) ? ds : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function SyllabusModal({ onSaved }: SyllabusModalProps) {
  const { close } = useModal();
  const { addNotification } = useNotifications();
  const ids = useId();
  const [file, setFile] = useState<File | null>(null);
  const [events, setEvents] = useState<SyllabusEvent[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  useEffect(() => { listCourses().then(setCourses).catch(() => {}); }, []);

  function pick(f: File | null | undefined) {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) { setError('Choose a PDF syllabus.'); return; }
    setError(null);
    setFile(f);
  }

  async function handleScan() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setEvents(null);
    try {
      const result = await extractSyllabus(file);
      if (result.length === 0) {
        setError('No dates were recognised in that file. Try a syllabus with a schedule or due-date table.');
        return;
      }
      setEvents(result);
      setSelected(new Set(result.map((_, i) => i)));
    } catch {
      setError('Could not read that file. Check that it is a text PDF, not a scan.');
    } finally {
      setLoading(false);
    }
  }

  function toggleRow(i: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function handleSave() {
    if (!events) return;
    const approved = events.filter((_, i) => selected.has(i));
    if (approved.length === 0) return;
    setSaving(true);
    try {
      const res = await saveApprovedEvents(approved, courseId ?? undefined);
      addNotification({
        type: 'success',
        title: 'Events added',
        message: `${res.created} event${res.created !== 1 ? 's' : ''} added to your calendar`,
        autoRemoveMs: 4000,
      });
      onSaved();
      close();
    } catch {
      setError('Could not save the events. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const courseSelect = courses.length > 0 && (
    <Field label="Link to course" htmlFor={`${ids}-course`} hint="Optional — dated items also become assignments for the course.">
      <Select id={`${ids}-course`} value={courseId ?? ''} onChange={e => setCourseId(Number(e.target.value) || null)}>
        <option value="">No course</option>
        {courses.map(c => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>)}
      </Select>
    </Field>
  );

  return (
    <ModalShell
      title="Scan a syllabus"
      subtitle={events ? `${events.length} dated item${events.length !== 1 ? 's' : ''} found in ${file?.name ?? 'the file'}` : 'Pull deadlines and exams out of a PDF'}
      size="md"
      onClose={close}
      confirmOnClose={!!events}
    >
      <ModalStack>
        {!events && (
          <>
            <label
              className={[styles.dropZone, dragOver ? styles.dropZoneActive : '', file ? styles.dropZoneHasFile : ''].join(' ')}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); }}
            >
              <input
                id={`${ids}-file`}
                type="file"
                accept=".pdf,application/pdf"
                className={styles.fileInput}
                onChange={e => pick(e.target.files?.[0])}
              />
              <span className={styles.dropIcon}><Icon d={file ? Icons.doc : Icons.upload} size={20} /></span>
              {file ? (
                <>
                  <span className={styles.dropTitle}>{file.name}</span>
                  <span className={styles.dropHint}>Click to choose a different file</span>
                </>
              ) : (
                <>
                  <span className={styles.dropTitle}>Drop a syllabus PDF here</span>
                  <span className={styles.dropHint}>or click to browse</span>
                </>
              )}
            </label>
            {courseSelect}
          </>
        )}

        {events && (
          <>
            <div className={styles.tableHead}>
              <span className={styles.tableTitle}>{selected.size} of {events.length} selected</span>
              <div className={styles.tableActions}>
                <Button variant="subtle" size="sm" onClick={() => setSelected(new Set(events.map((_, i) => i)))}>Select all</Button>
                <Button variant="subtle" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            </div>
            <div className={styles.rows} role="list" aria-label="Extracted events">
              {events.map((ev, i) => {
                const on = selected.has(i);
                return (
                  <div key={i} role="listitem" className={[styles.rowItem, on ? '' : styles.rowOff].join(' ')}>
                    <Checkbox round checked={on} onChange={() => toggleRow(i)} aria-label={`Include ${ev.title}`} />
                    <span className={styles.rowTitle}>{ev.title}</span>
                    {ev.start_time && <Badge size="sm" icon={Icons.clock}>{ev.start_time}</Badge>}
                    <span className={styles.rowDate}>{formatDate(ev.date)}</span>
                  </div>
                );
              })}
            </div>
            {courseSelect}
          </>
        )}

        {error && <ModalNotice tone={events ? 'error' : 'warning'} icon={<Icon d={Icons.alertCircle} size={13} />}>{error}</ModalNotice>}
      </ModalStack>

      <ModalFooter left={events ? <Button variant="ghost" icon={Icons.arrowLeft} onClick={() => { setEvents(null); setError(null); }}>Back</Button> : undefined}>
        {!events ? (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" icon={Icons.sparkles} onClick={() => { void handleScan(); }} disabled={!file} loading={loading}>
              {loading ? 'Scanning' : 'Scan'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" icon={Icons.plus} onClick={() => { void handleSave(); }} disabled={selected.size === 0} loading={saving}>
              Add {selected.size} event{selected.size !== 1 ? 's' : ''}
            </Button>
          </>
        )}
      </ModalFooter>
    </ModalShell>
  );
}
