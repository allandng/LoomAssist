import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './journal.module.css';
import { Badge, Button, Card, CardBody, CardFooter, CardHeader, Field, Icon, Icons, ProgressRing, Spinner, Textarea } from '../ui';
import { createJournalEntry, createJournalText } from '../../api';
import type { JournalEntry } from '../../types';
import { MoodPicker } from './MoodPicker';
import type { Mood } from './moods';

interface Props {
  onSaved: (entry: JournalEntry) => void;
  /** Called when the user discards the entry they just recorded. Return true once it is gone. */
  onDiscard: (entry: JournalEntry) => Promise<boolean>;
  saveAudio?: boolean;
}

export const RECORD_BUTTON_ID = 'journal-record-button';
const MAX_SECONDS = 60;

type Phase = 'idle' | 'recording' | 'transcribing' | 'preview';

/**
 * Voice + text capture. Recording stops at 60 s (or on tap), the backend
 * transcribes and stores the entry in one call, and the transcript is shown
 * as a preview with a Discard escape hatch. Typing is always available.
 */
export function JournalRecorder({ onSaved, onDiscard, saveAudio = false }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [mood, setMood] = useState<Mood | null>(null);
  const [preview, setPreview] = useState<JournalEntry | null>(null);
  const [text, setText] = useState('');
  const [savingText, setSavingText] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timerRef.current) window.clearInterval(timerRef.current);
      const r = recorderRef.current;
      if (r && r.state !== 'inactive') {
        r.onstop = null;
        r.stop();
        r.stream.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const submitAudio = useCallback(async (blob: Blob) => {
    setPhase('transcribing');
    setError(null);
    try {
      const entry = await createJournalEntry(blob, undefined, mood, saveAudio);
      if (!alive.current) return;
      setPreview(entry);
      setPhase('preview');
      onSaved(entry);
    } catch {
      if (!alive.current) return;
      setError('Transcription failed. Is the backend running?');
      setPhase('idle');
    }
  }, [mood, saveAudio, onSaved]);

  async function toggleRecording() {
    if (phase === 'recording') {
      recorderRef.current?.stop();
      return;
    }
    if (phase !== 'idle' && phase !== 'preview') return;
    setError(null);
    setPreview(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        if (!alive.current) return;
        setSecondsLeft(MAX_SECONDS);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size === 0) { setPhase('idle'); setError('Nothing was recorded.'); return; }
        submitAudio(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setPhase('recording');
      setSecondsLeft(MAX_SECONDS);
      timerRef.current = window.setInterval(() => {
        setSecondsLeft(prev => {
          if (prev <= 1) { recorder.stop(); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch {
      setError('Microphone unavailable. Check the app’s microphone permission.');
    }
  }

  async function saveText() {
    const value = text.trim();
    if (!value || savingText) return;
    setSavingText(true);
    setError(null);
    try {
      const entry = await createJournalText(value, { mood });
      if (!alive.current) return;
      setText('');
      setPreview(null);
      setPhase('idle');
      onSaved(entry);
    } catch {
      if (alive.current) setError('Could not save the entry. Is the backend running?');
    } finally {
      if (alive.current) setSavingText(false);
    }
  }

  async function discardPreview() {
    if (!preview) return;
    setDiscarding(true);
    try {
      const gone = await onDiscard(preview);
      if (gone && alive.current) { setPreview(null); setPhase('idle'); }
    } finally {
      if (alive.current) setDiscarding(false);
    }
  }

  const recording = phase === 'recording';
  const transcribing = phase === 'transcribing';
  const elapsed = recording ? (MAX_SECONDS - secondsLeft) / MAX_SECONDS : 0;
  const status = recording
    ? `Recording · ${secondsLeft}s left`
    : transcribing
      ? 'Transcribing on this device'
      : 'Record up to 60 seconds';

  return (
    <Card as="section" aria-label="New reflection">
      <CardHeader
        title="New reflection"
        description="Pick a mood, then talk it through or write it down."
      />
      <CardBody className={styles.recorderBody}>
        <MoodPicker value={mood} onChange={setMood} disabled={recording || transcribing} />

        <div className={styles.recordRow}>
          <ProgressRing
            value={elapsed}
            size={104}
            stroke={6}
            color={recording ? 'var(--error)' : 'var(--accent)'}
            aria-label="Recording progress"
          >
            <button
              id={RECORD_BUTTON_ID}
              type="button"
              className={[styles.recordBtn, recording ? styles.recordBtnActive : ''].join(' ')}
              onClick={toggleRecording}
              disabled={transcribing || savingText}
              aria-label={recording ? 'Stop recording' : 'Start recording'}
              aria-pressed={recording}
            >
              {transcribing ? <Spinner size={22} /> : <Icon d={recording ? Icons.stop : Icons.mic} size={24} fill={recording ? 'currentColor' : 'none'} />}
            </button>
          </ProgressRing>
          <div className={styles.recordText}>
            <div className={styles.recordStatus} aria-live="polite">{status}</div>
            <div className={styles.recordHint}>
              {recording ? 'Tap the button again to stop early.' : saveAudio ? 'The audio file is kept with the transcript.' : 'Only the transcript is kept; audio is discarded.'}
            </div>
          </div>
        </div>

        {phase === 'preview' && preview && (
          <div className={styles.preview} role="status">
            <div className={styles.previewHead}>
              <Badge tone="success" icon={Icons.checkCircle}>Saved</Badge>
              {preview.audio_path && <Badge tone="neutral" icon={Icons.mic}>Audio saved</Badge>}
            </div>
            <p className={styles.previewText}>
              {preview.transcript || <span className={styles.previewEmpty}>No speech was detected.</span>}
            </p>
            <div className={styles.previewActions}>
              <Button size="sm" variant="subtle" onClick={() => { setPreview(null); setPhase('idle'); }}>Done</Button>
              <Button size="sm" variant="danger" icon={Icons.trash} loading={discarding} onClick={discardPreview}>Discard</Button>
            </div>
          </div>
        )}

        <Field label="Or write it down" htmlFor="journal-text">
          <Textarea
            id="journal-text"
            rows={3}
            maxLength={600}
            placeholder="What went well? What got in the way?"
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={recording || transcribing}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveText(); } }}
          />
        </Field>

        {error && (
          <div className={styles.errorRow} role="alert">
            <Badge tone="error" dot>{error}</Badge>
          </div>
        )}
      </CardBody>
      <CardFooter className={styles.recorderFooter}>
        <span className={styles.footerHint}>{text.length}/600</span>
        <Button variant="primary" icon={Icons.check} loading={savingText} disabled={!text.trim() || recording || transcribing} onClick={saveText}>
          Save entry
        </Button>
      </CardFooter>
    </Card>
  );
}
