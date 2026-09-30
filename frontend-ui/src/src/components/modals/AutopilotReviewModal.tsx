import { useState } from 'react';
import { ModalShell, ModalFooter, ModalStack } from './ModalShell';
import { Button, Checkbox, Badge, EmptyState, Icon, Icons } from '../ui';
import { useModal } from '../../contexts/ModalContext';
import { useUndo } from '../../contexts/UndoContext';
import { useNotifications } from '../../store/notifications';
import { createEvent, deleteEvent } from '../../api';
import type { AutopilotProposal, AutopilotOverflow, Calendar } from '../../types';
import styles from './AutopilotReviewModal.module.css';

interface Props {
  proposals: AutopilotProposal[];
  overflow: AutopilotOverflow[];
  timelines: Calendar[];
  onApplied: () => void;
}

function formatRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} – ${e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function AutopilotReviewModal({ proposals, overflow, timelines, onApplied }: Props) {
  const { close } = useModal();
  const { push: pushUndo } = useUndo();
  const { addNotification } = useNotifications();
  const [accepted, setAccepted] = useState<Set<number>>(new Set(proposals.map(p => p.task_id)));
  const [applying, setApplying] = useState(false);

  const defaultCalId = timelines[0]?.id ?? 1;

  function toggle(taskId: number) {
    setAccepted(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }

  async function handleApply() {
    setApplying(true);
    const toCreate = proposals.filter(p => accepted.has(p.task_id));
    const createdIds: number[] = [];
    try {
      for (const p of toCreate) {
        const { event: created } = await createEvent({
          title: p.task_title,
          start_time: p.start,
          end_time: p.end,
          calendar_id: defaultCalId,
          is_recurring: false,
          recurrence_days: '',
          recurrence_end: '',
          description: `Autopilot: ${p.rationale}`,
          unique_description: '',
          reminder_minutes: 0,
          external_uid: '',
          timezone: 'local',
          is_all_day: false,
          skipped_dates: '',
          per_day_times: '',
          checklist: '[]',
        });
        createdIds.push(created.id);
      }

      pushUndo({
        label: `Autopilot: create ${createdIds.length} event(s)`,
        undo: async () => { for (const id of createdIds) await deleteEvent(id); },
        redo: async () => {},
      });

      addNotification({ type: 'success', title: `Added ${createdIds.length} time block${createdIds.length !== 1 ? 's' : ''}`, autoRemoveMs: 4000 });
      onApplied();
      close();
    } catch {
      addNotification({ type: 'error', title: 'Apply failed', message: 'Could not create some events.' });
    } finally {
      setApplying(false);
    }
  }

  const skipped = proposals.length - accepted.size;

  return (
    <ModalShell
      title="Draft week"
      subtitle={proposals.length > 0 ? `${proposals.length} proposal${proposals.length !== 1 ? 's' : ''} · accept the ones you want on the calendar` : undefined}
      size="md"
      onClose={close}
      flush
    >
      {proposals.length === 0 ? (
        <EmptyState
          icon={Icons.zap}
          title="Nothing to schedule"
          description="Add an estimated duration to tasks on the task board and Autopilot will find time for them."
        />
      ) : (
        <div className={styles.body}>
          <ModalStack>
            <div className={styles.toolbar}>
              <span className={styles.summary}>
                <Badge tone="success" size="sm" dot>{accepted.size} accepted</Badge>
                {skipped > 0 && <Badge tone="neutral" size="sm" dot>{skipped} skipped</Badge>}
              </span>
              <span className={styles.toolbarActions}>
                <Button variant="subtle" size="sm" onClick={() => setAccepted(new Set(proposals.map(p => p.task_id)))}>Accept all</Button>
                <Button variant="subtle" size="sm" onClick={() => setAccepted(new Set())}>Skip all</Button>
              </span>
            </div>

            <ul className={styles.list} aria-label="Proposed time blocks">
              {proposals.map(p => {
                const isAccepted = accepted.has(p.task_id);
                return (
                  <li key={p.task_id} className={[styles.item, isAccepted ? styles.itemOn : styles.itemOff].join(' ')}>
                    <Checkbox checked={isAccepted} onChange={() => toggle(p.task_id)} aria-label={`Accept ${p.task_title}`} />
                    <div className={styles.itemText}>
                      <div className={styles.itemTitle}>{p.task_title}</div>
                      <div className={styles.itemWhen}><Icon d={Icons.clock} size={11} /> {formatRange(p.start, p.end)}</div>
                      <div className={styles.itemWhy}>{p.rationale}</div>
                    </div>
                    <Button size="sm" variant={isAccepted ? 'subtle' : 'secondary'} onClick={() => toggle(p.task_id)}>
                      {isAccepted ? 'Skip' : 'Accept'}
                    </Button>
                  </li>
                );
              })}
            </ul>

            {overflow.length > 0 && (
              <div className={styles.overflow}>
                <div className={styles.overflowTitle}>
                  <Icon d={Icons.warning} size={13} />
                  Couldn’t fit {overflow.length} task{overflow.length !== 1 ? 's' : ''}
                </div>
                <ul className={styles.overflowList}>
                  {overflow.map(o => (
                    <li key={o.task_id} className={styles.overflowItem}>
                      <span className={styles.overflowTask}>{o.task_title}</span>
                      <span className={styles.overflowReason}>{o.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </ModalStack>
        </div>
      )}

      <ModalFooter>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        {proposals.length > 0 && (
          <Button variant="primary" icon={Icons.check} onClick={() => { void handleApply(); }} disabled={accepted.size === 0} loading={applying}>
            Add {accepted.size} to calendar
          </Button>
        )}
      </ModalFooter>
    </ModalShell>
  );
}
