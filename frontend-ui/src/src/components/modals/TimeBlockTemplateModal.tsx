import { useState, useCallback } from 'react';
import { ModalShell, ModalFooter, FieldLabel } from './ModalShell';
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
      addNotification({ type: 'error', title: 'Save failed', message: 'Could not save template.', autoRemoveMs: 4000 });
    } finally {
      setSaving(false);
    }
  }, [name, description, blocks, onSaved, close, addNotification]);

  const canSave = name.trim().length > 0 && blocks.every(b => b.title.trim().length > 0);

  return (
    <ModalShell title="Save Time Block Template" width={620} onClose={close}>
      <div className={styles.body}>
        <FieldLabel>Template Name</FieldLabel>
        <input
          className="loom-field"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Deep Work Week"
          autoFocus
        />

        <FieldLabel>Description (optional)</FieldLabel>
        <input
          className="loom-field"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What is this routine for?"
        />

        <div className={styles.blocksHeader}>
          <span className={styles.blocksTitle}>Blocks</span>
          <button className="loom-btn-ghost" onClick={addBlock}>+ Add Block</button>
        </div>

        <div className={styles.blockList}>
          {blocks.length === 0 && (
            <p className={styles.emptyMsg}>No blocks yet — click "+ Add Block" to start.</p>
          )}
          {blocks.map((b, idx) => (
            <div key={idx} className={styles.blockRow}>
              <input
                className={`loom-field ${styles.blockTitle}`}
                value={b.title}
                onChange={e => updateBlock(idx, { title: e.target.value })}
                placeholder="Block title"
              />
              <select
                className={`loom-field ${styles.blockDay}`}
                value={b.day_of_week}
                onChange={e => updateBlock(idx, { day_of_week: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5, 6, 7].map(d => (
                  <option key={d} value={d}>{DAY_LABELS[d]}</option>
                ))}
              </select>
              <input
                type="time"
                className={`loom-field ${styles.blockTime}`}
                value={b.start_time}
                onChange={e => updateBlock(idx, { start_time: e.target.value })}
              />
              <span className={styles.timeSep}>–</span>
              <input
                type="time"
                className={`loom-field ${styles.blockTime}`}
                value={b.end_time}
                onChange={e => updateBlock(idx, { end_time: e.target.value })}
              />
              <select
                className={`loom-field ${styles.blockCal}`}
                value={b.calendar_id}
                onChange={e => updateBlock(idx, { calendar_id: Number(e.target.value) })}
              >
                {timelines.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                className={styles.removeBtn}
                onClick={() => removeBlock(idx)}
                aria-label="Remove block"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <ModalFooter>
        <button className="loom-btn-ghost" onClick={close}>Cancel</button>
        <div style={{ flex: 1 }} />
        <button
          className="loom-btn-primary"
          onClick={handleSave}
          disabled={saving || !canSave}
        >
          {saving ? 'Saving…' : 'Save Template'}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}
