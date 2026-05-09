import { useEffect, useState } from 'react';
import {
  listTaskTemplates, createTaskTemplate, deleteTaskTemplate,
  createEvent, createTask,
} from '../../api';
import type { TaskTemplate, Calendar } from '../../types';
import { useNotifications } from '../../store/notifications';

interface TaskTemplatesPanelProps {
  timelines: Calendar[];
}

export function TaskTemplatesPanel({ timelines }: TaskTemplatesPanelProps) {
  const { addNotification } = useNotifications();
  const [tpls, setTpls]       = useState<TaskTemplate[]>([]);
  const [adding, setAdding]   = useState(false);
  const [name, setName]       = useState('');
  const [title, setTitle]     = useState('');
  const [priority, setPriority] = useState<'high' | 'med' | 'low'>('low');

  const load = () => listTaskTemplates().then(setTpls).catch(() => {});
  useEffect(() => { load(); }, []);

  async function handleAdd() {
    if (!name.trim() || !title.trim()) return;
    try {
      await createTaskTemplate({
        name: name.trim(),
        title: title.trim(),
        description: null,
        default_priority: priority,
        recurrence_days: null,
        calendar_id: timelines[0]?.id ?? null,
      });
      setName(''); setTitle(''); setAdding(false);
      load();
    } catch {
      addNotification({ type: 'error', title: 'Could not save template' });
    }
  }

  async function handleInstantiate(tpl: TaskTemplate) {
    // Create a today-dated event scaffold + a backing task using the template
    try {
      const now = new Date();
      const start = new Date(now.getTime() + 60 * 60 * 1000);
      const end   = new Date(start.getTime() + 30 * 60 * 1000);
      const calId = tpl.calendar_id ?? timelines[0]?.id;
      if (!calId) {
        addNotification({ type: 'warning', title: 'No timeline available' });
        return;
      }
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
      addNotification({ type: 'success', title: 'Task created from template', autoRemoveMs: 2500 });
    } catch {
      addNotification({ type: 'error', title: 'Could not create task' });
    }
  }

  async function handleDelete(tpl: TaskTemplate) {
    if (!window.confirm(`Delete template "${tpl.name}"?`)) return;
    try { await deleteTaskTemplate(tpl.id); load(); }
    catch { addNotification({ type: 'error', title: 'Could not delete template' }); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Task Templates
        </span>
        <button
          onClick={() => setAdding(a => !a)}
          style={{ width: 18, height: 18, border: 'none', background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 4, fontSize: 12 }}
          title="Add template"
        >+</button>
      </div>

      {adding && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 4px', background: 'var(--bg-elevated)', borderRadius: 6 }}>
          <input
            className="loom-field"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Template name (e.g. Daily journal)"
            style={{ fontSize: 12 }}
          />
          <input
            className="loom-field"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Task title"
            style={{ fontSize: 12 }}
          />
          <select
            className="loom-field"
            value={priority}
            onChange={e => setPriority(e.target.value as 'high' | 'med' | 'low')}
            style={{ fontSize: 12 }}
          >
            <option value="low">Low priority</option>
            <option value="med">Medium</option>
            <option value="high">High</option>
          </select>
          <button className="loom-btn-primary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={handleAdd}>Save</button>
        </div>
      )}

      {tpls.length === 0 && !adding && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '4px 4px' }}>No templates yet.</div>
      )}

      {tpls.map(tpl => (
        <div
          key={tpl.id}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px', borderRadius: 4 }}
        >
          <button
            onClick={() => handleInstantiate(tpl)}
            style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text-main)', fontSize: 12, cursor: 'pointer', padding: 0 }}
            title="Create a new task from this template"
          >
            {tpl.name}
          </button>
          <button
            onClick={() => handleDelete(tpl)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}
            aria-label={`Delete ${tpl.name}`}
          >×</button>
        </div>
      ))}
    </div>
  );
}
