import { useEffect, useRef, useState } from 'react';
import styles from './TakeawayToast.module.css';
import { Icon, Icons } from '../shared/Icon';
import { createJournalText } from '../../api';
import { useNotifications } from '../../store/notifications';
import { markPrompted, muteEvent } from '../../lib/takeawayDismissals';
import type { Event } from '../../types';

const MAX_CHARS = 280;
const AUTO_DISMISS_MS = 90_000;

interface TakeawayToastProps {
  event: Event;
  occurrenceDate: string;
  onClose: () => void;
}

export function TakeawayToast({ event, occurrenceDate, onClose }: TakeawayToastProps) {
  const { addNotification } = useNotifications();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const id = setTimeout(() => {
      markPrompted(event.id, occurrenceDate);
      onClose();
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [event.id, occurrenceDate, onClose]);

  const close = (action: 'skip' | 'mute' | 'saved') => {
    if (action === 'mute') muteEvent(event.id);
    markPrompted(event.id, occurrenceDate);
    onClose();
  };

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await createJournalText(trimmed, { event_id: event.id, date: occurrenceDate });
      addNotification({
        type: 'success',
        title: 'Takeaway saved',
        message: event.title,
      });
      close('saved');
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Failed to save takeaway',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      setSaving(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close('skip');
    }
  };

  return (
    <div className={styles.toast} role="dialog" aria-label="Lecture takeaway prompt">
      <div className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.title}>{event.title} just ended</div>
          <div className={styles.prompt}>Two-line takeaway?</div>
        </div>
        <button
          className={styles.dismiss}
          onClick={() => close('skip')}
          aria-label="Dismiss takeaway prompt"
        >
          <Icon d={Icons.x} size={12} />
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        rows={2}
        maxLength={MAX_CHARS}
        placeholder="What stuck with you?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
      />
      <div className={styles.counter}>
        {text.length}/{MAX_CHARS}
      </div>
      <div className={styles.actions}>
        <button
          className={styles.muteBtn}
          onClick={() => close('mute')}
          title="Never prompt for this event again"
        >
          Don't show again
        </button>
        <button className={styles.skipBtn} onClick={() => close('skip')}>
          Skip
        </button>
        <button
          className={styles.saveBtn}
          onClick={handleSave}
          disabled={saving || text.trim().length === 0}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
