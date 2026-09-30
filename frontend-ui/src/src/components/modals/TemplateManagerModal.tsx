// "Manage templates" — list saved event templates, apply one into a new
// event (pre-filled editor) or delete it.

import { useEffect, useState } from 'react';
import { ModalShell, ModalFooter } from './ModalShell';
import { useModal } from '../../contexts/ModalContext';
import { useNotifications } from '../../store/notifications';
import { listTemplates, deleteTemplate, listCalendars } from '../../api';
import { Button, IconButton, Badge, EmptyState, Skeleton, TLDot, Icons, confirm as confirmDialog } from '../ui';
import type { EventTemplate, Calendar } from '../../types';
import styles from './TemplateManagerModal.module.css';

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function describeRecurrence(t: EventTemplate): string | null {
  if (!t.is_recurring) return null;
  const days = t.recurrence_days.split(',').map(Number).filter(n => !isNaN(n) && n >= 0 && n <= 6);
  if (days.length === 0) return 'Weekly';
  return `Weekly · ${days.map(d => DOW_SHORT[d]).join(' ')}`;
}

function describeDuration(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function TemplateManagerModal({ onSaved }: { onSaved: () => void }) {
  const { close, openEventEditor } = useModal();
  const { addNotification } = useNotifications();
  const [templates, setTemplates] = useState<EventTemplate[] | null>(null);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listTemplates(), listCalendars().catch(() => [] as Calendar[])])
      .then(([tpls, cals]) => { if (!cancelled) { setTemplates(tpls); setTimelines(cals); } })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Could not load templates'); setTemplates([]); } });
    return () => { cancelled = true; };
  }, []);

  function apply(t: EventTemplate) {
    // Same accelerator as the calendar sidebar: start at the next quarter hour,
    // carry title / duration / recurrence / timeline into a new event.
    const ms = 15 * 60_000;
    const start = new Date(Math.ceil(new Date().getTime() / ms) * ms);
    const end = new Date(start.getTime() + (t.duration_minutes || 60) * 60_000);
    openEventEditor(null, undefined, undefined, start.toISOString(), end.toISOString(), {
      title: t.title,
      calendarId: t.calendar_id || undefined,
      isRecurring: t.is_recurring,
      recurrenceDays: t.recurrence_days,
      description: t.description || undefined,
    });
  }

  async function remove(t: EventTemplate) {
    const ok = await confirmDialog({
      title: `Delete template "${t.name}"?`,
      description: 'Events already created from it are not affected.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setBusyId(t.id);
    try {
      await deleteTemplate(t.id);
      setTemplates(prev => (prev ?? []).filter(x => x.id !== t.id));
      addNotification({ type: 'success', title: 'Template deleted', autoRemoveMs: 2500 });
      onSaved();
    } catch {
      addNotification({ type: 'error', title: 'Could not delete template' });
    } finally {
      setBusyId(null);
    }
  }

  const count = templates?.length ?? 0;

  return (
    <ModalShell
      title="Templates"
      subtitle={templates ? `${count} saved template${count === 1 ? '' : 's'}` : undefined}
      size="md"
      onClose={close}
      flush
    >
      {templates === null && (
        <div className={styles.skeletons}>
          {[0, 1, 2].map(i => <Skeleton key={i} height={52} radius={8} />)}
        </div>
      )}

      {templates !== null && error && (
        <div className={styles.errorRow}><Badge tone="error" dot>{error}</Badge></div>
      )}

      {templates !== null && !error && templates.length === 0 && (
        <EmptyState
          icon={Icons.bookmark}
          title="No templates yet"
          description="Open any event and choose “Save as template” from its more menu to reuse it later."
          action={{ label: 'New event', icon: Icons.plus, kbd: 'N', onClick: () => openEventEditor(null) }}
        />
      )}

      {templates !== null && templates.length > 0 && (
        <ul className={styles.list} aria-label="Event templates">
          {templates.map(t => {
            const tl = timelines.find(c => c.id === t.calendar_id);
            const recur = describeRecurrence(t);
            return (
              <li key={t.id} className={styles.item}>
                <div className={styles.itemMain}>
                  <div className={styles.itemName}>
                    {tl && <TLDot color={tl.color} size={8} />}
                    <span className={styles.name}>{t.name}</span>
                  </div>
                  <div className={styles.itemMeta}>
                    <span className={styles.title}>{t.title}</span>
                    <Badge size="sm" icon={Icons.clock}>{describeDuration(t.duration_minutes || 60)}</Badge>
                    {recur && <Badge size="sm" icon={Icons.repeat}>{recur}</Badge>}
                    {tl && <Badge size="sm" color={tl.color} outline>{tl.name}</Badge>}
                  </div>
                </div>
                <div className={styles.itemActions}>
                  <Button size="sm" variant="secondary" icon={Icons.plus} onClick={() => apply(t)}>Apply</Button>
                  <IconButton icon={Icons.trash} label={`Delete template ${t.name}`} size="sm" disabled={busyId === t.id} onClick={() => { void remove(t); }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ModalFooter>
        <Button variant="ghost" onClick={close}>Close</Button>
      </ModalFooter>
    </ModalShell>
  );
}
