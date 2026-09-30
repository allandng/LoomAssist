import { useState, useCallback, useEffect, useId } from 'react';
import { ModalShell, ModalFooter, ModalStack } from './ModalShell';
import { Button, IconButton, Field, Input, Select, Switch, Checkbox, Badge, Icon, Icons } from '../ui';
import { useModal } from '../../contexts/ModalContext';
import { useUndo } from '../../contexts/UndoContext';
import { useNotifications } from '../../store/notifications';
import { getStudyBlockPreview, confirmStudyBlocks, listAssignments } from '../../api';
import type { Event, StudyBlockPreview } from '../../types';
import styles from './StudyBlockModal.module.css';

interface StudyBlockModalProps {
  deadlineEvent: Event;
  subject: string;
  onSaved: () => void;
}

const DURATION_OPTIONS = [30, 60, 90, 120];

function formatBlockDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDeadline(ds: string): string {
  const d = new Date(`${ds}T00:00`);
  return isNaN(d.getTime()) ? ds : d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

export function StudyBlockModal({ deadlineEvent, subject, onSaved }: StudyBlockModalProps) {
  const { close } = useModal();
  const { push: pushUndo } = useUndo();
  const { addNotification } = useNotifications();
  const ids = useId();

  const [numSessions, setNumSessions]       = useState(5);
  const [sessionDuration, setSessionDuration] = useState(90);
  const [preferredHour, setPreferredHour]   = useState(18);
  const [skipWeekends, setSkipWeekends]     = useState(true);
  const [preview, setPreview]               = useState<StudyBlockPreview[] | null>(null);
  const [selected, setSelected]             = useState<Set<number>>(new Set());
  const [loading, setLoading]               = useState(false);
  const [confirming, setConfirming]         = useState(false);
  const [assignmentId, setAssignmentId]     = useState<number | null>(null);

  const deadlineDate = deadlineEvent.start_time.slice(0, 10);

  useEffect(() => {
    let cancelled = false;
    listAssignments({ event_id: deadlineEvent.id })
      .then(rows => { if (!cancelled && rows.length === 1) setAssignmentId(rows[0].id); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [deadlineEvent.id]);

  const handlePreview = useCallback(async () => {
    setLoading(true);
    try {
      const blocks = await getStudyBlockPreview({
        subject: subject || deadlineEvent.title,
        deadline_date: deadlineDate,
        calendar_id: deadlineEvent.calendar_id,
        num_sessions: numSessions,
        session_duration_minutes: sessionDuration,
        preferred_hour: preferredHour,
        skip_weekends: skipWeekends,
        assignment_id: assignmentId,
      });
      setPreview(blocks);
      setSelected(new Set(blocks.map((_, i) => i)));
    } catch {
      addNotification({ type: 'error', title: 'Preview failed', message: 'Could not generate a preview.', autoRemoveMs: 4000 });
    } finally {
      setLoading(false);
    }
  }, [subject, deadlineEvent, deadlineDate, numSessions, sessionDuration, preferredHour, skipWeekends, assignmentId, addNotification]);

  const toggleBlock = useCallback((idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!preview) return;
    const toCreate = preview.filter((_, i) => selected.has(i));
    if (toCreate.length === 0) { close(); return; }

    setConfirming(true);
    try {
      const { created_count } = await confirmStudyBlocks(toCreate);
      onSaved();

      // confirmStudyBlocks returns a count, not ids — undo is best-effort and
      // redo re-creates the same blocks.
      pushUndo({
        label: `Add ${created_count} study block${created_count !== 1 ? 's' : ''}`,
        undo: async () => { /* events were created without returned ids in this type */ },
        redo: async () => { await confirmStudyBlocks(toCreate); },
      });

      addNotification({
        type: 'success',
        title: `${created_count} study block${created_count !== 1 ? 's' : ''} scheduled`,
        autoRemoveMs: 3000,
      });
      close();
    } catch {
      addNotification({ type: 'error', title: 'Failed to schedule', message: 'Could not create the study blocks.', autoRemoveMs: 4000 });
    } finally {
      setConfirming(false);
    }
  }, [preview, selected, onSaved, pushUndo, addNotification, close]);

  const selectedCount = selected.size;
  const hourLabel = new Date(2000, 0, 1, preferredHour).toLocaleTimeString([], { hour: 'numeric' });

  return (
    <ModalShell
      title="Plan study sessions"
      subtitle={`${subject || deadlineEvent.title} · due ${formatDeadline(deadlineDate)}`}
      size="md"
      onClose={close}
    >
      <ModalStack>
        <p className={styles.lede}>
          Spaces sessions out before the deadline and drops them into free time on your calendar.
        </p>

        <div className={styles.settings}>
          <Field label="Sessions">
            <div className={styles.stepper} role="group" aria-label="Number of sessions">
              <IconButton icon={Icons.minus} label="Fewer sessions" variant="ghost" size="sm" onClick={() => setNumSessions(n => Math.max(2, n - 1))} disabled={numSessions <= 2} />
              <span className={styles.stepperValue} aria-live="polite">{numSessions}</span>
              <IconButton icon={Icons.plus} label="More sessions" variant="ghost" size="sm" onClick={() => setNumSessions(n => Math.min(8, n + 1))} disabled={numSessions >= 8} />
            </div>
          </Field>

          <Field label="Length" htmlFor={`${ids}-dur`}>
            <Select id={`${ids}-dur`} value={sessionDuration} onChange={e => setSessionDuration(Number(e.target.value))}>
              {DURATION_OPTIONS.map(m => <option key={m} value={m}>{m} min</option>)}
            </Select>
          </Field>

          <Field label="Preferred start" htmlFor={`${ids}-hour`} hint={hourLabel}>
            <Input id={`${ids}-hour`} type="number" min={0} max={23} value={preferredHour} onChange={e => setPreferredHour(Math.min(23, Math.max(0, Number(e.target.value))))} />
          </Field>

          <div className={styles.switchCell}>
            <Switch checked={skipWeekends} onChange={setSkipWeekends} label="Skip weekends" />
          </div>
        </div>

        <div>
          <Button variant="secondary" icon={preview ? Icons.refresh : Icons.sparkles} onClick={() => { void handlePreview(); }} loading={loading}>
            {preview ? 'Refresh preview' : 'Preview sessions'}
          </Button>
        </div>

        {preview && (
          preview.length === 0 ? (
            <div className={styles.emptyMsg}>
              <Icon d={Icons.alertCircle} size={14} />
              No sessions fit before the deadline with these settings. Try fewer or shorter sessions.
            </div>
          ) : (
            <div className={styles.previewList} role="list" aria-label="Proposed sessions">
              {preview.map((block, i) => {
                const on = selected.has(i);
                return (
                  <div key={i} role="listitem" className={[styles.blockRow, on ? '' : styles.blockOff].join(' ')}>
                    <Checkbox round checked={on} onChange={() => toggleBlock(i)} aria-label={`Include ${block.title}`} />
                    <span className={styles.blockDate}>{formatBlockDate(block.start_time)}</span>
                    <span className={styles.blockTitle}>{block.title}</span>
                    <Badge size="sm">{sessionDuration} min</Badge>
                  </div>
                );
              })}
            </div>
          )
        )}
      </ModalStack>

      <ModalFooter left={<Button variant="subtle" onClick={close}>Skip for now</Button>}>
        {preview && preview.length > 0 && (
          <Button variant="primary" icon={Icons.calendar} onClick={() => { void handleConfirm(); }} disabled={selectedCount === 0} loading={confirming}>
            Schedule {selectedCount} session{selectedCount !== 1 ? 's' : ''}
          </Button>
        )}
      </ModalFooter>
    </ModalShell>
  );
}
