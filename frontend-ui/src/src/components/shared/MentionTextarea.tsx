import { useState, useRef, useEffect, useCallback } from 'react';
import { listEvents } from '../../api';
import type { Event } from '../../types';

interface MentionTextareaProps {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  rows?: number;
}

export function MentionTextarea({ value, onChange, readOnly, rows = 3 }: MentionTextareaProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [allEvents, setAllEvents] = useState<Event[]>([]);
  const [query, setQuery] = useState<string | null>(null);   // non-null = dropdown open
  const [atStart, setAtStart] = useState(0);                  // index of the '@' in value
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    listEvents().then(setAllEvents).catch(() => {});
  }, []);

  const matches = query !== null
    ? allEvents.filter(e => e.title.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : [];

  function detectMention(text: string, cursorPos: number) {
    // Walk back from cursor to find an '@' not preceded by word chars
    const before = text.slice(0, cursorPos);
    const match = before.match(/@([^@\[\]\n]*)$/);
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (query === null || matches.length === 0) return;
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
      setQuery(null);
    }
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

  // Close dropdown on outside click
  useEffect(() => {
    if (query === null) return;
    function onMouseDown(e: MouseEvent) {
      if (!dropRef.current?.contains(e.target as Node) && e.target !== taRef.current) {
        setQuery(null);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [query]);

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={taRef}
        className="loom-field"
        rows={rows}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={e => {
          const ta = e.currentTarget;
          detectMention(ta.value, ta.selectionStart ?? ta.value.length);
        }}
        readOnly={readOnly}
        style={{ resize: 'vertical' }}
      />
      {query !== null && matches.length > 0 && (
        <div
          ref={dropRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            overflow: 'hidden',
            marginTop: 2,
          }}
        >
          {matches.map((ev, i) => (
            <div
              key={ev.id}
              onMouseDown={e => { e.preventDefault(); insertMention(ev); }}
              style={{
                padding: '7px 12px',
                cursor: 'pointer',
                fontSize: 13,
                background: i === activeIdx ? 'var(--accent)' : 'transparent',
                color: i === activeIdx ? '#fff' : 'var(--text-main)',
              }}
            >
              {ev.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
