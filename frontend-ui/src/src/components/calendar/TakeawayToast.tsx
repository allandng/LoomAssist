import { useEffect, useRef, useState } from 'react';
import styles from './TakeawayToast.module.css';
import { Button, IconButton, Icons, Textarea } from '../ui';
import { createJournalText } from '../../api';
import { useNotifications } from '../../store/notifications';
import { markPrompted, muteEvent } from '../../lib/takeawayDismissals';
import { isMac } from '../../lib/platform';
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
      void handleSave();
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
        <IconButton size="sm" icon={Icons.x} label="Dismiss takeaway prompt" onClick={() => close('skip')} />
      </div>
      <Textarea
        ref={textareaRef}
        rows={2}
        maxLength={MAX_CHARS}
        placeholder="What stuck with you?"
        aria-label="Takeaway"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
      />
      <div className={styles.counter} aria-live="polite">
        {text.length}/{MAX_CHARS}
      </div>
      <div className={styles.actions}>
        <Button
          size="sm"
          variant="subtle"
          className={styles.muteBtn}
          onClick={() => close('mute')}
          title="Never prompt for this event again"
        >
          Don't show again
        </Button>
        <Button size="sm" variant="ghost" onClick={() => close('skip')}>Skip</Button>
        <Button
          size="sm"
          variant="primary"
          kbd={isMac ? '⌘↵' : 'Ctrl+↵'}
          loading={saving}
          disabled={text.trim().length === 0}
          onClick={() => void handleSave()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
