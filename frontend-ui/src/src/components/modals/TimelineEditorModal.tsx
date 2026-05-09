import { useEffect, useState } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { ModalShell, ModalFooter } from './ModalShell';
import { useNotifications } from '../../store/notifications';
import { listCalendars, updateCalendar, createCalendar } from '../../api';
import type { Calendar } from '../../types';

interface TimelineEditorModalProps {
  timelineId?: number;     // undefined = creating a new timeline
  onSaved: () => void;
}

const PALETTE = ['#6366F1', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6', '#EF4444'];

export function TimelineEditorModal({ timelineId, onSaved }: TimelineEditorModalProps) {
  const { close } = useModal();
  const { addNotification } = useNotifications();
  const isEditing = timelineId != null;

  const [tl, setTl]               = useState<Calendar | null>(null);
  const [name, setName]           = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor]         = useState('#6366F1');
  const [isCourse, setIsCourse]   = useState(false);
  const [courseCode, setCourseCode] = useState('');
  const [termStart, setTermStart] = useState('');
  const [termEnd, setTermEnd]     = useState('');
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    if (!isEditing) return;
    listCalendars().then(cals => {
      const found = cals.find(c => c.id === timelineId);
      if (!found) return;
      setTl(found);
      setName(found.name ?? '');
      setDescription(found.description ?? '');
      setColor(found.color ?? '#6366F1');
      setIsCourse(!!found.is_course);
      setCourseCode(found.course_code ?? '');
      setTermStart(found.term_start ?? '');
      setTermEnd(found.term_end ?? '');
    }).catch(() => {});
  }, [timelineId, isEditing]);

  async function handleSave() {
    if (!name.trim()) {
      addNotification({ type: 'warning', title: 'Name required', message: 'Please enter a timeline name.' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description,
        color,
        is_course: isCourse,
        course_code: isCourse ? (courseCode.trim() || null) : null,
        term_start: isCourse ? (termStart || null) : null,
        term_end:   isCourse ? (termEnd   || null) : null,
      };
      if (isEditing && tl) {
        await updateCalendar(tl.id, payload);
      } else {
        await createCalendar(payload);
      }
      addNotification({ type: 'success', title: 'Timeline saved', autoRemoveMs: 2500 });
      onSaved();
      close();
    } catch {
      addNotification({ type: 'error', title: 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={isEditing ? 'Edit Timeline' : 'New Timeline'} onClose={close}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
          Name
          <input
            className="loom-field"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Calculus II"
            style={{ marginTop: 4 }}
            autoFocus
          />
        </label>

        <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
          Description
          <input
            className="loom-field"
            value={description}
            onChange={e => setDescription(e.target.value)}
            style={{ marginTop: 4 }}
          />
        </label>

        <div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Color</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {PALETTE.map(p => (
              <button
                key={p}
                onClick={() => setColor(p)}
                aria-label={`Color ${p}`}
                style={{
                  width: 26, height: 26, borderRadius: 6,
                  background: p, border: color === p ? '2px solid var(--text-main)' : '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-main)', cursor: 'pointer' }}>
          <input type="checkbox" checked={isCourse} onChange={e => setIsCourse(e.target.checked)} />
          <span>This is a course (drives Up Next, Semester view, grade tracker)</span>
        </label>

        {isCourse && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 22 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
              Course code
              <input
                className="loom-field"
                value={courseCode}
                onChange={e => setCourseCode(e.target.value)}
                placeholder="e.g. CS3500"
                style={{ marginTop: 4 }}
              />
            </label>
            <div style={{ display: 'flex', gap: 12 }}>
              <label style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                Term start
                <input
                  type="date"
                  className="loom-field"
                  value={termStart}
                  onChange={e => setTermStart(e.target.value)}
                  style={{ marginTop: 4, width: '100%' }}
                />
              </label>
              <label style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                Term end
                <input
                  type="date"
                  className="loom-field"
                  value={termEnd}
                  onChange={e => setTermEnd(e.target.value)}
                  style={{ marginTop: 4, width: '100%' }}
                />
              </label>
            </div>
          </div>
        )}
      </div>

      <ModalFooter>
        <button className="loom-btn-ghost" onClick={close}>Cancel</button>
        <button className="loom-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}
