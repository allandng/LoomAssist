import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './QuickCreatePopover.module.css';
import { Button, Kbd, Select, TLDot } from '../ui';
import { DEFAULT_TIMELINE_COLOR } from '../../lib/colors';
import { pushEscapeHandler } from '../../lib/escapeStack';
import { isMac } from '../../lib/platform';
import type { Calendar, EventTemplate } from '../../types';

export interface QuickCreateAnchor {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

interface QuickCreatePopoverProps {
  start: Date;
  end: Date;
  allDay: boolean;
  anchor: QuickCreateAnchor;
  timelines: Calendar[];
  templates: EventTemplate[];
  defaultTimelineId: number;
  /** Create the event inline (Enter / Create button). */
  onSubmit: (title: string, calendarId: number, end: Date) => void | Promise<void>;
  /** Escalate to the full editor (More options / mod+Enter). */
  onMoreOptions: (title: string, calendarId: number, end: Date) => void;
  /** Discard + unselect (Esc / click-outside / Discard). */
  onDiscard: () => void;
}

const OFFSET = 10;

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * The two-tier creation entry point. A drag (or click) on the empty grid mounts
 * this anchored inline card with a focused title input; Enter creates
 * immediately, "More options" escalates to the full editor. The DragShader
 * selection tint keeps running underneath.
 */
export function QuickCreatePopover({
  start,
  end,
  allDay,
  anchor,
  timelines,
  templates,
  defaultTimelineId,
  onSubmit,
  onMoreOptions,
  onDiscard,
}: QuickCreatePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [calendarId, setCalendarId] = useState<number>(
    defaultTimelineId || timelines[0]?.id || 0,
  );
  // End can shift when a template with a duration is applied.
  const [endDate, setEndDate] = useState<Date>(end);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: anchor.top,
    left: anchor.right + OFFSET,
  });

  // Anchor with QuickPeek-style flip (horizontal + vertical).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = anchor.right + OFFSET;
    let top = anchor.top;
    if (left + rect.width > window.innerWidth - 8) left = anchor.left - rect.width - OFFSET;
    if (left < 8) left = 8;
    if (top + rect.height > window.innerHeight - 8) top = anchor.bottom - rect.height;
    if (top < 8) top = 8;
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Click-outside closes (discard). mousedown so it beats the input blur.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDiscard();
    }
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [onDiscard]);

  // Esc dismissal goes through the shared escapeStack so the popover
  // participates in single-owner Escape ordering (topmost layer only).
  useEffect(() => pushEscapeHandler(() => onDiscard()), [onDiscard]);

  const canCreate = title.trim().length > 0 && !busy;

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(title.trim(), calendarId, endDate);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Esc is owned by the escapeStack handler above; only Enter is local.
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        onMoreOptions(title.trim(), calendarId, endDate);
      } else {
        void create();
      }
    }
  };

  const applyTemplate = (t: EventTemplate) => {
    setTitle(t.title || t.name);
    if (t.duration_minutes && !allDay) {
      setEndDate(new Date(start.getTime() + t.duration_minutes * 60_000));
    }
    if (t.calendar_id) setCalendarId(t.calendar_id);
    inputRef.current?.focus();
  };

  const dateLabel = start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const timeLabel = allDay ? 'All day' : `${fmtTime(start)} – ${fmtTime(endDate)}`;
  const templateChips = templates.slice(0, 4);
  const activeColor = timelines.find(t => t.id === calendarId)?.color ?? DEFAULT_TIMELINE_COLOR;

  return createPortal(
    <div
      ref={ref}
      className={styles.popover}
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label="Quick create event"
      onKeyDown={onKeyDown}
    >
      <input
        ref={inputRef}
        className={styles.titleInput}
        type="text"
        placeholder="Add title"
        aria-label="Event title"
        value={title}
        onChange={e => setTitle(e.target.value)}
      />

      <div className={styles.timeLabel}>
        <span>{dateLabel}</span>
        <span className={styles.timeMono}>{timeLabel}</span>
      </div>

      <div className={styles.tlRow}>
        <TLDot color={activeColor} size={8} />
        <div className={styles.tlSelect}>
          <Select
            size="sm"
            value={calendarId}
            onChange={e => setCalendarId(Number(e.target.value))}
            aria-label="Timeline"
          >
            {timelines.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </div>
      </div>

      {templateChips.length > 0 && (
        <div className={styles.templates}>
          {templateChips.map(t => (
            <Button
              key={t.id}
              size="sm"
              variant="ghost"
              className={styles.templateChip}
              onClick={() => applyTemplate(t)}
              title={`Use template: ${t.name}`}
            >
              {t.name}
            </Button>
          ))}
        </div>
      )}

      <div className={styles.footer}>
        <Button
          size="sm"
          variant="subtle"
          onClick={() => onMoreOptions(title.trim(), calendarId, endDate)}
        >
          More options <Kbd small>{isMac ? '⌘↵' : 'Ctrl+↵'}</Kbd>
        </Button>
        <div className={styles.footerRight}>
          <Button size="sm" variant="ghost" onClick={onDiscard}>Discard</Button>
          <Button size="sm" variant="primary" kbd="↵" loading={busy} disabled={!canCreate} onClick={() => void create()}>
            Create
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
