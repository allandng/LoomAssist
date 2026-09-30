import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './JumpToDate.module.css';
import { Icon, Icons } from '../shared/Icon';
import { Kbd } from '../shared/Kbd';
import { Button, IconButton } from '../ui';
import { parseDateTime } from '../../api';
import { pushEscapeHandler } from '../../lib/escapeStack';

interface JumpToDateProps {
  onPick: (d: Date) => void;
  onClose: () => void;
  /** Month to open on (defaults to today). */
  initialDate?: Date;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Build a 6×7 grid of dates around the given month (Monday-first). */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(year, month, 1 - lead);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/**
 * "Jump to date" (G). A small month grid plus a date field that also accepts
 * natural language ("next Monday", "Aug 12") — native parse first, backend
 * /parse/datetime as the fallback. Hands the date up so the calendar can
 * navigate while preserving its current view.
 */
export function JumpToDate({ onPick, onClose, initialDate }: JumpToDateProps) {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => {
    const d = initialDate ?? today;
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<Date>(initialDate ?? today);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const pop = pushEscapeHandler(() => onClose());
    requestAnimationFrame(() => inputRef.current?.focus());
    return pop;
  }, [onClose]);

  const days = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const monthLabel = cursor.toLocaleDateString([], { month: 'long', year: 'numeric' });

  const shiftMonth = (delta: number) => setCursor(c => new Date(c.getFullYear(), c.getMonth() + delta, 1));

  const submitText = async () => {
    const raw = text.trim();
    if (busy) return;
    if (!raw) { onPick(selected); return; }
    setError(null);
    // ISO date → local midnight (avoid the UTC shift of `new Date('YYYY-MM-DD')`).
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) { onPick(new Date(+iso[1], +iso[2] - 1, +iso[3])); return; }
    const native = new Date(raw);
    if (!isNaN(native.getTime())) { onPick(native); return; }
    setBusy(true);
    try {
      const { iso: parsed } = await parseDateTime(raw);
      const d = new Date(parsed);
      if (isNaN(d.getTime())) { setError('Couldn’t understand that date.'); return; }
      onPick(d);
    } catch {
      setError('Couldn’t understand that date.');
    } finally {
      setBusy(false);
    }
  };

  // Arrow-key navigation inside the grid.
  function onGridKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? 7 : e.key === 'ArrowUp' ? -7 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() + delta);
    setSelected(next);
    if (next.getMonth() !== cursor.getMonth() || next.getFullYear() !== cursor.getFullYear()) {
      setCursor(new Date(next.getFullYear(), next.getMonth(), 1));
    }
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus());
  }

  return createPortal(
    <div className={styles.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="loom-jump-title">
        <div className={styles.header}>
          <h2 id="loom-jump-title" className={styles.title}>Jump to date</h2>
          <IconButton icon={Icons.x} label="Close" size="sm" onClick={onClose} />
        </div>

        <div className={styles.field}>
          <Icon d={Icons.search} size={14} className={styles.fieldIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            value={text}
            placeholder="Type a date — “next Monday”, “Aug 12”, 2026-09-01"
            onChange={e => { setText(e.target.value); setError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submitText(); } }}
            aria-label="Date"
            aria-invalid={!!error || undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <Kbd small>↵</Kbd>
        </div>
        {error && <div className={styles.error} role="alert">{error}</div>}
        {busy && <div className={styles.hint}>Parsing…</div>}

        <div className={styles.monthRow}>
          <IconButton icon={Icons.chevronLeft} label="Previous month" size="sm" onClick={() => shiftMonth(-1)} />
          <button type="button" className={styles.monthLabel} onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))} title="Back to this month">
            {monthLabel}
          </button>
          <IconButton icon={Icons.chevronRight} label="Next month" size="sm" onClick={() => shiftMonth(1)} />
        </div>

        <div className={styles.weekdays} aria-hidden="true">
          {WEEKDAYS.map(d => <span key={d} className={styles.weekday}>{d}</span>)}
        </div>
        <div ref={gridRef} className={styles.grid} role="grid" aria-label={monthLabel} onKeyDown={onGridKey}>
          {days.map(d => {
            const outside = d.getMonth() !== cursor.getMonth();
            const isToday = sameDay(d, today);
            const isSel = sameDay(d, selected);
            return (
              <button
                key={d.toISOString()}
                type="button"
                role="gridcell"
                aria-selected={isSel}
                aria-label={d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                tabIndex={isSel ? 0 : -1}
                className={[styles.day, outside ? styles.dayOutside : '', isToday ? styles.dayToday : '', isSel ? styles.daySelected : ''].join(' ')}
                onClick={() => { setSelected(d); onPick(d); }}
                onFocus={() => setSelected(d)}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>

        <div className={styles.footer}>
          <input
            type="date"
            className={styles.dateInput}
            value={toInputValue(selected)}
            onChange={e => {
              const m = e.target.value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
              if (!m) return;
              const d = new Date(+m[1], +m[2] - 1, +m[3]);
              setSelected(d);
              setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
            }}
            aria-label="Pick a date"
          />
          <div className={styles.footerActions}>
            <Button variant="ghost" size="sm" onClick={() => onPick(today)}>Today</Button>
            <Button variant="primary" size="sm" onClick={() => onPick(selected)}>Go</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
