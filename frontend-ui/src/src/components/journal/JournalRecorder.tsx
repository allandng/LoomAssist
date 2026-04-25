import { useState, useRef, useCallback, useEffect } from 'react';
import { createJournalEntry } from '../../api';
import type { JournalEntry } from '../../types';

interface Props {
  onSaved: (entry: JournalEntry) => void;
  saveAudio?: boolean;
}

const MAX_SECONDS = 60;

export function JournalRecorder({ onSaved, saveAudio = false }: Props) {
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [mood, setMood] = useState<'great' | 'ok' | 'rough' | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
  }, []);

  const submit = useCallback(async (blob: Blob) => {
    setSaving(true);
    setError('');
    try {
      const entry = await createJournalEntry(blob, undefined, mood || null, saveAudio);
      onSaved(entry);
    } catch {
      setError('Transcription failed. Is the backend running?');
    } finally {
      setSaving(false);
    }
  }, [mood, saveAudio, onSaved]);

  async function handleRecord() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        setRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
        setSecondsLeft(MAX_SECONDS);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        submit(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setSecondsLeft(MAX_SECONDS);

      timerRef.current = setInterval(() => {
        setSecondsLeft(prev => {
          if (prev <= 1) { recorder.stop(); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch {
      setError('Microphone unavailable. Check browser permissions.');
    }
  }

  const progress = recording ? ((MAX_SECONDS - secondsLeft) / MAX_SECONDS) * 100 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 20 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
        {recording ? `Recording… ${secondsLeft}s remaining` : 'Click to record a 60-second reflection'}
      </div>

      {/* Progress ring */}
      <div style={{ position: 'relative', width: 100, height: 100 }}>
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="var(--border)" strokeWidth="6" />
          <circle
            cx="50" cy="50" r="42" fill="none"
            stroke={recording ? 'var(--error)' : 'var(--accent)'}
            strokeWidth="6"
            strokeDasharray={`${2 * Math.PI * 42}`}
            strokeDashoffset={`${2 * Math.PI * 42 * (1 - progress / 100)}`}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </svg>
        <button
          onClick={handleRecord}
          disabled={saving}
          style={{
            position: 'absolute', inset: 0, margin: 'auto',
            width: 60, height: 60, borderRadius: '50%',
            background: recording ? 'var(--error)' : 'var(--accent)',
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22,
          }}
          aria-label={recording ? 'Stop recording' : 'Start recording'}
        >
          {recording ? '■' : '🎙'}
        </button>
      </div>

      {/* Mood selector */}
      {!recording && (
        <div style={{ display: 'flex', gap: 8 }}>
          {(['great', 'ok', 'rough'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMood(mood === m ? '' : m)}
              style={{
                padding: '4px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
                background: mood === m ? 'var(--accent)' : 'var(--bg-elevated)',
                color: mood === m ? '#fff' : 'var(--text-muted)',
                border: `1px solid ${mood === m ? 'var(--accent)' : 'var(--border)'}`,
              }}
            >
              {m === 'great' ? '😊' : m === 'ok' ? '😐' : '😔'} {m}
            </button>
          ))}
        </div>
      )}

      {saving && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Transcribing…</div>}
      {error  && <div style={{ fontSize: 12, color: 'var(--error)' }}>{error}</div>}
    </div>
  );
}
