import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import styles from './TaskCard.module.css';
import type { Task, Event, Calendar } from '../../types';
import { Badge, Checkbox, IconButton, Menu, TLDot, Icon, Icons, type MenuEntry } from '../ui';
import { PRIORITY_TONE, PRIORITY_LABEL, describeDue, formatEstimate, taskTitle, todayISO } from './taskUtils';

/** Relative due-date chip: red when overdue, amber today, neutral otherwise. */
export function DueChip({ dueDate, complete }: { dueDate: string; complete: boolean }) {
  const info = describeDue(dueDate, todayISO());
  if (!info) return null;
  const tone = complete
    ? 'neutral'
    : info.tone === 'overdue' ? 'error' : info.tone === 'today' ? 'warning' : 'neutral';
  return (
    <Badge size="sm" tone={tone} icon={Icons.clock} title={info.long} outline={tone === 'neutral'}>
      {info.label}
    </Badge>
  );
}

export interface TaskCardProps {
  task: Task;
  event: Event | null;
  timeline: Calendar | null;
  /** The task the pomodoro is currently attributed to. */
  focusing?: boolean;
  /** `card` for board columns, `row` for the list view. */
  variant?: 'card' | 'row';
  onToggle: (task: Task) => void;
  menuItems: MenuEntry[];
  /** Extra controls rendered before the menu (e.g. a pin button). */
  extra?: ReactNode;
  /**
   * Makes the whole card a button (click, Enter, Space). Inner controls keep
   * working independently. Used by the Focus board for "focus on this task".
   */
  onActivate?: () => void;
  /** What activating does, for the accessible name. */
  activateLabel?: string;
}

function stop(e: MouseEvent | KeyboardEvent) {
  e.stopPropagation();
}

/**
 * One task, as a board card or a list row. Both variants share the controls:
 * round done-checkbox tinted with the timeline color, priority badge, due chip,
 * timeline dot, estimate, "Focusing" badge and an options menu.
 */
export function TaskCard({
  task, event, timeline, focusing, variant = 'card', onToggle, menuItems, extra, onActivate, activateLabel,
}: TaskCardProps) {
  const title = taskTitle(task);
  const estimate = formatEstimate(task.estimated_minutes);
  const interactive = !!onActivate;

  const check = (
    <Checkbox
      round
      color={timeline?.color ?? undefined}
      checked={task.is_complete}
      onChange={() => onToggle(task)}
      aria-label={task.is_complete ? `Mark "${title}" not done` : `Mark "${title}" done`}
    />
  );

  const menu = (
    <Menu
      align="end"
      items={menuItems}
      trigger={({ open: _open, toggle, ref, ...a }) => (
        <IconButton ref={ref} size="sm" icon={Icons.moreVertical} label={`Options for ${title}`} onClick={toggle} {...a} />
      )}
    />
  );

  const meta = (
    <>
      <Badge size="sm" tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
      {task.due_date && <DueChip dueDate={task.due_date} complete={task.is_complete} />}
      {timeline && (
        <span className={styles.timeline} title={timeline.name}>
          <TLDot color={timeline.color} size={7} />
          <span className={styles.timelineName}>{timeline.name}</span>
        </span>
      )}
      {estimate && (
        <span className={styles.estimate} title={`Estimated ${estimate}`}>
          <Icon d={Icons.timer} size={11} />
          {estimate}
        </span>
      )}
      {focusing && <Badge size="sm" tone="accent" dot>Focusing</Badge>}
    </>
  );

  // Inner controls must not trigger the card's own action. React events bubble
  // through portals too, so this also shields the menu's items.
  const guard = interactive ? { onClick: stop, onKeyDown: stop } : {};

  const rootProps = interactive
    ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-pressed': !!focusing,
        'aria-label': `${title}. ${activateLabel ?? 'Select'}`,
        onClick: onActivate,
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate?.();
          }
        },
      }
    : {};

  const classes = [
    variant === 'row' ? styles.row : styles.card,
    task.is_complete ? styles.done : '',
    focusing ? styles.focusing : '',
    interactive ? styles.interactive : '',
  ].join(' ');

  if (variant === 'row') {
    return (
      <div className={classes} {...rootProps}>
        <span className={styles.guard} {...guard}>{check}</span>
        <div className={styles.rowText}>
          <span className={styles.title}>{title}</span>
          {event && <span className={styles.eventName}>{event.title}</span>}
        </div>
        <div className={styles.rowMeta}>{meta}</div>
        <div className={styles.actions} {...guard}>
          {extra}
          {menu}
        </div>
      </div>
    );
  }

  return (
    <div className={classes} {...rootProps}>
      <div className={styles.cardTop}>
        <span className={styles.guard} {...guard}>{check}</span>
        <div className={styles.cardText}>
          <span className={styles.title}>{title}</span>
          {event && <span className={styles.eventName}>{event.title}</span>}
        </div>
        <div className={styles.actions} {...guard}>
          {extra}
          {menu}
        </div>
      </div>
      <div className={styles.cardMeta}>{meta}</div>
    </div>
  );
}
