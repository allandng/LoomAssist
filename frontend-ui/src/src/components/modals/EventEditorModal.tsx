import { useState, useEffect, useCallback } from 'react';
import styles from './EventEditorModal.module.css';
import { ModalShell, ModalFooter, FieldLabel } from './ModalShell';
import { MentionTextarea } from '../shared/MentionTextarea';
import { TLDot } from '../shared/TLDot';
import { Icon, Icons } from '../shared/Icon';
import { Kbd } from '../shared/Kbd';
import { useModal } from '../../contexts/ModalContext';
import { useUndo } from '../../contexts/UndoContext';
import { useNotifications } from '../../store/notifications';
import {
  createEvent, updateEvent, deleteEvent,
  createTemplate, createTask, listTasks, deleteTask,
} from '../../api';
import type { Event, Calendar, ChecklistItem } from '../../types';
import { parseChecklist } from '../../lib/eventUtils';

const REMINDER_OPTIONS = [
  { label: 'None', value: 0 },
  { label: '5 min before', value: 5 },
  { label: '10 min before', value: 10 },
  { label: '15 min before', value: 15 },
  { label: '30 min before', value: 30 },
  { label: '1 hour before', value: 60 },
  { label: '2 hours before', value: 120 },
  { label: '1 day before', value: 1440 },
];

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function toLocalDT(iso: string): string {
  // Convert ISO datetime to datetime-local input value
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalDate(iso: string): string {
  return iso ? iso.split('T')[0] : '';
}

interface EventEditorModalProps {
  event?: Event | null;
  date?: string;        // pre-fill date (YYYY-MM-DD)
  instanceDate?: string; // for recurring occurrences
  timelines: Calendar[];
  onSaved: () => void;
}

export function EventEditorModal({ event, date, instanceDate, timelines, onSaved }: EventEditorModalProps) {
  const { close } = useModal();
  const { push: pushUndo } = useUndo();
  const { addNotification } = useNotifications();

  const isEdit = !!event;
  const isLocked = event?.title === 'Meeting (availability booking)';

  // ---- Form state ----
  const [title, setTitle]           = useState(event?.title ?? '');
  const [allDay, setAllDay]         = useState(event?.is_all_day ?? false);
  const [startVal, setStartVal]     = useState(
    event ? (event.is_all_day ? toLocalDate(event.start_time) : toLocalDT(event.start_time))
           : (date ? `${date}T09:00` : toLocalDT(new Date().toISOString()))
  );
  const [endVal, setEndVal]         = useState(
    event ? (event.is_all_day ? toLocalDate(event.end_time) : toLocalDT(event.end_time))
           : (date ? `${date}T10:00` : toLocalDT(new Date(Date.now() + 3_600_000).toISOString()))
  );
  const [calendarId, setCalendarId] = useState(event?.calendar_id ?? timelines[0]?.id ?? 0);
  const [reminder, setReminder]     = useState(event?.reminder_minutes ?? 0);
  const [description, setDescription] = useState(event?.description ?? '');
  const [checklist, setChecklist]   = useState<ChecklistItem[]>(parseChecklist(event?.checklist ?? ''));

  // Recurrence
  const [recurring, setRecurring]   = useState(event?.is_recurring ?? false);
  const [recurDays, setRecurDays]   = useState<number[]>(
    event?.recurrence_days ? event.recurrence_days.split(',').map(Number).filter(n => !isNaN(n)) : []
  );
  const [recurEnd, setRecurEnd]     = useState(event?.recurrence_end ? toLocalDate(event.recurrence_end) : '');
  const [skipDates, setSkipDates]   = useState(event?.skipped_dates ?? '');

  // Task board status
  const [isOnTaskBoard, setIsOnTaskBoard] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);

  // Conflict / double-confirm state (second click required to confirm)
  const [conflictWarning] = useState('');
  const [needsConfirm] = useState(false);

  // Load task board status for existing events
  useEffect(() => {
    if (!isEdit || !event) return;
    listTasks().then(tasks => {
      const t = tasks.find(t => t.event_id === event.id);
      if (t) { setIsOnTaskBoard(true); setTaskId(t.id); }
    }).catch(() => {});
  }, [isEdit, event]);

  const selectedTimeline = timelines.find(t => t.id === calendarId);

  // ---- Checklist helpers ----
  const addChecklistItem = useCallback(() => {
    setChecklist(prev => [...prev, { text: '', done: false }]);
  }, []);

  const toggleChecklistItem = useCallback((idx: number) => {
    setChecklist(prev => prev.map((item, i) => i === idx ? { ...item, done: !item.done } : item));
  }, []);

  const updateChecklistText = useCallback((idx: number, text: string) => {
    setChecklist(prev => prev.map((item, i) => i === idx ? { ...item, text } : item));
  }, []);

  const removeChecklistItem = useCallback((idx: number) => {
    setChecklist(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // ---- Submit ----
  const buildPayload = useCallback(() => {
    const start = allDay ? `${startVal}T00:00:00` : new Date(startVal).toISOString();
    const end   = allDay ? `${endVal}T23:59:59`   : new Date(endVal).toISOString();
    return {
      title: title.trim(),
      start_time: start,
      end_time: end,
      is_all_day: allDay,
      calendar_id: calendarId,
      reminder_minutes: reminder,
      description,
      checklist: JSON.stringify(checklist),
      is_recurring: recurring,
      recurrence_days: recurring ? recurDays.join(',') : '',
      recurrence_end: recurEnd,
      skipped_dates: skipDates,
      unique_description: event?.unique_description ?? '',
      external_uid: event?.external_uid ?? '',
      timezone: event?.timezone ?? 'local',
      per_day_times: event?.per_day_times ?? '',
    };
  }, [title, allDay, startVal, endVal, calendarId, reminder, description, checklist,
      recurring, recurDays, recurEnd, skipDates, event]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) return;

    const payload = buildPayload();

    if (isEdit && event) {
      const prev = event;
      await updateEvent(event.id, payload);
      pushUndo({
        label: `Edit "${prev.title}"`,
        undo: async () => { await updateEvent(event.id, prev as Parameters<typeof updateEvent>[1]); },
        redo: async () => { await updateEvent(event.id, payload); },
      });
    } else {
      const created = await createEvent(payload);
      pushUndo({
        label: `Create "${created.title}"`,
        undo: async () => { await deleteEvent(created.id); },
        redo: async () => { /* re-create not directly reversible */ },
      });
    }

    onSaved();
    close();
  }, [title, isEdit, event, buildPayload, pushUndo, onSaved, close]);

  const handleDelete = useCallback(async () => {
    if (!event) return;
    if (!window.confirm(`Delete "${event.title}"?`)) return;
    const snapshot = { ...event };
    await deleteEvent(event.id);
    pushUndo({
      label: `Delete "${event.title}"`,
      undo: async () => { const { createEvent } = await import('../../api'); const { id, ...p } = snapshot; await createEvent(p); },
      redo: async () => { await deleteEvent(event.id); },
    });
    onSaved();
    close();
  }, [event, pushUndo, onSaved, close]);

  const handleSkipDate = useCallback(async () => {
    if (!event || !instanceDate) return;
    await fetch(`http://localhost:8000/events/${event.id}/skip-date`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: instanceDate }),
    });
    onSaved();
    close();
  }, [event, instanceDate, onSaved, close]);

  const handleAddToTaskBoard = useCallback(async () => {
    if (!event) return;
    if (isOnTaskBoard && taskId !== null) {
      await deleteTask(taskId);
      setIsOnTaskBoard(false);
      setTaskId(null);
    } else {
      const t = await createTask({ event_id: event.id, is_complete: false, note: '', status: 'backlog', priority: 'med', due_date: '' });
      setIsOnTaskBoard(true);
      setTaskId(t.id);
    }
  }, [event, isOnTaskBoard, taskId]);

  const handleSaveAsTemplate = useCallback(async () => {
    const name = window.prompt('Template name:');
    if (!name?.trim()) return;
    await createTemplate({
      name: name.trim(), title: title.trim(), description,
      duration_minutes: Math.round((new Date(endVal).getTime() - new Date(startVal).getTime()) / 60_000) || 60,
      is_recurring: recurring, recurrence_days: recurDays.join(','), calendar_id: calendarId,
    });
    addNotification({ type: 'success', title: 'Template saved', message: `"${name.trim()}" added to templates`, autoRemoveMs: 3000 });
  }, [title, description, startVal, endVal, recurring, recurDays, calendarId, addNotification]);

  const toggleRecurDay = useCallback((dow: number) => {
    setRecurDays(prev => prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow]);
  }, []);

  return (
    <ModalShell title={isEdit ? 'Edit event' : 'New event'} width={560} onClose={close}>
      <div className={styles.form}>

        {isLocked && (
          <div className={styles.lockedBanner}>
            🔒 Time set by availability booking — description is read-only.
          </div>
        )}

        {/* Title */}
        <div className={styles.field}>
          <FieldLabel>Title</FieldLabel>
          <input
            className="loom-field"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Event title"
            autoFocus
          />
        </div>

        {/* Start / End / All-day */}
        <div className={styles.row3}>
          <div>
            <FieldLabel>Start</FieldLabel>
            <input
              className="loom-field"
              type={allDay ? 'date' : 'datetime-local'}
              value={startVal}
              onChange={e => setStartVal(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>End</FieldLabel>
            <input
              className="loom-field"
              type={allDay ? 'date' : 'datetime-local'}
              value={endVal}
              onChange={e => setEndVal(e.target.value)}
            />
          </div>
          <label className={styles.alldayLabel}>
            <div
              className={styles.checkbox}
              style={{ borderColor: allDay ? 'var(--accent)' : 'var(--border-strong)', background: allDay ? 'var(--accent)' : 'transparent' }}
              onClick={() => { setAllDay(v => !v); if (recurring) setRecurring(false); }}
            >
              {allDay && <Icon d={Icons.check} size={9} stroke="white" strokeWidth={3} />}
            </div>
            All-day
          </label>
        </div>

        {/* Timeline + Reminder */}
        <div className={styles.row2}>
          <div>
            <FieldLabel>Timeline</FieldLabel>
            <div className={styles.timelineSelect}>
              {selectedTimeline && <TLDot color={selectedTimeline.color} size={8} />}
              <select
                className={styles.selectInline}
                value={calendarId}
                onChange={e => setCalendarId(Number(e.target.value))}
              >
                {timelines.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <Icon d={Icons.chevronDown} size={12} className={styles.selectChevron} />
            </div>
          </div>
          <div>
            <FieldLabel>Reminder</FieldLabel>
            <div className={styles.timelineSelect}>
              <select
                className={styles.selectInline}
                value={reminder}
                onChange={e => setReminder(Number(e.target.value))}
              >
                {REMINDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Icon d={Icons.chevronDown} size={12} className={styles.selectChevron} />
            </div>
          </div>
        </div>

        {/* Recurrence */}
        <div className={`${styles.recurBox} ${recurring ? styles.recurBoxActive : ''}`}>
          <div className={styles.recurHeader}>
            <Icon d={Icons.sync} size={13} className={recurring ? styles.recurIconActive : styles.recurIcon} />
            <span className={styles.recurLabel}>{recurring ? 'Repeating weekly' : 'Does not repeat'}</span>
            <button
              className={`${styles.toggle} ${recurring ? styles.toggleOn : ''}`}
              onClick={() => { if (!allDay) setRecurring(v => !v); }}
              aria-pressed={recurring}
              disabled={allDay}
            />
          </div>

          {recurring && (
            <>
              <div className={styles.dowRow}>
                {DOW.map((d, i) => {
                  const on = recurDays.includes(i);
                  return (
                    <button
                      key={i}
                      className={`${styles.dowBtn} ${on ? styles.dowBtnOn : ''}`}
                      onClick={() => toggleRecurDay(i)}
                    >{d}</button>
                  );
                })}
              </div>
              <div className={styles.row2}>
                <div>
                  <FieldLabel>Ends</FieldLabel>
                  <input className="loom-field" type="date" value={recurEnd} onChange={e => setRecurEnd(e.target.value)} style={{ padding: '6px 8px', fontSize: 11.5 }} />
                </div>
                <div>
                  <FieldLabel>Skip dates</FieldLabel>
                  <input
                    className="loom-field"
                    placeholder="YYYY-MM-DD, YYYY-MM-DD"
                    value={skipDates}
                    onChange={e => setSkipDates(e.target.value)}
                    style={{ padding: '6px 8px', fontSize: 11.5, color: 'var(--accent)' }}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Description */}
        <div className={styles.field}>
          <FieldLabel>Description <span className={styles.sublabel}>· Markdown · @mention</span></FieldLabel>
          <MentionTextarea
            value={description}
            onChange={setDescription}
            readOnly={isLocked}
          />
        </div>

        {/* Checklist */}
        <div className={styles.field}>
          <FieldLabel>Checklist <span className={styles.sublabel}>· {checklist.filter(c=>c.done).length}/{checklist.length}</span></FieldLabel>
          {checklist.map((item, idx) => (
            <div key={idx} className={styles.checkRow}>
              <button
                className={styles.checkBtn}
                style={{
                  borderColor: item.done ? 'var(--success)' : 'var(--border-strong)',
                  background: item.done ? 'var(--success)' : 'transparent',
                }}
                onClick={() => toggleChecklistItem(idx)}
              >
                {item.done && <Icon d={Icons.check} size={9} stroke="#0B1120" strokeWidth={3} />}
              </button>
              <input
                className={styles.checkInput}
                style={{ color: item.done ? 'var(--text-muted)' : 'var(--text-main)', textDecoration: item.done ? 'line-through' : 'none' }}
                value={item.text}
                onChange={e => updateChecklistText(idx, e.target.value)}
                placeholder="Item…"
              />
              <button className={styles.checkRemove} onClick={() => removeChecklistItem(idx)}>
                <Icon d={Icons.x} size={11} />
              </button>
            </div>
          ))}
          <button className={styles.addItem} onClick={addChecklistItem}>+ Add item</button>
        </div>

        {conflictWarning && <div className={styles.conflictWarn}>{conflictWarning}</div>}
      </div>

      <ModalFooter>
        {isEdit && (
          <>
            <button className="loom-btn-ghost" onClick={handleAddToTaskBoard}>
              {isOnTaskBoard ? '✓ On Task Board' : '+ Task Board'}
            </button>
            {instanceDate && (
              <button className="loom-btn-ghost" onClick={handleSkipDate}>
                Skip this date
              </button>
            )}
          </>
        )}
        <button className="loom-btn-ghost" onClick={handleSaveAsTemplate}>Save as template</button>
        <div style={{ flex: 1 }} />
        {isEdit && (
          <button className={styles.deleteBtn} onClick={handleDelete}>Delete</button>
        )}
        <button className="loom-btn-ghost" onClick={close}>Cancel</button>
        <button
          className="loom-btn-primary"
          onClick={handleSubmit}
          disabled={!title.trim()}
        >
          {needsConfirm ? 'Confirm save' : isEdit ? 'Save changes' : 'Create event'}
          <Kbd small>⏎</Kbd>
        </button>
      </ModalFooter>
    </ModalShell>
  );
}
