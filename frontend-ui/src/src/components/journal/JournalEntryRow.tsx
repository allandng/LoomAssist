import { useState } from 'react';
import styles from './journal.module.css';
import { Badge, Button, IconButton, Icons } from '../ui';
import type { JournalEntry } from '../../types';
import { journalAudioUrl } from '../../api';
import { moodMeta } from './moods';
import { relativeTime } from '../inbox/timeFormat';

interface Props {
  entry: JournalEntry;
  /** Title of the linked event, when `entry.event_id` resolves. */
  eventTitle?: string | null;
  onDelete: (entry: JournalEntry) => void;
  deleting?: boolean;
}

/** One journal entry: mood, transcript, linked event, time, delete. */
export function JournalEntryRow({ entry, eventTitle, onDelete, deleting }: Props) {
  const mood = moodMeta(entry.mood);
  const [showAudio, setShowAudio] = useState(false);
  const [audioError, setAudioError] = useState(false);
  return (
    <li className={styles.entry}>
      <div className={styles.entryMain}>
        <div className={styles.entryMeta}>
          {mood ? (
            <Badge tone={mood.tone} icon={mood.icon} size="sm">{mood.label}</Badge>
          ) : (
            <Badge tone="neutral" size="sm" outline>No mood</Badge>
          )}
          {eventTitle && (
            <Badge tone="info" size="sm" icon={Icons.calendar} title="Linked event">{eventTitle}</Badge>
          )}
          {entry.audio_path && !showAudio && (
            <Button size="sm" variant="subtle" icon={Icons.play} onClick={() => setShowAudio(true)} aria-expanded={false}>
              Play audio
            </Button>
          )}
          <time className={styles.entryTime} dateTime={entry.created_at} title={new Date(entry.created_at).toLocaleString()}>
            {relativeTime(entry.created_at)}
          </time>
        </div>
        <p className={styles.entryText}>
          {entry.transcript || <span className={styles.entryEmpty}>No transcript</span>}
        </p>
        {entry.audio_path && showAudio && (
          audioError ? (
            <Badge tone="warning" size="sm" icon={Icons.warning}>Audio file is missing</Badge>
          ) : (
            <audio
              className={styles.audio}
              controls
              autoPlay
              preload="metadata"
              src={journalAudioUrl(entry.id)}
              aria-label="Journal recording"
              onError={() => setAudioError(true)}
            />
          )
        )}
      </div>
      <IconButton size="sm" icon={Icons.trash} label="Delete entry" disabled={deleting} onClick={() => onDelete(entry)} />
    </li>
  );
}
