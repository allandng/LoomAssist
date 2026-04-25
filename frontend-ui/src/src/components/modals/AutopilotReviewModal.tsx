import { useState } from 'react';
import { ModalShell, ModalFooter } from './ModalShell';
import { useModal } from '../../contexts/ModalContext';
import { useUndo } from '../../contexts/UndoContext';
import { useNotifications } from '../../store/notifications';
import { createEvent, deleteEvent } from '../../api';
import type { AutopilotProposal, AutopilotOverflow, Calendar } from '../../types';

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
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
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

      addNotification({ type: 'success', title: `Applied ${createdIds.length} time block(s)`, autoRemoveMs: 4000 });
      onApplied();
      close();
    } catch {
      addNotification({ type: 'error', title: 'Apply failed', message: 'Could not create some events.' });
    } finally {
      setApplying(false);
    }
  }

  return (
    <ModalShell title="Draft week — review proposals" onClose={close}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
        {proposals.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            No tasks with estimated durations found. Add estimated time to tasks in the Task Board first.
          </p>
        )}

        {proposals.map(p => {
          const isAccepted = accepted.has(p.task_id);
          return (
            <div
              key={p.task_id}
              onClick={() => toggle(p.task_id)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                padding: '10px 12px', borderRadius: 8,
                background: isAccepted ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                border: `1px solid ${isAccepted ? 'var(--accent)' : 'var(--border)'}`,
                transition: 'all 0.12s',
              }}
            >
              <input type="checkbox" checked={isAccepted} onChange={() => toggle(p.task_id)} style={{ marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>{p.task_title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{formatRange(p.start, p.end)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{p.rationale}</div>
              </div>
            </div>
          );
        })}

        {overflow.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Overflow — couldn't schedule
            </div>
            {overflow.map(o => (
              <div key={o.task_id} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>
                <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>{o.task_title}</span>
                {' — '}{o.reason}
              </div>
            ))}
          </div>
        )}
      </div>

      <ModalFooter>
        <button className="loom-btn-ghost" onClick={() => close()}>Cancel</button>
        <button
          className="loom-btn-primary"
          onClick={handleApply}
          disabled={applying || accepted.size === 0}
        >
          {applying ? 'Applying…' : `Apply ${accepted.size} accepted`}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}
