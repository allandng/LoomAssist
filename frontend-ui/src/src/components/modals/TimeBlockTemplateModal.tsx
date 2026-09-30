import { useState, useCallback, useId } from 'react';
import { ModalShell, ModalFooter, ModalStack } from './ModalShell';
import { Button, IconButton, Field, Input, Select, EmptyState, Icons } from '../ui';
import { useModal } from '../../contexts/ModalContext';
import { useNotifications } from '../../store/notifications';
import { createTimeBlockTemplate } from '../../api';
import type { TimeBlockDef, Calendar } from '../../types';
import styles from './TimeBlockTemplateModal.module.css';

const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface TimeBlockTemplateModalProps {
  prefillBlocks: TimeBlockDef[];
  timelines: Calendar[];
  onSaved: () => void;
}

function emptyBlock(defaultCalendarId: number): TimeBlockDef {
  return { title: '', day_of_week: 1, start_time: '09:00', end_time: '10:00', calendar_id: defaultCalendarId };
}

export function TimeBlockTemplateModal({ prefillBlocks, timelines, onSaved }: TimeBlockTemplateModalProps) {
  const { close } = useModal();
  const { addNotification } = useNotifications();
  const ids = useId();
  const defaultCalId = timelines[0]?.id ?? 0;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [blocks, setBlocks] = useState<TimeBlockDef[]>(
    prefillBlocks.length > 0 ? prefillBlocks : [emptyBlock(defaultCalId)],
  );
  const [saving, setSaving] = useState(false);

  const addBlock = useCallback(() => {
    setBlocks(prev => [...prev, emptyBlock(defaultCalId)]);
  }, [defaultCalId]);

  const removeBlock = useCallback((idx: number) => {
    setBlocks(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const updateBlock = useCallback((idx: number, patch: Partial<TimeBlockDef>) => {
    setBlocks(prev => prev.map((b, i) => i === idx ? { ...b, ...patch } : b));
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createTimeBlockTemplate(name.trim(), description.trim(), blocks);
      onSaved();
      addNotification({ type: 'success', title: `Template "${name.trim()}" saved`, autoRemoveMs: 3000 });
      close();
    } catch {
      addNotification({ type: 'error', title: 'Save failed', message: 'Could not save the template.', autoRemoveMs: 4000 });
    } finally {
      setSaving(false);
    }
  }, [name, description, blocks, onSaved, close, addNotification]);

  const canSave = name.trim().length > 0 && blocks.length > 0 && blocks.every(b => b.title.trim().length > 0);
  const dirty = name.trim().length > 0 || description.trim().length > 0 || blocks.some(b => b.title.trim().length > 0);

  return (
    <ModalShell
      title="Save week as template"
      subtitle="Reusable set of weekly time blocks you can stamp onto any week"
      size="lg"
      onClose={close}
      confirmOnClose={dirty}
    >
      <ModalStack>
        <div className={styles.grid2}>
          <Field label="Template name" htmlFor={`${ids}-name`}>
            <Input id={`${ids}-name`} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Deep work week" data-autofocus />
          </Field>
          <Field label="Description" htmlFor={`${ids}-desc`}>
            <Input id={`${ids}-desc`} value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this routine for?" />
          </Field>
        </div>

        <div className={styles.blocksHead}>
          <span className={styles.blocksTitle}>Blocks <span className={styles.count}>{blocks.length}</span></span>
          <Button variant="secondary" size="sm" icon={Icons.plus} onClick={addBlock}>Add block</Button>
        </div>

        {blocks.length === 0 ? (
          <EmptyState
            compact
            icon={Icons.columns}
            title="No blocks yet"
            description="Add at least one weekly block to save this template."
            action={{ label: 'Add block', icon: Icons.plus, onClick: addBlock }}
          />
        ) : (
          <div className={styles.blockList}>
            <div className={styles.blockHeader} aria-hidden="true">
              <span>Title</span><span>Day</span><span>From</span><span>To</span><span>Timeline</span><span />
            </div>
            {blocks.map((b, idx) => (
              <div key={idx} className={styles.blockRow}>
                <Input size="sm" value={b.title} onChange={e => updateBlock(idx, { title: e.target.value })} placeholder="Block title" aria-label={`Block ${idx + 1} title`} invalid={b.title.trim().length === 0 && name.trim().length > 0} />
                <Select size="sm" value={b.day_of_week} onChange={e => updateBlock(idx, { day_of_week: Number(e.target.value) })} aria-label={`Block ${idx + 1} day`}>
                  {[1, 2, 3, 4, 5, 6, 7].map(d => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
                </Select>
                <Input size="sm" type="time" value={b.start_time} onChange={e => updateBlock(idx, { start_time: e.target.value })} aria-label={`Block ${idx + 1} start`} />
                <Input size="sm" type="time" value={b.end_time} onChange={e => updateBlock(idx, { end_time: e.target.value })} aria-label={`Block ${idx + 1} end`} invalid={b.end_time <= b.start_time} />
                <Select size="sm" value={b.calendar_id} onChange={e => updateBlock(idx, { calendar_id: Number(e.target.value) })} aria-label={`Block ${idx + 1} timeline`}>
                  {timelines.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
                <IconButton icon={Icons.x} label={`Remove block ${idx + 1}`} size="sm" onClick={() => removeBlock(idx)} />
              </div>
            ))}
          </div>
        )}
      </ModalStack>

      <ModalFooter>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" icon={Icons.bookmark} onClick={() => { void handleSave(); }} disabled={!canSave} loading={saving}>
          Save template
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}
