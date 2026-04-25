import { useState, useEffect } from 'react';
import { ModalShell, ModalFooter, FieldLabel } from './ModalShell';
import { useModal } from '../../contexts/ModalContext';
import { useNotifications } from '../../store/notifications';
import { extractSyllabus, saveApprovedEvents, listCourses } from '../../api';
import type { SyllabusEvent, Course } from '../../types';

interface SyllabusModalProps {
  onSaved: () => void;
}

export function SyllabusModal({ onSaved }: SyllabusModalProps) {
  const { close } = useModal();
  const { addNotification } = useNotifications();
  const [file, setFile] = useState<File | null>(null);
  const [events, setEvents] = useState<SyllabusEvent[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  useEffect(() => { listCourses().then(setCourses).catch(() => {}); }, []);

  async function handleScan() {
    if (!file) return;
    setLoading(true);
    setEvents(null);
    try {
      const result = await extractSyllabus(file);
      if (result.length === 0) {
        addNotification({ type: 'warning', title: 'No events found', message: 'The file had no recognisable dates.' });
        setLoading(false);
        return;
      }
      setEvents(result);
      setSelected(new Set(result.map((_, i) => i)));
    } catch {
      addNotification({ type: 'error', title: 'Scan failed', message: 'Could not extract events from file.' });
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
        title: 'Events saved',
        message: `${res.created} event${res.created !== 1 ? 's' : ''} added to calendar`,
        autoRemoveMs: 4000,
      });
      onSaved();
      close();
    } catch {
      addNotification({ type: 'error', title: 'Save failed', message: 'Could not save events.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Scan File" width={520} onClose={close}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!events && (
          <>
            <div>
              <FieldLabel>PDF file</FieldLabel>
              <input
                type="file"
                accept=".pdf"
                className="loom-field"
                style={{ padding: '6px 8px', cursor: 'pointer' }}
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {courses.length > 0 && (
              <div>
                <FieldLabel>Link to course (optional)</FieldLabel>
                <select
                  className="loom-field"
                  value={courseId ?? ''}
                  onChange={e => setCourseId(Number(e.target.value) || null)}
                  style={{ fontSize: 13 }}
                >
                  <option value="">None</option>
                  {courses.map(c => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        {events && (
          <div>
            <FieldLabel>
              Found {events.length} event{events.length !== 1 ? 's' : ''} — select to import
            </FieldLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
              {events.map((ev, i) => (
                <label
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 10px',
                    background: 'var(--bg-elevated)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    border: `1px solid ${selected.has(i) ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggleRow(i)}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <span style={{ flex: 1, fontSize: 13 }}>{ev.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{ev.date}</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                className="loom-btn-ghost"
                style={{ fontSize: 12 }}
                onClick={() => setSelected(new Set(events.map((_, i) => i)))}
              >
                Select all
              </button>
              <button
                className="loom-btn-ghost"
                style={{ fontSize: 12 }}
                onClick={() => setSelected(new Set())}
              >
                Deselect all
              </button>
            </div>
          </div>
        )}
      </div>

      <ModalFooter>
        {!events ? (
          <>
            <button className="loom-btn-ghost" onClick={close}>Cancel</button>
            <button
              className="loom-btn-primary"
              onClick={handleScan}
              disabled={!file || loading}
            >
              {loading ? 'Scanning…' : 'Scan'}
            </button>
          </>
        ) : (
          <>
            <button className="loom-btn-ghost" onClick={() => setEvents(null)}>Back</button>
            <button
              className="loom-btn-primary"
              onClick={handleSave}
              disabled={selected.size === 0 || saving}
            >
              {saving ? 'Saving…' : `Save ${selected.size} event${selected.size !== 1 ? 's' : ''}`}
            </button>
          </>
        )}
      </ModalFooter>
    </ModalShell>
  );
}
