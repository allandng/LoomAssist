import { useEffect, useState } from 'react';
import styles from './TaskTemplatesPanel.module.css';
import {
  listTaskTemplates, createTaskTemplate, deleteTaskTemplate,
  createEvent, createTask,
} from '../../api';
import type { TaskTemplate, Calendar } from '../../types';
import { useNotifications } from '../../store/notifications';
import { Section, IconButton, Button, Input, Select, Badge, Skeleton, Icon, Icons, confirm } from '../ui';
import { PRIORITY_LABEL, PRIORITY_TONE, type Priority } from './taskUtils';

interface TaskTemplatesPanelProps {
  timelines: Calendar[];
  /** Called after a task was created from a template so the board can refresh. */
  onCreated?: () => void;
}

const SCAFFOLD_DELAY_MS = 60 * 60 * 1000;
const SCAFFOLD_LENGTH_MS = 30 * 60 * 1000;

export function TaskTemplatesPanel({ timelines, onCreated }: TaskTemplatesPanelProps) {
  const { addNotification } = useNotifications();
  const [tpls, setTpls]         = useState<TaskTemplate[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const [reloadKey, setReload]  = useState(0);
  const [adding, setAdding]     = useState(false);
  const [saving, setSaving]     = useState(false);
  const [name, setName]         = useState('');
  const [title, setTitle]       = useState('');
  const [priority, setPriority] = useState<Priority>('low');

  useEffect(() => {
    let alive = true;
    listTaskTemplates()
      .then(list => { if (alive) { setTpls(list); setError(false); setLoading(false); } })
      .catch(() => { if (alive) { setError(true); setLoading(false); } });
    return () => { alive = false; };
  }, [reloadKey]);

  const reload = () => setReload(k => k + 1);

  function resetForm() {
    setName('');
    setTitle('');
    setPriority('low');
    setAdding(false);
  }

  async function handleAdd() {
    if (!name.trim() || !title.trim()) return;
    setSaving(true);
    try {
      await createTaskTemplate({
        name: name.trim(),
        title: title.trim(),
        description: null,
        default_priority: priority,
        recurrence_days: null,
        calendar_id: timelines[0]?.id ?? null,
      });
      resetForm();
      reload();
    } catch {
      addNotification({ type: 'error', title: 'Could not save template' });
    } finally {
      setSaving(false);
    }
  }

  async function handleInstantiate(tpl: TaskTemplate) {
    // A task needs a backing event; scaffold a short one starting in an hour.
    const calId = tpl.calendar_id ?? timelines[0]?.id;
    if (!calId) {
      addNotification({ type: 'warning', title: 'No timeline available', message: 'Create a timeline first.' });
      return;
    }
    try {
      const start = new Date();
      start.setTime(start.getTime() + SCAFFOLD_DELAY_MS);
      const end = new Date(start.getTime() + SCAFFOLD_LENGTH_MS);
      const { event } = await createEvent({
        title: tpl.title,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        calendar_id: calId,
        is_recurring: false,
        recurrence_days: '',
        recurrence_end: '',
        description: tpl.description ?? '',
        unique_description: '',
        reminder_minutes: 0,
        external_uid: '',
        timezone: 'local',
        is_all_day: false,
        skipped_dates: '',
        per_day_times: '',
        checklist: '',
      });
      await createTask({
        event_id: event.id,
        is_complete: false,
        note: tpl.title,
        status: 'backlog',
        priority: tpl.default_priority,
        due_date: '',
      });
      addNotification({ type: 'success', title: 'Task created', message: tpl.title, autoRemoveMs: 2500 });
      onCreated?.();
    } catch {
      addNotification({ type: 'error', title: 'Could not create task' });
    }
  }

  async function handleDelete(tpl: TaskTemplate) {
    const ok = await confirm({
      title: `Delete template "${tpl.name}"?`,
      description: 'Tasks already created from it are not affected.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try { await deleteTaskTemplate(tpl.id); reload(); }
    catch { addNotification({ type: 'error', title: 'Could not delete template' }); }
  }

  return (
    <Section
      small
      title="Task templates"
      actions={
        <IconButton
          size="sm"
          icon={adding ? Icons.x : Icons.plus}
          label={adding ? 'Cancel new template' : 'New template'}
          onClick={() => (adding ? resetForm() : setAdding(true))}
        />
      }
    >
      {adding && (
        <form className={styles.form} onSubmit={e => { e.preventDefault(); void handleAdd(); }}>
          <Input
            size="sm"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Template name, e.g. Daily journal"
            aria-label="Template name"
            autoFocus
          />
          <Input
            size="sm"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Task title"
            aria-label="Task title"
          />
          <Select size="sm" value={priority} onChange={e => setPriority(e.target.value as Priority)} aria-label="Default priority">
            <option value="low">Low priority</option>
            <option value="med">Medium priority</option>
            <option value="high">High priority</option>
          </Select>
          <div className={styles.formActions}>
            <Button size="sm" variant="ghost" type="button" onClick={resetForm}>Cancel</Button>
            <Button size="sm" variant="secondary" type="submit" loading={saving} disabled={!name.trim() || !title.trim()}>Save</Button>
          </div>
        </form>
      )}

      {error ? (
        <div className={styles.errorRow} role="alert">
          <Badge tone="error" icon={Icons.alertCircle}>Couldn't load templates</Badge>
        </div>
      ) : loading ? (
        <div className={styles.skeleton} aria-hidden="true">
          <Skeleton height={26} />
          <Skeleton height={26} />
        </div>
      ) : tpls.length === 0 ? (
        !adding && <p className={styles.hint}>Save a template to create recurring chores in one click.</p>
      ) : (
        <ul className={styles.list}>
          {tpls.map(tpl => (
            <li key={tpl.id} className={styles.item}>
              <button
                type="button"
                className={styles.use}
                onClick={() => handleInstantiate(tpl)}
                title={`Create task: ${tpl.title}`}
              >
                <Icon d={Icons.plus} size={12} />
                <span className={styles.useName}>{tpl.name}</span>
                <Badge size="sm" tone={PRIORITY_TONE[tpl.default_priority]}>{PRIORITY_LABEL[tpl.default_priority]}</Badge>
              </button>
              <IconButton size="sm" icon={Icons.trash} label={`Delete template ${tpl.name}`} onClick={() => handleDelete(tpl)} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
