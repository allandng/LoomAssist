import { useState, useEffect, useCallback, useRef, useId, type ReactNode } from 'react';
import styles from './EventEditorModal.module.css';
import { ModalShell, ModalFooter, ModalNotice } from './ModalShell';
import { modKey } from './platform';
import { SourceBadge } from '../shared/SourceBadge';
import { MentionTextarea } from '../shared/MentionTextarea';
import { SuggestionChip } from '../shared/SuggestionChip';
import {
  Button, IconButton, Field, Input, Select, Switch, Checkbox, Badge, Menu, TLDot, Icon, Icons,
  confirm as confirmDialog, prompt as promptDialog, type MenuEntry,
} from '../ui';
import { useModal, type EventEditorPrefill } from '../../contexts/ModalContext';
import { useUndo } from '../../contexts/UndoContext';
import { useNotifications } from '../../store/notifications';
import {
  createEvent, updateEvent, deleteEvent,
  createTemplate, createTask, listTasks, deleteTask,
  parseDateTime, clockEvent, resolveConflict, listCourses,
  cascadeDependents, listEvents, checkConflicts, skipEventDate, unskipEventDate,
  listAssignments, createAssignment, updateAssignment, deleteAssignment,
} from '../../api';
import type { Event, Calendar, ChecklistItem, ConflictSuggestion, Course } from '../../types';
import { parseChecklist } from '../../lib/eventUtils';
import { isExamLike, stripExamWord } from '../../lib/eventClassification';
import { checkSleepWindow } from '../../lib/sleepWindow';
import { getMissedButtonState } from '../../lib/missedEvents';

export type { EventEditorPrefill };

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function formatDT(dtLocal: string): string {
  if (!dtLocal) return '';
  const d = new Date(dtLocal);
  return isNaN(d.getTime()) ? dtLocal
    : d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function toLocalDT(iso: string): string {
  // Convert ISO datetime to datetime-local input value
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalDate(iso: string): string {
  return iso ? iso.split('T')[0] : '';
}

function formatDuration(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '';
  const mins = Math.round(ms / 60_000);
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
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
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ── Natural-language time helper (Ollama-backed) ────────────────────────── */

function NLTimeInput({ onResolved }: { onResolved: (localDT: string) => void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Remember the last string we actually sent to the parser so an unchanged
  // value (e.g. edited then reverted) doesn't re-fire the LLM.
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
        onResolved(local);
        setPreview(formatDT(local));
        return;
      }
      if (raw === lastParsedRef.current) return;
      lastParsedRef.current = raw;
      setParsing(true);
      try {
        const res = await parseDateTime(raw);
        onResolved(res.iso.slice(0, 16));
        setPreview(res.display);
      } catch {
        setError(true);
      } finally {
        setParsing(false);
      }
    }, 600);
  }, [onResolved]);

  return (
    <div className={styles.nl}>
      <Input
        size="sm"
        icon={Icons.sparkles}
        value={text}
        onChange={e => handleChange(e.target.value)}
        placeholder='Type a time, e.g. "next fri 2pm"'
        aria-label="Set the start time in plain language"
        invalid={error}
      />
      {(parsing || preview || error) && (
        <div className={[styles.nlPreview, error ? styles.nlError : ''].join(' ')} aria-live="polite">
          {parsing ? <><Icon d={Icons.loader} size={11} className={styles.spin} /> Parsing…</>
            : error ? <><Icon d={Icons.alertCircle} size={11} /> Couldn’t read that time</>
            : <><Icon d={Icons.check} size={11} strokeWidth={2.5} /> Start set to {preview}</>}
        </div>
      )}
    </div>
  );
}

/* ── Icon-led row ────────────────────────────────────────────────────────── */

function Row({ icon, active, label, children }: { icon: ReactNode; active?: boolean; label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={[styles.rowIcon, active ? styles.rowIconActive : ''].join(' ')} title={label} aria-hidden="true">
        <Icon d={icon} size={15} />
      </span>
      <div className={styles.rowBody}>{children}</div>
    </div>
  );
}

/* ── Props ───────────────────────────────────────────────────────────────── */

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
  const ids = useId();

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
    : (date  ? `${date}T10:00` : toLocalDT(new Date(new Date().getTime() + 3_600_000).toISOString()))
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
  const [description, setDescription] = useState(event?.description ?? prefill?.description ?? '');
  const [checklist, setChecklist]   = useState<ChecklistItem[]>(parseChecklist(event?.checklist ?? ''));

  // Recurrence
  const [recurring, setRecurring]   = useState(event?.is_recurring ?? prefill?.isRecurring ?? false);
  const [recurDays, setRecurDays]   = useState<number[]>(() => {
    const src = event?.recurrence_days ?? (event ? '' : prefill?.recurrenceDays) ?? '';
    return src ? src.split(',').map(Number).filter(n => !isNaN(n)) : [];
  });
  const [recurEnd, setRecurEnd]     = useState(event?.recurrence_end ? toLocalDate(event.recurrence_end) : '');
  const [skipDates, setSkipDates]   = useState(event?.skipped_dates ?? '');
  const [skipDraft, setSkipDraft]   = useState('');

  // Task board status
  const [isOnTaskBoard, setIsOnTaskBoard] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);

  const [conflictWarning, setConflictWarning] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Course link. Events link to a course through an Assignment row
  // (course_id + event_id) — the same mechanism the syllabus import uses.
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [initialCourseId, setInitialCourseId] = useState<number | null>(null);
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  useEffect(() => { listCourses().then(setCourses).catch(() => {}); }, []);
  useEffect(() => {
    if (!event?.id) return;
    let cancelled = false;
    listAssignments({ event_id: event.id }).then(rows => {
      if (cancelled || rows.length === 0) return;
      setCourseId(rows[0].course_id);
      setInitialCourseId(rows[0].course_id);
      setAssignmentId(rows[0].id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [event?.id]);

  // Dependencies
  const [allEvents, setAllEvents] = useState<Event[]>([]);
  const [dependsOnId, setDependsOnId] = useState<number | null>(event?.depends_on_event_id ?? null);
  const [dependsOffset, setDependsOffset] = useState<number>(event?.depends_offset_minutes ?? 0);
  useEffect(() => { listEvents().then(evs => setAllEvents(evs.filter(e => e.id !== event?.id))).catch(() => {}); }, [event?.id]);
  const [suggestions, setSuggestions] = useState<ConflictSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  // Duration tracking
  const [actualStart, setActualStart] = useState<string | null>(event?.actual_start ?? null);
  const [actualEnd,   setActualEnd]   = useState<string | null>(event?.actual_end   ?? null);

  // "Missed" opt-in marker — drives the Mark/Unmark action.
  const [missedAt, setMissedAt] = useState<string | null>(event?.missed_at ?? null);

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
    try {
      const updated = await clockEvent(event.id, action);
      setActualStart(updated.actual_start ?? null);
      setActualEnd(updated.actual_end ?? null);
      onSaved();
    } catch {
      addNotification({ type: 'error', title: action === 'in' ? 'Could not start tracking' : 'Could not stop tracking' });
    }
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

  // ---- Conflict verdict reset ----
  // Changing the time / timeline / all-day invalidates a prior conflict verdict —
  // clear it so the next save re-runs the pre-check instead of writing straight away.
  const resetConfirm = useCallback(() => {
    setNeedsConfirm(false);
    setConflictWarning('');
    setSuggestions([]);
    setSuggestionsOpen(false);
  }, []);
  const changeStart = useCallback((v: string) => { setStartVal(v); resetConfirm(); }, [resetConfirm]);
  const changeEnd   = useCallback((v: string) => { setEndVal(v);   resetConfirm(); }, [resetConfirm]);

  // ---- Date / time parts (structured inputs over the datetime-local strings) ----
  const startDate = startVal.slice(0, 10);
  const startTime = startVal.slice(11, 16) || '09:00';
  const endDate   = endVal.slice(0, 10);
  const endTime   = endVal.slice(11, 16) || '10:00';
  const [showEndDate, setShowEndDate] = useState(() => !allDay && startDate !== endDate);
  const durationMs = new Date(endVal).getTime() - new Date(startVal).getTime();

  const shiftBoth = useCallback((newStartLocal: string) => {
    // Preserve duration: move end by the same delta as start.
    const dur = new Date(endVal).getTime() - new Date(startVal).getTime();
    const ns = new Date(newStartLocal);
    changeStart(newStartLocal);
    if (!isNaN(ns.getTime()) && isFinite(dur) && dur > 0) changeEnd(toLocalDT(new Date(ns.getTime() + dur).toISOString()));
  }, [startVal, endVal, changeStart, changeEnd]);

  const onDateChange = (d: string) => {
    if (!d) return;
    if (allDay) {
      changeStart(d);
      if (!endVal || endVal < d) changeEnd(d);
      return;
    }
    shiftBoth(`${d}T${startTime}`);
  };
  const onStartTimeChange = (t: string) => { if (t) shiftBoth(`${startDate}T${t}`); };
  const onEndTimeChange   = (t: string) => { if (t) changeEnd(`${endDate || startDate}T${t}`); };
  const onEndDateChange   = (d: string) => { if (d) changeEnd(allDay ? d : `${d}T${endTime}`); };

  const toggleAllDay = (next: boolean) => {
    setAllDay(next);
    resetConfirm();
    if (next) {
      setStartVal(startDate);
      setEndVal(endDate || startDate);
      if (recurring) setRecurring(false);
      setShowEndDate(false);
    } else {
      setStartVal(`${startDate}T09:00`);
      setEndVal(`${endDate || startDate}T10:00`);
    }
  };

  const applyNaturalStart = useCallback((localDT: string) => {
    if (allDay) {
      const d = localDT.slice(0, 10);
      changeStart(d);
      if (!endVal || endVal < d) changeEnd(d);
    } else {
      shiftBoth(localDT);
    }
  }, [allDay, endVal, changeStart, changeEnd, shiftBoth]);

  // ---- Payload ----
  // Auto-clear-on-save: when called with no opts (the regular handleSubmit
  // path), `missed_at` goes out as null. Saving a marked event via the regular
  // Save button therefore unmarks it — the user implicitly recovered it.
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
      course_id: courseId,
    };
  }, [title, allDay, startVal, endVal, calendarId, reminder, reminderSource, location, travelTime,
      eventType, prepMinutes, description, checklist, recurring, recurDays, recurEnd, skipDates,
      dependsOnId, dependsOffset, event, courseId]);

  // Client-side validation: end must be after start. Blocks the save.
  const endInvalid = allDay
    ? (!!endVal && !!startVal && endVal < startVal)
    : (new Date(endVal).getTime() <= new Date(startVal).getTime());

  // Keep the Assignment row that links this event to a course in step with the
  // course picker (create / move / unlink). Never blocks the event save.
  const syncCourseLink = useCallback(async (eventId: number, startISO: string, eventTitle: string) => {
    try {
      const due = startISO.slice(0, 10);
      if (courseId && !assignmentId) {
        const a = await createAssignment({ course_id: courseId, title: eventTitle, due_date: due, weight_category: null, score: null, max_score: null, event_id: eventId });
        setAssignmentId(a.id);
      } else if (courseId && assignmentId && courseId !== initialCourseId) {
        await updateAssignment(assignmentId, { course_id: courseId, title: eventTitle, due_date: due });
      } else if (!courseId && assignmentId) {
        await deleteAssignment(assignmentId);
        setAssignmentId(null);
      }
      setInitialCourseId(courseId);
    } catch {
      addNotification({ type: 'warning', title: 'Course link not saved', message: 'The event was saved, but linking it to the course failed.' });
    }
  }, [courseId, assignmentId, initialCourseId, addNotification]);

  // The single write. Only runs once the conflict pre-check has cleared or the
  // user has explicitly confirmed "Save anyway" — never before.
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
      await syncCourseLink(event.id, payload.start_time, payload.title);
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
      await syncCourseLink(created.id, payload.start_time, payload.title);
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
  }, [isEdit, event, buildPayload, pushUndo, onSaved, close, openStudyBlock, addNotification, syncCourseLink]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || endInvalid || saving) return;
    setSaving(true);
    try {
      // First click (not yet confirmed): dry-run the conflict check and, if it
      // overlaps, warn + offer alternatives WITHOUT writing. The second click
      // ("Save anyway") skips the check and performs the single write.
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
          setConflictWarning(`Overlaps with ${names}.`);
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
    } catch {
      addNotification({ type: 'error', title: 'Save failed', message: 'Could not save the event.' });
    } finally {
      setSaving(false);
    }
  }, [title, endInvalid, saving, needsConfirm, event, buildPayload, performWrite, addNotification]);

  // A dirty editor must not be lost to a stray scrim click. Snapshot the
  // initial field values on first render and compare each render.
  const currentSnapshot = JSON.stringify({
    title, allDay, startVal, endVal, calendarId, reminder, reminderSource,
    location, travelTime, eventType, prepMinutes, description,
    checklist: JSON.stringify(checklist), recurring, recurDays: recurDays.join(','),
    recurEnd, skipDates, dependsOnId, dependsOffset, missedAt,
  });
  const [initialSnapshot] = useState(() => currentSnapshot);
  const dirty = currentSnapshot !== initialSnapshot || courseId !== initialCourseId;

  // ---- Delete ----
  const doDeleteAll = useCallback(async () => {
    if (!event) return;
    const snapshot = { ...event };
    await deleteEvent(event.id);
    pushUndo({
      label: `Delete "${event.title}"`,
      undo: async () => { const { id: _id, ...p } = snapshot; await createEvent(p); },
      redo: async () => { await deleteEvent(event.id); },
    });
    onSaved();
    close();
  }, [event, pushUndo, onSaved, close]);

  // Delete an occurrence of a recurring series = append it to skipped_dates.
  const doDeleteOccurrence = useCallback(async () => {
    if (!event || !instanceDate) return;
    await skipEventDate(event.id, { date: instanceDate });
    pushUndo({
      // Restore via the dedicated unskip route — a partial `{ skipped_dates }`
      // PUT would 422 against EventBase (required title/start/end/calendar_id).
      label: `Skip ${instanceDate} of "${event.title}"`,
      undo: async () => { await unskipEventDate(event.id, { date: instanceDate }); },
      redo: async () => { await skipEventDate(event.id, { date: instanceDate }); },
    });
    onSaved();
    close();
  }, [event, instanceDate, pushUndo, onSaved, close]);

  const handleDelete = useCallback(async () => {
    if (!event) return;
    const ok = await confirmDialog({
      title: `Delete "${event.title}"?`,
      description: 'The event is removed from your calendar. You can undo this afterwards.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (ok) await doDeleteAll();
  }, [event, doDeleteAll]);

  const handleDeleteSeries = useCallback(async () => {
    if (!event) return;
    const ok = await confirmDialog({
      title: `Delete every occurrence of "${event.title}"?`,
      description: 'The whole repeating series is removed. You can undo this afterwards.',
      destructive: true,
      confirmLabel: 'Delete series',
    });
    if (ok) await doDeleteAll();
  }, [event, doDeleteAll]);

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
      addNotification({ type: 'info', title: 'Removed from task board', autoRemoveMs: 2500 });
    } else {
      const t = await createTask({ event_id: event.id, is_complete: false, note: '', status: 'backlog', priority: 'med', due_date: '' });
      setIsOnTaskBoard(true);
      setTaskId(t.id);
      addNotification({ type: 'success', title: 'Added to task board', autoRemoveMs: 2500 });
    }
  }, [event, isOnTaskBoard, taskId, addNotification]);

  const handleSaveAsTemplate = useCallback(async () => {
    const name = await promptDialog({
      title: 'Save as template',
      description: 'Reuses this event’s title, duration, timeline and recurrence.',
      label: 'Template name',
      placeholder: 'e.g. Weekly standup',
      defaultValue: title.trim(),
      validate: v => (v.trim() ? null : 'Enter a name for the template'),
      confirmLabel: 'Save template',
    });
    if (!name) return;
    try {
      await createTemplate({
        name: name.trim(), title: title.trim(), description,
        duration_minutes: Math.round((new Date(endVal).getTime() - new Date(startVal).getTime()) / 60_000) || 60,
        is_recurring: recurring, recurrence_days: recurDays.join(','), calendar_id: calendarId,
      });
      addNotification({ type: 'success', title: 'Template saved', message: `"${name.trim()}" added to templates`, autoRemoveMs: 3000 });
    } catch {
      addNotification({ type: 'error', title: 'Could not save template' });
    }
  }, [title, description, startVal, endVal, recurring, recurDays, calendarId, addNotification]);

  const toggleRecurDay = useCallback((dow: number) => {
    setRecurDays(prev => prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow]);
  }, []);

  // Skip-dates as a removable chip list backed by the comma string.
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

  // Apply a suggested alternative slot directly (writes immediately).
  const applySuggestion = useCallback(async (sug: ConflictSuggestion) => {
    const p = buildPayload();
    const updated = { ...p, start_time: sug.start, end_time: sug.end };
    try {
      if (isEdit && event) {
        const prev = event;
        await updateEvent(event.id, updated);
        pushUndo({
          label: `Reschedule "${prev.title}"`,
          undo: async () => { await updateEvent(event.id, prev as Parameters<typeof updateEvent>[1]); },
          redo: async () => { await updateEvent(event.id, updated); },
        });
        await syncCourseLink(event.id, updated.start_time, updated.title);
      } else {
        const { event: created } = await createEvent(updated);
        pushUndo({
          label: `Create "${created.title}"`,
          undo: async () => { await deleteEvent(created.id); },
          redo: async () => {},
        });
        await syncCourseLink(created.id, updated.start_time, updated.title);
      }
      setSuggestionsOpen(false);
      setConflictWarning('');
      onSaved();
      close();
    } catch {
      addNotification({ type: 'error', title: 'Could not apply that time' });
    }
  }, [buildPayload, isEdit, event, pushUndo, onSaved, close, addNotification, syncCourseLink]);

  // ⌘/Ctrl+Enter saves from anywhere in the sheet.
  const onFormKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  // ---- Footer menus ----
  const missedBtn = getMissedButtonState(event, missedAt);
  const moreItems: MenuEntry[] = [
    { id: 'template', label: 'Save as template', icon: Icons.bookmark, onSelect: () => { void handleSaveAsTemplate(); } },
    ...(isEdit ? [
      { id: 'task', label: isOnTaskBoard ? 'Remove from task board' : 'Add to task board', icon: Icons.tasks, checked: isOnTaskBoard, onSelect: () => { void handleAddToTaskBoard(); } },
      ...(instanceDate ? [{ id: 'skip', label: 'Skip this date', icon: Icons.chevronsRight, onSelect: () => { void handleSkipDate(); } }] : []),
      ...(missedBtn.visible ? [{ id: 'missed', label: missedBtn.label ?? 'Mark as missed', icon: Icons.flag, onSelect: () => { void handleMarkToggle(); } }] : []),
    ] : []),
  ];
  const deleteItems: MenuEntry[] = [
    ...(instanceDate ? [{ id: 'occ', label: 'This occurrence', icon: Icons.calendar, onSelect: () => { void doDeleteOccurrence(); } }] : []),
    { id: 'all', label: 'All occurrences', icon: Icons.trash, danger: true, onSelect: () => { void handleDeleteSeries(); } },
  ];

  const trackedMin = actualStart && actualEnd
    ? Math.round((new Date(actualEnd).getTime() - new Date(actualStart).getTime()) / 60000)
    : null;

  return (
    <ModalShell
      variant="sheet"
      title={isEdit ? 'Edit event' : 'New event'}
      subtitle={isEdit && event ? formatDT(toLocalDT(event.start_time)) : undefined}
      onClose={close}
      confirmOnClose={dirty}
    >
      <div className={styles.form} onKeyDown={onFormKeyDown}>

        {isLocked && (
          <ModalNotice tone="info" icon={<Icon d={Icons.lock} size={13} />}>
            Time set by an availability booking — the notes are read-only.
          </ModalNotice>
        )}

        {/* Title + timeline */}
        <div className={styles.titleBlock}>
          <input
            id={`${ids}-title`}
            className={styles.titleInput}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Event title"
            aria-label="Event title"
            autoFocus
            data-autofocus
          />
          <div className={styles.tlRow}>
            <TLDot color={selectedTimeline?.color ?? 'var(--accent)'} size={10} />
            <div className={styles.tlSelect}>
              <Select
                size="sm"
                value={calendarId}
                aria-label="Timeline"
                onChange={e => { setCalendarId(Number(e.target.value)); resetConfirm(); }}
              >
                {timelines.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
          </div>
        </div>

        {/* When */}
        <Row icon={Icons.clock} label="When">
          {allDay ? (
            <div className={styles.inline}>
              <div className={styles.dateInput}><Input type="date" value={startVal} aria-label="Start date" onChange={e => onDateChange(e.target.value)} /></div>
              <span className={styles.dash} aria-hidden="true">→</span>
              <div className={styles.dateInput}><Input type="date" value={endVal} aria-label="End date" onChange={e => onEndDateChange(e.target.value)} invalid={endInvalid} /></div>
            </div>
          ) : (
            <>
              <div className={styles.inline}>
                <div className={styles.dateInput}><Input type="date" value={startDate} aria-label="Date" onChange={e => onDateChange(e.target.value)} /></div>
                <div className={styles.timeInput}><Input type="time" step={300} value={startTime} aria-label="Start time" onChange={e => onStartTimeChange(e.target.value)} /></div>
                <span className={styles.dash} aria-hidden="true">–</span>
                <div className={styles.timeInput}><Input type="time" step={300} value={endTime} aria-label="End time" onChange={e => onEndTimeChange(e.target.value)} invalid={endInvalid} /></div>
              </div>
              {showEndDate && (
                <div className={styles.inline}>
                  <span className={styles.subLabel}>Ends on</span>
                  <div className={styles.dateInput}><Input type="date" value={endDate} aria-label="End date" onChange={e => onEndDateChange(e.target.value)} invalid={endInvalid} /></div>
                </div>
              )}
            </>
          )}
          <div className={styles.sub}>
            <Switch size="sm" checked={allDay} onChange={toggleAllDay} label="All day" />
            <div className={styles.subRight}>
              {!allDay && !showEndDate && (
                <Button variant="subtle" size="sm" onClick={() => setShowEndDate(true)}>Ends another day</Button>
              )}
              {!allDay && durationMs > 0 && <span className={styles.durationHint}>{formatDuration(durationMs)}</span>}
            </div>
          </div>
          {endInvalid && <div className={styles.validation} role="alert">End must be after start.</div>}
          <NLTimeInput onResolved={applyNaturalStart} />
        </Row>

        {/* Repeat */}
        <Row icon={Icons.repeat} label="Repeat" active={recurring}>
          <Switch
            size="sm"
            checked={recurring}
            onChange={v => { if (!allDay) setRecurring(v); }}
            disabled={allDay}
            label={recurring ? 'Repeats weekly' : 'Does not repeat'}
            description={allDay ? 'All-day events can’t repeat' : undefined}
          />
          {recurring && (
            <>
              <div className={styles.dowRow} role="group" aria-label="Repeat on">
                {DOW.map((d, i) => {
                  const on = recurDays.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      className={[styles.dow, on ? styles.dowOn : ''].join(' ')}
                      aria-pressed={on}
                      aria-label={DOW_FULL[i]}
                      onClick={() => toggleRecurDay(i)}
                    >{d}</button>
                  );
                })}
              </div>
              <div className={styles.grid2}>
                <Field label="Ends" htmlFor={`${ids}-recur-end`}>
                  <Input id={`${ids}-recur-end`} type="date" value={recurEnd} onChange={e => setRecurEnd(e.target.value)} />
                </Field>
                <Field label="Skip a date" htmlFor={`${ids}-skip`}>
                  <div className={styles.inline}>
                    <div className={styles.grow}><Input id={`${ids}-skip`} type="date" value={skipDraft} onChange={e => setSkipDraft(e.target.value)} /></div>
                    <IconButton icon={Icons.plus} label="Add skipped date" variant="ghost" onClick={addSkipDate} disabled={!skipDraft.trim()} />
                  </div>
                </Field>
              </div>
              {skipDatesList.length > 0 && (
                <div className={styles.chips} aria-label="Skipped dates">
                  {skipDatesList.map(d => (
                    <span key={d} className={styles.chip}>
                      {d}
                      <button type="button" className={styles.chipRemove} onClick={() => removeSkipDate(d)} aria-label={`Remove ${d}`}>
                        <Icon d={Icons.x} size={10} strokeWidth={2.25} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </Row>

        {/* Location + travel */}
        <Row icon={Icons.mapPin} label="Location">
          <div className={styles.inline}>
            <div className={styles.grow}>
              <Input placeholder="Add a location" value={location} aria-label="Location" onChange={e => setLocation(e.target.value)} />
            </div>
            <div className={styles.travelWrap}>
              <div className={styles.travelInput}>
                <Input type="number" min={0} step={5} placeholder="0" value={travelTime || ''} aria-label="Travel time in minutes" onChange={e => setTravelTime(Number(e.target.value))} />
              </div>
              <span className={styles.unit}>min travel</span>
            </div>
          </div>
        </Row>

        {/* Reminder */}
        <Row icon={Icons.alarm} label="Reminder">
          <Field
            label="Reminder"
            htmlFor={`${ids}-reminder`}
            labelRight={reminderSource === 'inferred' ? <Badge tone="accent" size="sm" icon={Icons.sparkles} title="Suggested from the event title">Suggested</Badge> : undefined}
          >
            <Select id={`${ids}-reminder`} value={reminder} onChange={e => { setReminder(Number(e.target.value)); setReminderSource('user'); }}>
              {REMINDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
        </Row>

        {/* Course */}
        {courses.length > 0 && (
          <Row icon={Icons.graduation} label="Course" active={!!courseId}>
            <Field label="Course" htmlFor={`${ids}-course`} hint={courseId ? 'Shows up as an assignment for this course.' : undefined}>
              <Select
                id={`${ids}-course`}
                value={courseId ?? ''}
                onChange={e => {
                  const val = Number(e.target.value) || null;
                  setCourseId(val);
                  // Auto-set timeline to the course's default if available
                  const c = courses.find(c => c.id === val);
                  if (c?.timeline_id) { setCalendarId(c.timeline_id); resetConfirm(); }
                }}
              >
                <option value="">No course</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>)}
              </Select>
            </Field>
          </Row>
        )}

        {/* Type + prep */}
        <Row icon={Icons.tag} label="Type">
          <div className={styles.grid2}>
            <Field label="Event type" htmlFor={`${ids}-type`}>
              <Select id={`${ids}-type`} value={eventType} onChange={e => setEventType(e.target.value as typeof eventType)}>
                <option value="">None</option>
                <option value="lecture">Lecture</option>
                <option value="lab">Lab</option>
                <option value="office_hours">Office hours</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            {eventType === 'lecture' && !allDay && (
              <Field label="Prep before" htmlFor={`${ids}-prep`} hint="Minutes blocked before the lecture">
                <Input id={`${ids}-prep`} type="number" min={0} step={5} placeholder="0" value={prepMinutes || ''} onChange={e => setPrepMinutes(Number(e.target.value))} />
              </Field>
            )}
          </div>
        </Row>

        {/* Depends on */}
        {allEvents.length > 0 && (
          <Row icon={Icons.link} label="Depends on" active={!!dependsOnId}>
            <div className={styles.dependsGrid}>
              <Field label="Depends on" htmlFor={`${ids}-dep`}>
                <Select id={`${ids}-dep`} value={dependsOnId ?? ''} onChange={e => setDependsOnId(Number(e.target.value) || null)}>
                  <option value="">None</option>
                  {allEvents.map(e => (
                    <option key={e.id} value={e.id}>{e.title} ({e.start_time.slice(0, 10)})</option>
                  ))}
                </Select>
              </Field>
              {dependsOnId && (
                <Field label="Offset (min)" htmlFor={`${ids}-offset`} hint="After the parent ends (+) or before it starts (−)">
                  <Input id={`${ids}-offset`} type="number" value={dependsOffset} onChange={e => setDependsOffset(Number(e.target.value))} />
                </Field>
              )}
            </div>
          </Row>
        )}

        {/* Checklist */}
        <Row icon={Icons.tasks} label="Checklist" active={checklist.length > 0}>
          <div className={styles.rowHead}>
            <span className={styles.rowLabel}>Checklist</span>
            {checklist.length > 0 && (
              <span className={styles.count}>{checklist.filter(c => c.done).length}/{checklist.length}</span>
            )}
          </div>
          {checklist.map((item, idx) => (
            <div key={idx} className={styles.checkRow}>
              <Checkbox round checked={item.done} onChange={() => toggleChecklistItem(idx)} aria-label={item.text ? `Done: ${item.text}` : 'Done'} />
              <input
                className={[styles.checkText, item.done ? styles.checkTextDone : ''].join(' ')}
                value={item.text}
                onChange={e => updateChecklistText(idx, e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); addChecklistItem(); } }}
                placeholder="Checklist item"
                aria-label={`Checklist item ${idx + 1}`}
              />
              <IconButton icon={Icons.x} label="Remove item" size="sm" className={styles.checkRemove} onClick={() => removeChecklistItem(idx)} />
            </div>
          ))}
          <div>
            <Button variant="subtle" size="sm" icon={Icons.plus} onClick={addChecklistItem}>Add item</Button>
          </div>
        </Row>

        {/* Notes */}
        <Row icon={Icons.doc} label="Notes">
          <Field label="Notes" htmlFor={`${ids}-notes`} hint="Markdown · type @ to mention another event">
            <MentionTextarea id={`${ids}-notes`} value={description} onChange={setDescription} readOnly={isLocked} placeholder="Add notes" />
          </Field>
        </Row>

        {/* Conflict verdict + alternatives */}
        {conflictWarning && (
          <div>
            <ModalNotice tone="warning" icon={<Icon d={Icons.warning} size={13} />}>
              {conflictWarning} Save anyway, or pick another time below.
            </ModalNotice>
            {suggestionsOpen && suggestions.length > 0 && (
              <div className={styles.suggestions}>
                <div className={styles.rowLabel}>Suggested alternatives</div>
                {suggestions.map((s, i) => (
                  <SuggestionChip key={i} suggestion={s} onClick={sug => { void applySuggestion(sug); }} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Metadata cluster */}
        {isEdit && (
          <div className={styles.meta}>
            <SourceBadge variant="editor" connectionCalendarId={event?.connection_calendar_id} lastSyncedAt={event?.last_synced_at} />
            {trackedMin != null && (
              <div className={styles.metaRow}>
                <Icon d={Icons.timer} size={13} />
                <span>Tracked {trackedMin} min</span>
              </div>
            )}
            {actualStart && !actualEnd && (
              <div className={styles.metaRow}>
                <Icon d={Icons.timer} size={13} />
                <span>Tracking since {new Date(actualStart).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            )}
            {missedAt && (
              <div className={styles.metaRow}>
                <Badge tone="warning" size="sm" dot>Marked as missed</Badge>
                <span className={styles.metaHint}>Saving clears the mark.</span>
              </div>
            )}
            {isOnTaskBoard && (
              <div className={styles.metaRow}>
                <Badge tone="neutral" size="sm" icon={Icons.tasks}>On task board</Badge>
              </div>
            )}
            {event?.external_uid && !event.connection_calendar_id && (
              <div className={styles.metaRow}>
                <Icon d={Icons.download} size={13} />
                <span>Imported from a calendar file</span>
              </div>
            )}
          </div>
        )}
      </div>

      <ModalFooter
        left={(
          <>
            {isEdit && event && (
              event.is_recurring ? (
                <Menu
                  items={deleteItems}
                  side="top"
                  trigger={({ toggle, ref, open: _open, ...a }) => (
                    <Button ref={ref} variant="danger" icon={Icons.trash} iconRight={Icons.chevronUp} onClick={toggle} {...a}>Delete</Button>
                  )}
                />
              ) : (
                <Button variant="danger" icon={Icons.trash} onClick={() => { void handleDelete(); }}>Delete</Button>
              )
            )}
            {isEdit && !actualStart && (
              <IconButton icon={Icons.play} label="Start tracking" variant="ghost" onClick={() => { void handleClock('in'); }} />
            )}
            {isEdit && actualStart && !actualEnd && (
              <IconButton icon={Icons.stop} label="Stop tracking" variant="ghost" onClick={() => { void handleClock('out'); }} />
            )}
            <Menu
              items={moreItems}
              side="top"
              trigger={({ toggle, ref, open: _open, ...a }) => (
                <IconButton ref={ref} icon={Icons.more} label="More actions" variant="ghost" onClick={toggle} {...a} />
              )}
            />
          </>
        )}
      >
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => { void handleSubmit(); }}
          disabled={!title.trim() || endInvalid}
          loading={saving}
          kbd={`${modKey()}↵`}
          title={endInvalid ? 'End must be after start' : undefined}
        >
          {needsConfirm ? 'Save anyway' : isEdit ? 'Save changes' : 'Create event'}
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}
