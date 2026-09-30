import type { ReactNode, ChangeEvent, KeyboardEvent, Ref } from 'react';
import { useCallback, useRef, useState } from 'react';
import styles from './TopBar.module.css';
import { Icon, Icons } from './Icon';
import { Kbd } from './Kbd';
import { Button, IconButton, Segmented } from '../ui';
import { SearchDropdown } from '../topbar/SearchDropdown';
import type { Destination } from '../shell/Sidebar';

export type TopBarKind = Destination | 'sync-review';
export type CalendarView = 'Month' | 'Week' | 'Day' | 'Agenda' | 'Year';

const VIEW_OPTIONS: { value: CalendarView; label: string; kbd: string }[] = [
  { value: 'Month',  label: 'Month',  kbd: '1' },
  { value: 'Week',   label: 'Week',   kbd: '2' },
  { value: 'Day',    label: 'Day',    kbd: '3' },
  { value: 'Year',   label: 'Year',   kbd: '4' },
  { value: 'Agenda', label: 'Agenda', kbd: '5' },
];

/** Complete: every route the Shell can render has a title here. */
const PAGE_TITLES: Record<TopBarKind, string> = {
  home:          'Home',
  calendar:      'Calendar',
  tasks:         'Tasks',
  focus:         'Focus',
  inbox:         'Inbox',
  courses:       'Courses',
  journal:       'Journal',
  settings:      'Settings',
  'sync-review': 'Sync review',
};

export interface TopBarProps {
  kind?: TopBarKind;
  dateLabel?: string;
  view?: CalendarView;
  onView?: (v: CalendarView) => void;
  onPrev?: () => void;
  onToday?: () => void;
  onNext?: () => void;
  /** Clicking the big date title (calendar only) — opens Jump to date. */
  onDateClick?: () => void;
  unread?: number;
  onBell?: () => void;
  /** The bell button element, so the notification popover can anchor to it. */
  bellRef?: Ref<HTMLButtonElement>;
  notifOpen?: boolean;
  onMic?: () => void;
  /** Voice capture in progress. */
  micActive?: boolean;
  semanticEnabled?: boolean;
  onSemanticToggle?: () => void;
  /** Rightmost cluster (SyncCenter, AccountAvatar). */
  right?: ReactNode;
}

/**
 * App top bar (DESIGN.md §4). Calendar route: big date title + Today +
 * chevrons + segmented view switcher. Every other route: page title. The
 * right cluster is the same everywhere.
 */
export function TopBar({
  kind = 'calendar',
  dateLabel = '',
  view = 'Month',
  onView,
  onPrev,
  onToday,
  onNext,
  onDateClick,
  unread = 0,
  onBell,
  bellRef,
  notifOpen = false,
  onMic,
  micActive = false,
  semanticEnabled = false,
  onSemanticToggle,
  right,
}: TopBarProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  function handleSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setQuery(''); searchRef.current?.blur(); }
  }

  function handleSearchChange(e: ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
  }

  const closeSearch = useCallback(() => { setQuery(''); searchRef.current?.blur(); }, []);

  const isCalendar = kind === 'calendar';

  return (
    <header className={styles.bar}>
      {isCalendar ? (
        <div className={styles.calendarNav}>
          <button
            type="button"
            className={styles.dateTitle}
            onClick={onDateClick}
            aria-label={dateLabel ? `${dateLabel} — jump to date` : 'Jump to date'}
            title="Jump to date (G)"
          >
            <h1 className={styles.dateText}>{dateLabel || 'Calendar'}</h1>
            <Icon d={Icons.chevronDown} size={14} className={styles.dateChevron} />
          </button>

          <div className={styles.dateControls}>
            <Button variant="ghost" size="sm" onClick={onToday} title="Go to today (T)">Today</Button>
            <div className={styles.chevrons}>
              <IconButton icon={Icons.chevronLeft} label="Previous period" size="sm" onClick={onPrev} />
              <IconButton icon={Icons.chevronRight} label="Next period" size="sm" onClick={onNext} />
            </div>
          </div>

          <div className={styles.viewSwitcher}>
            <Segmented
              value={view}
              options={VIEW_OPTIONS}
              onChange={v => onView?.(v)}
              size="sm"
              aria-label="Calendar view"
            />
          </div>
        </div>
      ) : (
        <h1 className={styles.pageTitle}>{PAGE_TITLES[kind] ?? 'LoomAssist'}</h1>
      )}

      <div className={styles.spacer} />

      {/* Search */}
      <label className={`${styles.searchWrap} loom-search-wrap`}>
        <Icon d={Icons.search} size={14} className={styles.searchIcon} />
        <input
          ref={searchRef}
          type="search"
          className={`${styles.searchInput} loom-search`}
          placeholder={semanticEnabled ? 'Semantic search…' : 'Search events, timelines…'}
          value={query}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKey}
          aria-label="Search"
          autoComplete="off"
          spellCheck={false}
        />
        {!query && <Kbd small>/</Kbd>}
        {query.trim().length >= 2 && (
          <SearchDropdown query={query} semantic={semanticEnabled} onClose={closeSearch} />
        )}
      </label>

      {onSemanticToggle && (
        <IconButton
          icon={Icons.sparkles}
          label={semanticEnabled ? 'Semantic search on' : 'Semantic search'}
          active={semanticEnabled}
          onClick={onSemanticToggle}
        />
      )}

      {/* AI quick-add / voice */}
      {onMic && (
        <button
          type="button"
          className={[styles.aiBar, micActive ? styles.aiBarActive : ''].join(' ')}
          onClick={onMic}
          aria-pressed={micActive}
          aria-label={micActive ? 'Stop listening' : 'Ask AI by voice'}
          title={micActive ? 'Stop listening' : 'Ask AI by voice'}
        >
          <span className={[styles.micBubble, micActive ? styles.micBubbleActive : ''].join(' ')} aria-hidden="true">
            <Icon d={micActive ? Icons.stop : Icons.mic} size={12} />
          </span>
          <span className={styles.aiPrompt}>
            {micActive ? (
              <span className={styles.aiListening}>Listening…</span>
            ) : (
              <>Ask AI… <span className={styles.aiExample}>"lunch Friday at 1pm"</span></>
            )}
          </span>
        </button>
      )}

      {/* Bell */}
      <div className={styles.bellWrap}>
        <IconButton
          ref={bellRef}
          icon={Icons.bell}
          label="Notifications"
          active={notifOpen}
          onClick={onBell}
          aria-haspopup="dialog"
          aria-expanded={notifOpen}
        />
        {unread > 0 && (
          <span className={styles.badge} aria-label={`${unread} unread`}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </div>

      {right && <div className={styles.right}>{right}</div>}
    </header>
  );
}
