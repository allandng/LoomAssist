import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './JumpToDate.module.css';
import { parseDateTime } from '../../api';
import { pushEscapeHandler } from '../../lib/escapeStack';

interface JumpToDateProps {
  onPick: (d: Date) => void;
  onClose: () => void;
}

/**
 * WS4 #9 — "Jump to date". Accepts natural language: tries the native Date
 * parser first, falls back to the backend /parse/datetime endpoint (same
 * strategy the event editor uses). On success it hands the date up so the
 * calendar can navigate while preserving the current view.
 */
export function JumpToDate({ onPick, onClose }: JumpToDateProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const pop = pushEscapeHandler(() => onClose());
    requestAnimationFrame(() => inputRef.current?.focus());
    return pop;
  }, [onClose]);

  const submit = async () => {
    const raw = text.trim();
    if (!raw || busy) return;
    setError(false);
    // Native parse first (handles ISO dates, "July 4 2026", etc.)
    const native = new Date(raw);
    if (!isNaN(native.getTime())) { onPick(native); return; }
    // Fall back to the LLM datetime parser.
    setBusy(true);
    try {
      const { iso } = await parseDateTime(raw);
      const d = new Date(iso);
      if (isNaN(d.getTime())) { setError(true); return; }
      onPick(d);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.popover}
        role="dialog"
        aria-modal="true"
        aria-label="Jump to date"
        onClick={e => e.stopPropagation()}
      >
        <label className={styles.label} htmlFor="loom-jump-input">Jump to date</label>
        <input
          id="loom-jump-input"
          ref={inputRef}
          className={styles.input}
          value={text}
          placeholder="e.g. next Monday, Aug 12, 2026-09-01"
          onChange={e => { setText(e.target.value); setError(false); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
        />
        {error && <span className={styles.error}>Couldn’t understand that date.</span>}
        {busy && <span className={styles.hint}>Parsing…</span>}
      </div>
    </div>,
    document.body,
  );
}
