import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { listEvents } from '../../api';
import type { Event } from '../../types';
import { Textarea } from '../ui';
import styles from './MentionTextarea.module.css';

interface MentionTextareaProps {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  rows?: number;
  id?: string;
  placeholder?: string;
}

/**
 * Textarea with `@` mentions of other events. Typing `@` opens a listbox
 * (role="listbox" / "option", aria-activedescendant) filtered by title;
 * Enter / Tab inserts `@[Title]`.
 */
export function MentionTextarea({ value, onChange, readOnly, rows = 3, id, placeholder }: MentionTextareaProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [allEvents, setAllEvents] = useState<Event[]>([]);
  const [query, setQuery] = useState<string | null>(null);   // non-null = listbox open
  const [atStart, setAtStart] = useState(0);                  // index of the '@' in value
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    listEvents().then(setAllEvents).catch(() => {});
  }, []);

  const matches = query !== null
    ? allEvents.filter(e => e.title.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : [];
  const open = query !== null && matches.length > 0;

  function detectMention(text: string, cursorPos: number) {
    // Walk back from cursor to find an '@' not preceded by word chars
    const before = text.slice(0, cursorPos);
    const match = before.match(/@([^@[\]\n]*)$/);
    if (match) {
      setQuery(match[1]);
      setAtStart(cursorPos - match[0].length);
      setActiveIdx(0);
    } else {
      setQuery(null);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newVal = e.target.value;
    onChange(newVal);
    detectMention(newVal, e.target.selectionStart ?? newVal.length);
  }

  const insertMention = useCallback((ev: Event) => {
    const ta = taRef.current;
    if (!ta) return;
    const cursorPos = ta.selectionStart ?? value.length;
    // Replace from '@' up to cursor with @[EventTitle]
    const newVal = value.slice(0, atStart) + `@[${ev.title}]` + value.slice(cursorPos);
    onChange(newVal);
    setQuery(null);
    // Move cursor after inserted mention
    const newCursor = atStart + ev.title.length + 3; // @[...] = 3 extra chars
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
    });
  }, [value, atStart, onChange]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(matches[activeIdx]);
    } else if (e.key === 'Escape') {
      // Consume so the surrounding modal's escape stack doesn't also fire.
      e.preventDefault();
      e.stopPropagation();
      setQuery(null);
    }
  }

  // Close the listbox on outside click
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!dropRef.current?.contains(e.target as Node) && e.target !== taRef.current) {
        setQuery(null);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div className={styles.wrap}>
      <Textarea
        ref={taRef}
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={e => {
          const ta = e.currentTarget;
          detectMention(ta.value, ta.selectionStart ?? ta.value.length);
        }}
        readOnly={readOnly}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(activeIdx) : undefined}
      />
      {open && (
        <div ref={dropRef} id={listId} role="listbox" aria-label="Mention an event" className={styles.listbox}>
          {matches.map((ev, i) => (
            <div
              key={ev.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIdx}
              className={[styles.option, i === activeIdx ? styles.optionActive : ''].join(' ')}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={e => { e.preventDefault(); insertMention(ev); }}
            >
              <span className={styles.optionTitle}>{ev.title}</span>
              <span className={styles.optionDate}>{ev.start_time.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
