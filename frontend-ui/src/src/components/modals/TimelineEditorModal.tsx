import { useEffect, useId, useState } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useUndo } from '../../contexts/UndoContext';
import { ModalShell, ModalFooter, ModalStack } from './ModalShell';
import { Button, Field, Input, Switch, Icons, confirm as confirmDialog } from '../ui';
import { useNotifications } from '../../store/notifications';
import { listCalendars, updateCalendar, createCalendar, deleteCalendar } from '../../api';
import { DEFAULT_TIMELINE_COLOR, TIMELINE_PALETTE } from '../../lib/colors';
import type { Calendar } from '../../types';
import styles from './TimelineEditorModal.module.css';

interface TimelineEditorModalProps {
  timelineId?: number;     // undefined = creating a new timeline
  onSaved: () => void;
}

const SWATCH_NAMES: Record<string, string> = {
  '#6366F1': 'Indigo', '#10B981': 'Green', '#F59E0B': 'Amber', '#EC4899': 'Pink',
  '#06B6D4': 'Cyan', '#8B5CF6': 'Violet', '#EF4444': 'Red',
};

export function TimelineEditorModal({ timelineId, onSaved }: TimelineEditorModalProps) {
  const { close } = useModal();
  const { addNotification } = useNotifications();
  const { push: pushUndo } = useUndo();
  const ids = useId();
  const isEditing = timelineId != null;

  const [tl, setTl]               = useState<Calendar | null>(null);
  const [name, setName]           = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor]         = useState(DEFAULT_TIMELINE_COLOR);
  const [isCourse, setIsCourse]   = useState(false);
  const [courseCode, setCourseCode] = useState('');
  const [termStart, setTermStart] = useState('');
  const [termEnd, setTermEnd]     = useState('');
  const [saving, setSaving]       = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing) return;
    listCalendars().then(cals => {
      const found = cals.find(c => c.id === timelineId);
      if (!found) return;
      setTl(found);
      setName(found.name ?? '');
      setDescription(found.description ?? '');
      setColor(found.color ?? DEFAULT_TIMELINE_COLOR);
      setIsCourse(!!found.is_course);
      setCourseCode(found.course_code ?? '');
      setTermStart(found.term_start ?? '');
      setTermEnd(found.term_end ?? '');
    }).catch(() => {});
  }, [timelineId, isEditing]);

  async function handleSave() {
    if (!name.trim()) {
      setNameError('Enter a name for the timeline.');
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
        // Keep timeline creation undoable (plan hard constraint: no mutation
        // path may lose undo coverage). Undo deletes the just-created row.
        const created = await createCalendar(payload);
        pushUndo({
          label: `Create timeline "${created.name}"`,
          undo: async () => { await deleteCalendar(created.id); onSaved(); },
          redo: async () => { await createCalendar(payload); onSaved(); },
        });
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

  async function handleDelete() {
    if (!tl) return;
    const ok = await confirmDialog({
      title: `Delete "${tl.name}"?`,
      description: 'Events on this timeline are deleted with it. This can’t be undone.',
      destructive: true,
      confirmLabel: 'Delete timeline',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await deleteCalendar(tl.id);
      addNotification({ type: 'success', title: 'Timeline deleted', autoRemoveMs: 2500 });
      onSaved();
      close();
    } catch {
      addNotification({ type: 'error', title: 'Delete failed' });
    } finally {
      setSaving(false);
    }
  }

  const isPresetColor = TIMELINE_PALETTE.map(p => p.toUpperCase()).includes(color.toUpperCase());

  return (
    <ModalShell variant="sheet" size="sm" title={isEditing ? 'Edit timeline' : 'New timeline'} onClose={close}>
      <ModalStack>
        <Field label="Name" htmlFor={`${ids}-name`} error={nameError}>
          <Input
            id={`${ids}-name`}
            value={name}
            onChange={e => { setName(e.target.value); if (nameError) setNameError(null); }}
            placeholder="e.g. Calculus II"
            invalid={!!nameError}
            data-autofocus
          />
        </Field>

        <Field label="Description" htmlFor={`${ids}-desc`}>
          <Input id={`${ids}-desc`} value={description} onChange={e => setDescription(e.target.value)} placeholder="What lives on this timeline?" />
        </Field>

        <Field label="Color">
          <div className={styles.swatches} role="radiogroup" aria-label="Timeline color">
            {TIMELINE_PALETTE.map(p => {
              const on = p.toUpperCase() === color.toUpperCase();
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={SWATCH_NAMES[p.toUpperCase()] ?? p}
                  className={[styles.swatch, on ? styles.swatchOn : ''].join(' ')}
                  style={{ '--swatch': p } as React.CSSProperties}
                  onClick={() => setColor(p)}
                />
              );
            })}
            <label className={[styles.swatch, styles.swatchCustom, !isPresetColor ? styles.swatchOn : ''].join(' ')} style={{ '--swatch': color } as React.CSSProperties} title="Custom color">
              <input
                type="color"
                className={styles.colorInput}
                value={color}
                onChange={e => setColor(e.target.value)}
                aria-label="Custom color"
              />
              <span className={styles.customGlyph} aria-hidden="true">+</span>
            </label>
          </div>
        </Field>

        <div className={styles.courseBox}>
          <Switch
            checked={isCourse}
            onChange={setIsCourse}
            label="This is a course"
            description="Drives Up next, the semester view and the grade tracker."
          />
          {isCourse && (
            <div className={styles.courseFields}>
              <Field label="Course code" htmlFor={`${ids}-code`}>
                <Input id={`${ids}-code`} value={courseCode} onChange={e => setCourseCode(e.target.value)} placeholder="e.g. CS3500" />
              </Field>
              <div className={styles.grid2}>
                <Field label="Term start" htmlFor={`${ids}-ts`}>
                  <Input id={`${ids}-ts`} type="date" value={termStart} onChange={e => setTermStart(e.target.value)} />
                </Field>
                <Field label="Term end" htmlFor={`${ids}-te`}>
                  <Input id={`${ids}-te`} type="date" value={termEnd} onChange={e => setTermEnd(e.target.value)} />
                </Field>
              </div>
            </div>
          )}
        </div>
      </ModalStack>

      <ModalFooter
        left={isEditing && tl ? (
          <Button variant="danger" icon={Icons.trash} onClick={() => { void handleDelete(); }} disabled={saving}>Delete</Button>
        ) : undefined}
      >
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { void handleSave(); }} loading={saving} disabled={!name.trim()}>
          {isEditing ? 'Save changes' : 'Create timeline'}
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}
