import { useState, useEffect, useCallback, useRef } from 'react';
import styles from './EventEditorModal.module.css';
import { ModalShell, ModalFooter, FieldLabel } from './ModalShell';
import { SourceBadge } from '../shared/SourceBadge';
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
  parseDateTime, clockEvent, resolveConflict, listCourses,
  cascadeDependents, listEvents, checkConflicts, skipEventDate,
} from '../../api';
import type { Event, Calendar, ChecklistItem, ConflictSuggestion, Course } from '../../types';
import { SuggestionChip } from '../shared/SuggestionChip';
import { parseChecklist } from '../../lib/eventUtils';
import { isExamLike, stripExamWord } from '../../lib/eventClassification';
import { checkSleepWindow } from '../../lib/sleepWindow';
import { getMissedButtonState } from '../../lib/missedEvents';

function formatDT(dtLocal: string): string {
  if (!dtLocal) return '';
  const d = new Date(dtLocal);
  return isNaN(d.getTime()) ? dtLocal
    : d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function NLDateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(() => formatDT(value));
  const [preview, setPreview] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // WS5 #4 — remember the last string we actually sent to the Ollama parser so an
  // unchanged value (e.g. edited then reverted) doesn't re-fire the LLM.
  const lastParsedRef = useRef<string>('');

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleChange = useCallback((raw: string) => {
    setText(raw);
    setPreview(null);
    setError(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!raw.trim()) return;
    timerRef.current = setTimeout(async () => {
      const native = new Date(raw);
      if (!isNaN(native.getTime()) && native.getFullYear() > 2000) {
        const local = toLocalDT(native.toISOString());
        onChange(local);
        setPreview(formatDT(local));
        return;
      }
      if (raw === lastParsedRef.current) return; // no change since last LLM parse
      lastParsedRef.current = raw;
      setParsing(true);
      try {
        const res = await parseDateTime(raw);
        onChange(res.iso.slice(0, 16));
        setPreview(res.display);
      } catch {
        setError(true);
      } finally {
        setParsing(false);
      }
    }, 600);
  }, [onChange]);

  return (
    <div className={styles.nlWrap}>
      <input
        className={`loom-field${error ? ` ${styles.nlError}` : ''}`}
        value={text}
        onChange={e => handleChange(e.target.value)}
        placeholder='e.g. "next fri 2pm"'
      />
      {parsing && <div className={`${styles.nlPreview} ${styles.nlParsing}`}>Parsing…</div>}
      {!parsing && preview && (
        <div className={styles.nlPreview}>
          <Icon d={Icons.check} size={11} stroke="var(--accent)" strokeWidth={2.5} /> {preview}
        </div>
      )}
    </div>
  );
}

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

// WS3 #1/#3 — quick-create "More options" and template-apply seed a NEW event's
// title / timeline / recurrence. Ignored when editing an existing `event`.
export interface EventEditorPrefill {
  title?: string;
  calendarId?: number;
  isRecurring?: boolean;
  recurrenceDays?: string;
}

interface EventEditorModalProps {
  event?: Event | null;
  date?: string;         // pre-fill date (YYYY-MM-DD)
  instanceDate?: string; // for recurring occurrences
  startISO?: string;     // pre-fill exact start (ISO datetime, from smart scheduler)
  endISO?: string;       // pre-fill exact end
  prefill?: EventEditorPrefill; // pre-fill fields for a new event (quick-create / template)
  timelines: Calendar[];
  onSaved: () => void;
}

export function EventEditorModal({ event, date, instanceDate, startISO, endISO, prefill, timelines, onSaved }: EventEditorModalProps) {
  const { close, openStudyBlock } = useModal();
  const { push: pushUndo } = useUndo();
  const { addNotification } = useNotifications();

  const isEdit = !!event;
  const isLocked = event?.title === 'Meeting (availability booking)';

  // ---- Form state ----
  const [title, setTitle]           = useState(event?.title ?? prefill?.title ?? '');
  const [allDay, setAllDay]         = useState(event?.is_all_day ?? false);
  const [startVal, setStartVal]     = useState(
    event    ? (event.is_all_day ? toLocalDate(event.start_time) : toLocalDT(event.start_time))
    : startISO ? toLocalDT(startISO)
    : (date  ? `${date}T09:00` : toLocalDT(new Date().toISOString()))
  );
  const [endVal, setEndVal]         = useState(
    event  ? (event.is_all_day ? toLocalDate(event.end_time) : toLocalDT(event.end_time))
    : endISO ? toLocalDT(endISO)
    : (date  ? `${date}T10:00` : toLocalDT(new Date(Date.now() + 3_600_000).toISOString()))
  );
  const [calendarId, setCalendarId] = useState(event?.calendar_id ?? prefill?.calendarId ?? timelines[0]?.id ?? 0);
  const [reminder, setReminder]     = useState(event?.reminder_minutes ?? 0);
  const [reminderSource, setReminderSource] = useState<'user' | 'inferred' | 'none'>(
    event?.reminder_source === 'inferred' ? 'inferred' : event?.reminder_source === 'user' ? 'user' : 'none'
  );
  const [location, setLocation]     = useState(event?.location ?? '');
  const [travelTime, setTravelTime] = useState<number>(event?.travel_time_minutes ?? 0);
  const [eventType, setEventType]   = useState<'' | 'lecture' | 'lab' | 'office_hours' | 'other'>(event?.event_type ?? '');
  const [prepMinutes, setPrepMinutes] = useState<number>(event?.prep_minutes ?? 0);
  const [description, setDescription] = useState(event?.description ?? '');
  const [checklist, setChecklist]   = useState<ChecklistItem[]>(parseChecklist(event?.checklist ?? ''));

  // Recurrence
  const [recurring, setRecurring]   = useState(event?.is_recurring ?? prefill?.isRecurring ?? false);
  const [recurDays, setRecurDays]   = useState<number[]>(() => {
    const src = event?.recurrence_days ?? (event ? '' : prefill?.recurrenceDays) ?? '';
    return src ? src.split(',').map(Number).filter(n => !isNaN(n)) : [];
  });
  const [recurEnd, setRecurEnd]     = useState(event?.recurrence_end ? toLocalDate(event.recurrence_end) : '');
  const [skipDates, setSkipDates]   = useState(event?.skipped_dates ?? '');
  const [skipDraft, setSkipDraft]   = useState(''); // WS5 #5 — date-input adder

  // Task board status
  const [isOnTaskBoard, setIsOnTaskBoard] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);

  const [conflictWarning, setConflictWarning] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  useEffect(() => { listCourses().then(setCourses).catch(() => {}); }, []);

  // Phase 10: Dependencies
  const [allEvents, setAllEvents] = useState<Event[]>([]);
  const [dependsOnId, setDependsOnId] = useState<number | null>(event?.depends_on_event_id ?? null);
  const [dependsOffset, setDependsOffset] = useState<number>(event?.depends_offset_minutes ?? 0);
  useEffect(() => { listEvents().then(evs => setAllEvents(evs.filter(e => e.id !== event?.id))).catch(() => {}); }, [event?.id]);
  const [suggestions, setSuggestions] = useState<ConflictSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  // Duration tracking
  const [actualStart, setActualStart] = useState<string | null>(event?.actual_start ?? null);
  const [actualEnd,   setActualEnd]   = useState<string | null>(event?.actual_end   ?? null);

  // "Missed" opt-in marker — drives the footer Mark/Unmark button.
  const [missedAt, setMissedAt] = useState<string | null>(event?.missed_at ?? null);

  // WS5 #6 — in-modal replacements for window.prompt/confirm.
  const [confirmingDelete, setConfirmingDelete] = useState(false); // two-step delete (non-recurring)
  const [deleteScopeOpen, setDeleteScopeOpen] = useState(false);   // scope popover (recurring)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [templateNaming, setTemplateNaming] = useState(false);
  const [templateName, setTemplateName] = useState('');
  useEffect(() => () => { if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current); }, []);

  // Load task board status for existing events
  useEffect(() => {
    if (!isEdit || !event) return;
    listTasks().then(tasks => {
      const t = tasks.find(t => t.event_id === event.id);
      if (t) { setIsOnTaskBoard(true); setTaskId(t.id); }
    }).catch(() => {});
  }, [isEdit, event]);

  const selectedTimeline = timelines.find(t => t.id === calendarId);

  // ---- Clock-in / Clock-out ----
  async function handleClock(action: 'in' | 'out') {
    if (!event?.id) return;
    const updated = await clockEvent(event.id, action);
    setActualStart(updated.actual_start ?? null);
    setActualEnd(updated.actual_end ?? null);
    onSaved();
  }

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
  // Auto-clear-on-save: when called with no opts (the regular handleSubmit
  // path), `missed_at` goes out as null. Saving a marked event via the regular
  // Save button therefore unmarks it — the user implicitly recovered it.
  // The Mark/Unmark button passes an explicit value via opts.
  const buildPayload = useCallback((opts?: { missedAt?: string | null }) => {
    const start = allDay ? `${startVal}T00:00:00` : new Date(startVal).toISOString();
    const end   = allDay ? `${endVal}T23:59:59`   : new Date(endVal).toISOString();
    return {
      title: title.trim(),
      start_time: start,
      end_time: end,
      is_all_day: allDay,
      calendar_id: calendarId,
      reminder_minutes: reminder,
      reminder_source: reminderSource,
      depends_on_event_id: dependsOnId,
      depends_offset_minutes: dependsOffset,
      location: location || null,
      travel_time_minutes: travelTime || null,
      event_type: eventType || null,
      prep_minutes: eventType === 'lecture' ? (prepMinutes || null) : null,
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
      missed_at: opts?.missedAt ?? null,
    };
  }, [title, allDay, startVal, endVal, calendarId, reminder, reminderSource, location, travelTime,
      eventType, prepMinutes, description, checklist, recurring, recurDays, recurEnd, skipDates,
      dependsOnId, dependsOffset, event]);

  // WS5 #4 — client-side validation: end must be after start. Blocks the save.
  const endInvalid = allDay
    ? (!!endVal && !!startVal && endVal < startVal)
    : (new Date(endVal).getTime() <= new Date(startVal).getTime());

  // The single write. Only runs once the conflict pre-check has cleared or the
  // user has explicitly confirmed "Save anyway" — never before (WS5 #3).
  const performWrite = useCallback(async () => {
    const payload = buildPayload();
    let createdEvent: Event | null = null;

    if (isEdit && event) {
      const prev = event;
      const { dependents = [] } = await updateEvent(event.id, payload);
      pushUndo({
        label: `Edit "${prev.title}"`,
        undo: async () => { await updateEvent(event.id, prev as Parameters<typeof updateEvent>[1]); },
        redo: async () => { await updateEvent(event.id, payload); },
      });
      if (dependents.length > 0) {
        const eid = event.id;
        addNotification({
          type: 'warning',
          title: `Move ${dependents.length} dependent event(s)?`,
          message: dependents.map(d => d.title).join(', '),
          actionable: true,
          actionLabel: 'Yes, cascade',
          actionFn: async () => { await cascadeDependents(eid); onSaved(); },
        });
      }
    } else {
      const { event: created } = await createEvent(payload);
      createdEvent = created;
      pushUndo({
        label: `Create "${created.title}"`,
        undo: async () => { await deleteEvent(created.id); },
        redo: async () => { /* re-create not directly reversible */ },
      });
    }

    const sw = checkSleepWindow(payload.start_time, payload.end_time, !!payload.is_all_day);
    if (sw) {
      addNotification({
        type: 'warning',
        title: 'Past sleep window',
        message: sw.message,
        collapseKey: 'sleep-window',
        autoRemoveMs: 6000,
      });
    }

    onSaved();

    if (!isEdit && createdEvent && isExamLike(createdEvent.title)) {
      openStudyBlock(createdEvent, stripExamWord(createdEvent.title));
    } else {
      close();
    }
  }, [isEdit, event, buildPayload, pushUndo, onSaved, close, openStudyBlock, addNotification]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || endInvalid) return;

    // First click (not yet confirmed): dry-run the conflict check and, if it
    // overlaps, warn + offer alternatives WITHOUT writing. The second click
    // ("Save anyway") skips the check and performs the single write (WS5 #3).
    if (!needsConfirm) {
      const p = buildPayload();
      let conflicts: Array<{ id: number; title: string; conflict_type?: string }> = [];
      try {
        const res = await checkConflicts({
          start_time: p.start_time, end_time: p.end_time,
          calendar_id: p.calendar_id, exclude_event_id: event?.id ?? null,
        });
        conflicts = res.conflicts;
      } catch { /* if the pre-check itself fails, fall through and let the write proceed */ }

      if (conflicts.length) {
        const names = conflicts.map(c => (
          c.conflict_type === 'travel' ? `the travel buffer for "${c.title}"`
          : c.conflict_type === 'prep' ? `the prep buffer for "${c.title}"`
          : `"${c.title}"`
        )).join(', ');
        setConflictWarning(`Overlaps with: ${names}`);
        setNeedsConfirm(true);
        setSuggestions([]);
        setSuggestionsOpen(false);
        resolveConflict({
          event: { title: p.title, start_time: p.start_time, end_time: p.end_time, calendar_id: p.calendar_id },
          conflicts: conflicts.map(c => ({ id: c.id, title: c.title })),
        }).then(res => {
          if (res.suggestions.length) { setSuggestions(res.suggestions); setSuggestionsOpen(true); }
        }).catch(() => { /* silently ignore */ });
        return; // nothing written yet
      }
    }

    await performWrite();
  }, [title, endInvalid, needsConfirm, event, buildPayload, performWrite]);

  // Changing the time / timeline / all-day invalidates a prior conflict verdict —
  // clear it so the next save re-runs the pre-check instead of writing straight
  // away. Reset from the change handlers (not an effect) to keep renders clean.
  const resetConfirm = useCallback(() => {
    setNeedsConfirm(false);
    setConflictWarning('');
    setSuggestions([]);
    setSuggestionsOpen(false);
  }, []);
  const changeStart = useCallback((v: string) => { setStartVal(v); resetConfirm(); }, [resetConfirm]);
  const changeEnd   = useCallback((v: string) => { setEndVal(v);   resetConfirm(); }, [resetConfirm]);

  // WS5 #2 — a dirty editor must not be lost to a stray backdrop click. Snapshot
  // the initial field values on first render and compare each render.
  const currentSnapshot = JSON.stringify({
    title, allDay, startVal, endVal, calendarId, reminder, reminderSource,
    location, travelTime, eventType, prepMinutes, description,
    checklist: JSON.stringify(checklist), recurring, recurDays: recurDays.join(','),
    recurEnd, skipDates, dependsOnId, dependsOffset, courseId, missedAt,
  });
  const [initialSnapshot] = useState(() => currentSnapshot);
  const dirty = currentSnapshot !== initialSnapshot;

  const doDeleteAll = useCallback(async () => {
    if (!event) return;
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

  // Delete an occurrence of a recurring series = append it to skipped_dates.
  const doDeleteOccurrence = useCallback(async () => {
    if (!event || !instanceDate) return;
    const prevSkips = event.skipped_dates ?? '';
    await skipEventDate(event.id, { date: instanceDate });
    pushUndo({
      label: `Skip ${instanceDate} of "${event.title}"`,
      undo: async () => { await updateEvent(event.id, { skipped_dates: prevSkips }); },
      redo: async () => { await skipEventDate(event.id, { date: instanceDate }); },
    });
    onSaved();
    close();
  }, [event, instanceDate, pushUndo, onSaved, close]);

  // WS5 #6 — no window.confirm. Recurring events open a scope popover; single
  // events use a two-step inline confirm that self-resets after 3s.
  const handleDeleteClick = useCallback(() => {
    if (!event) return;
    if (event.is_recurring) { setDeleteScopeOpen(true); return; }
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    void doDeleteAll();
  }, [event, confirmingDelete, doDeleteAll]);

  const handleMarkToggle = useCallback(async () => {
    if (!event) return;
    const previous = missedAt;
    const next = previous ? null : new Date().toISOString();
    await updateEvent(event.id, buildPayload({ missedAt: next }));
    setMissedAt(next);
    pushUndo({
      label: previous ? `Unmark "${event.title}"` : `Mark "${event.title}" as missed`,
      undo: async () => { await updateEvent(event.id, buildPayload({ missedAt: previous })); },
      redo: async () => { await updateEvent(event.id, buildPayload({ missedAt: next })); },
    });
    onSaved();
    close();
  }, [event, missedAt, buildPayload, pushUndo, onSaved, close]);

  const handleSkipDate = useCallback(async () => {
    if (!event || !instanceDate) return;
    await skipEventDate(event.id, { date: instanceDate });
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
    const name = templateName.trim();
    if (!name) return;
    await createTemplate({
      name, title: title.trim(), description,
      duration_minutes: Math.round((new Date(endVal).getTime() - new Date(startVal).getTime()) / 60_000) || 60,
      is_recurring: recurring, recurrence_days: recurDays.join(','), calendar_id: calendarId,
    });
    setTemplateNaming(false);
    setTemplateName('');
    addNotification({ type: 'success', title: 'Template saved', message: `"${name}" added to templates`, autoRemoveMs: 3000 });
  }, [templateName, title, description, startVal, endVal, recurring, recurDays, calendarId, addNotification]);

  const toggleRecurDay = useCallback((dow: number) => {
    setRecurDays(prev => prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow]);
  }, []);

  // WS5 #5 — skip-dates as a removable chip list backed by the comma string.
  const skipDatesList = skipDates.split(',').map(s => s.trim()).filter(Boolean);
  const addSkipDate = useCallback(() => {
    const d = skipDraft.trim();
    if (!d) return;
    setSkipDates(prev => {
      const list = prev.split(',').map(s => s.trim()).filter(Boolean);
      if (!list.includes(d)) list.push(d);
      list.sort();
      return list.join(',');
    });
    setSkipDraft('');
  }, [skipDraft]);
  const removeSkipDate = useCallback((d: string) => {
    setSkipDates(prev => prev.split(',').map(s => s.trim()).filter(Boolean).filter(x => x !== d).join(','));
  }, []);

  return (
    <ModalShell title={isEdit ? 'Edit event' : 'New event'} width={560} onClose={close} confirmOnClose={dirty}>
      <div className={styles.form}>

        {isLocked && (
          <div className={styles.lockedBanner}>
            <Icon d={Icons.lock} size={13} stroke="var(--accent)" /> Time set by availability booking — description is read-only.
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
            data-autofocus
          />
        </div>

        {/* Start / End / All-day */}
        <div className={styles.row3}>
          <div>
            <FieldLabel>Start</FieldLabel>
            {allDay
              ? <input className="loom-field" type="date" value={startVal} onChange={e => changeStart(e.target.value)} />
              : <NLDateInput value={startVal} onChange={changeStart} />
            }
          </div>
          <div>
            <FieldLabel>End</FieldLabel>
            {allDay
              ? <input className="loom-field" type="date" value={endVal} onChange={e => changeEnd(e.target.value)} />
              : <NLDateInput value={endVal} onChange={changeEnd} />
            }
          </div>
          <label className={styles.alldayLabel}>
            <div
              className={styles.checkbox}
              style={{ borderColor: allDay ? 'var(--accent)' : 'var(--border-strong)', background: allDay ? 'var(--accent)' : 'transparent' }}
              onClick={() => { setAllDay(v => !v); resetConfirm(); if (recurring) setRecurring(false); }}
            >
              {allDay && <Icon d={Icons.check} size={9} stroke="white" strokeWidth={3} />}
            </div>
            All-day
          </label>
        </div>

        {endInvalid && (
          <div className={styles.validationError}>End must be after start.</div>
        )}

        {/* Timeline + Reminder */}
        <div className={styles.row2}>
          <div>
            <FieldLabel>Timeline</FieldLabel>
            <div className={styles.timelineSelect}>
              {selectedTimeline && <TLDot color={selectedTimeline.color} size={8} />}
              <select
                className={styles.selectInline}
                value={calendarId}
                onChange={e => { setCalendarId(Number(e.target.value)); resetConfirm(); }}
              >
                {timelines.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <Icon d={Icons.chevronDown} size={12} className={styles.selectChevron} />
            </div>
            {courses.length > 0 && (
              <div className={styles.timelineSelect} style={{ marginTop: 6 }}>
                <select
                  className={styles.selectInline}
                  value={courseId ?? ''}
                  onChange={e => {
                    const val = Number(e.target.value) || null;
                    setCourseId(val);
                    // Auto-set timeline to the course's default if available
                    const c = courses.find(c => c.id === val);
                    if (c?.timeline_id) setCalendarId(c.timeline_id);
                  }}
                >
                  <option value="">No course</option>
                  {courses.map(c => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>)}
                </select>
                <Icon d={Icons.chevronDown} size={12} className={styles.selectChevron} />
              </div>
            )}
          </div>
          <div>
            <FieldLabel>
              Reminder
              {reminderSource === 'inferred' && (
                <span className={styles.suggestedPill} title="AI-suggested based on event title">Suggested</span>
              )}
            </FieldLabel>
            <div className={styles.timelineSelect}>
              <select
                className={styles.selectInline}
                value={reminder}
                onChange={e => {
                  setReminder(Number(e.target.value));
                  setReminderSource('user');
                }}
              >
                {REMINDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Icon d={Icons.chevronDown} size={12} className={styles.selectChevron} />
            </div>
          </div>
        </div>

        {/* Event type (gates prep buffer) */}
        <div>
          <FieldLabel>Event type</FieldLabel>
          <div className={styles.timelineSelect}>
            <select
              className={styles.selectInline}
              value={eventType}
              onChange={e => setEventType(e.target.value as typeof eventType)}
            >
              <option value="">None</option>
              <option value="lecture">Lecture</option>
              <option value="lab">Lab</option>
              <option value="office_hours">Office Hours</option>
              <option value="other">Other</option>
            </select>
            <Icon d={Icons.chevronDown} size={12} className={styles.selectChevron} />
          </div>
        </div>

        {/* Location + Travel time + Prep (lectures only) */}
        <div className={styles.locationRow}>
          <input
            className={`loom-field ${styles.locationInput}`}
            placeholder="Location"
            value={location}
            onChange={e => setLocation(e.target.value)}
          />
          <div className={styles.travelWrap}>
            <input
              className={`loom-field ${styles.travelInput}`}
              type="number"
              min={0}
              step={5}
              placeholder="0"
              value={travelTime || ''}
              onChange={e => setTravelTime(Number(e.target.value))}
            />
            <span className={styles.travelLabel}>min travel</span>
          </div>
          {eventType === 'lecture' && !allDay && (
            <div className={styles.travelWrap}>
              <input
                className={`loom-field ${styles.travelInput}`}
                type="number"
                min={0}
                step={5}
                placeholder="0"
                value={prepMinutes || ''}
                onChange={e => setPrepMinutes(Number(e.target.value))}
              />
              <span className={styles.travelLabel}>min prep</span>
            </div>
          )}
        </div>

        {/* Phase v3.0: Provenance — only renders when this event came from sync */}
        <SourceBadge
          variant="editor"
          connectionCalendarId={event?.connection_calendar_id}
          lastSyncedAt={event?.last_synced_at}
        />

        {/* Depends on (Phase 10) */}
        {allEvents.length > 0 && (
          <div className={styles.dependsRow}>
            <div className={styles.dependsMain}>
              <div className={styles.dependsLabel}>Depends on</div>
              <select
                className={`loom-field ${styles.dependsSelect}`}
                value={dependsOnId ?? ''}
                onChange={e => setDependsOnId(Number(e.target.value) || null)}
              >
                <option value="">None</option>
                {allEvents.map(e => (
                  <option key={e.id} value={e.id}>{e.title} ({e.start_time.slice(0, 10)})</option>
                ))}
              </select>
            </div>
            {dependsOnId && (
              <div className={styles.dependsOffset}>
                <div className={styles.dependsLabel}>Offset (min)</div>
                <input
                  type="number"
                  className={`loom-field ${styles.dependsOffsetInput}`}
                  value={dependsOffset}
                  onChange={e => setDependsOffset(Number(e.target.value))}
                  title="Minutes after parent event ends (+) or before parent starts (-)"
                />
              </div>
            )}
          </div>
        )}

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
              <div className={styles.recurEndField}>
                <FieldLabel>Ends</FieldLabel>
                <input className={`loom-field ${styles.recurEndInput}`} type="date" value={recurEnd} onChange={e => setRecurEnd(e.target.value)} />
              </div>
              <div className={styles.recurEndField}>
                <FieldLabel>Skip dates</FieldLabel>
                {skipDatesList.length > 0 && (
                  <div className={styles.skipChips}>
                    {skipDatesList.map(d => (
                      <span key={d} className={styles.skipChip}>
                        {d}
                        <button
                          type="button"
                          className={styles.skipChipRemove}
                          onClick={() => removeSkipDate(d)}
                          aria-label={`Remove ${d}`}
                        >
                          <Icon d={Icons.x} size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className={styles.skipAdder}>
                  <input
                    className={`loom-field ${styles.skipDateInput}`}
                    type="date"
                    value={skipDraft}
                    onChange={e => setSkipDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    className="loom-btn-ghost"
                    onClick={addSkipDate}
                    disabled={!skipDraft.trim()}
                  >
                    Add
                  </button>
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

        {/* Clock-in / Clock-out */}
        {isEdit && (
          <div className={styles.clockRow}>
            {!actualStart ? (
              <button type="button" className={styles.clockBtn} onClick={() => handleClock('in')}>
                <Icon d={Icons.play} size={12} /> Start Tracking
              </button>
            ) : !actualEnd ? (
              <button type="button" className={`${styles.clockBtn} ${styles.clockBtnStop}`} onClick={() => handleClock('out')}>
                <Icon d={Icons.stop} size={12} /> Stop Tracking
              </button>
            ) : (
              <span className={styles.clockDone}>
                Tracked: {Math.round((new Date(actualEnd).getTime() - new Date(actualStart).getTime()) / 60000)} min
              </span>
            )}
          </div>
        )}

        {conflictWarning && (
          <div>
            <div className={styles.conflictWarn}>{conflictWarning}</div>
            {suggestionsOpen && suggestions.length > 0 && (
              <div className={styles.suggestionBox}>
                <div className={styles.suggestionHeader}>
                  Suggested alternatives
                </div>
                <div className={styles.suggestionList}>
                  {suggestions.map((s, i) => (
                    <SuggestionChip
                      key={i}
                      suggestion={s}
                      onClick={async (sug) => {
                        const p = buildPayload();
                        const updated = { ...p, start_time: sug.start, end_time: sug.end };
                        if (isEdit && event) {
                          const prev = event;
                          await updateEvent(event.id, updated);
                          pushUndo({
                            label: `Reschedule "${prev.title}"`,
                            undo: async () => { await updateEvent(event.id, prev as Parameters<typeof updateEvent>[1]); },
                            redo: async () => { await updateEvent(event.id, updated); },
                          });
                        } else {
                          const { event: created } = await createEvent(updated);
                          pushUndo({
                            label: `Create "${created.title}"`,
                            undo: async () => { await deleteEvent(created.id); },
                            redo: async () => {},
                          });
                        }
                        setSuggestionsOpen(false);
                        setConflictWarning('');
                        onSaved();
                        close();
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <ModalFooter>
        {templateNaming ? (
          <div className={styles.templateNameRow}>
            <input
              className={`loom-field ${styles.templateNameInput}`}
              placeholder="Template name"
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleSaveAsTemplate(); } }}
              autoFocus
            />
            <button className="loom-btn-ghost" onClick={() => { setTemplateNaming(false); setTemplateName(''); }}>Cancel</button>
            <button className="loom-btn-primary" onClick={handleSaveAsTemplate} disabled={!templateName.trim()}>Save template</button>
          </div>
        ) : (
          <>
            {isEdit && (
              <>
                <button className="loom-btn-ghost" onClick={handleAddToTaskBoard}>
                  {isOnTaskBoard
                    ? <><Icon d={Icons.check} size={12} /> On Task Board</>
                    : '+ Task Board'}
                </button>
                {instanceDate && (
                  <button className="loom-btn-ghost" onClick={handleSkipDate}>
                    Skip this date
                  </button>
                )}
              </>
            )}
            <button className="loom-btn-ghost" onClick={() => setTemplateNaming(true)}>Save as template</button>
            <div style={{ flex: 1 }} />
            {(() => {
              const missedBtn = getMissedButtonState(event, missedAt);
              if (!isEdit || !missedBtn.visible) return null;
              return (
                <button className="loom-btn-ghost" onClick={handleMarkToggle}>
                  {missedBtn.label}
                </button>
              );
            })()}
            {isEdit && (
              <button className={styles.deleteBtn} onClick={handleDeleteClick}>
                {confirmingDelete ? 'Really delete?' : 'Delete'}
              </button>
            )}
            <button className="loom-btn-ghost" onClick={close}>Cancel</button>
            <button
              className="loom-btn-primary"
              onClick={handleSubmit}
              disabled={!title.trim() || endInvalid}
              title={endInvalid ? 'End must be after start' : undefined}
            >
              {needsConfirm ? 'Save anyway' : isEdit ? 'Save changes' : 'Create event'}
              <Kbd small>⏎</Kbd>
            </button>
          </>
        )}

        {deleteScopeOpen && (
          <div className={styles.scopePopover} role="dialog" aria-label="Delete recurring event">
            <div className={styles.scopeTitle}>Delete recurring event</div>
            {instanceDate && (
              <button
                className={styles.scopeBtn}
                onClick={() => { setDeleteScopeOpen(false); void doDeleteOccurrence(); }}
              >
                This occurrence
              </button>
            )}
            <button
              className={`${styles.scopeBtn} ${styles.scopeBtnDanger}`}
              onClick={() => { setDeleteScopeOpen(false); void doDeleteAll(); }}
            >
              All occurrences
            </button>
            <button className={styles.scopeBtn} onClick={() => setDeleteScopeOpen(false)}>
              Cancel
            </button>
          </div>
        )}
      </ModalFooter>
    </ModalShell>
  );
}
