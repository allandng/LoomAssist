import type { ReactNode, ChangeEvent, KeyboardEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import styles from './TopBar.module.css';
import { Icon, Icons } from './Icon';
import { Kbd } from './Kbd';
import { SearchDropdown } from '../topbar/SearchDropdown';

type TopBarKind = 'home' | 'calendar' | 'tasks' | 'focus' | 'settings';
type CalendarView = 'Month' | 'Week' | 'Day' | 'Agenda' | 'Year';

const VIEWS: CalendarView[] = ['Month', 'Week', 'Day', 'Year', 'Agenda'];
const PAGE_TITLES: Record<TopBarKind, string> = {
  home:     'Home',
  calendar: 'Calendar',
  tasks:    'Task Board',
  focus:    'Focus Mode',
  settings: 'Settings',
};

interface TopBarProps {
  kind?: TopBarKind;
  dateLabel?: string;
  view?: CalendarView;
  onView?: (v: CalendarView) => void;
  onPrev?: () => void;
  onToday?: () => void;
  onNext?: () => void;
  unread?: number;
  onBell?: () => void;
  onMic?: () => void;
  semanticEnabled?: boolean;
  onSemanticToggle?: () => void;
  right?: ReactNode;
}

export function TopBar({
  kind = 'calendar',
  dateLabel = '',
  view = 'Month',
  onView,
  onPrev,
  onToday,
  onNext,
  unread = 0,
  onBell,
  onMic,
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

  return (
    <header className={styles.bar}>
      {kind === 'calendar' ? (
        <>
          {/* View switcher */}
          <div className={styles.viewSwitcher}>
            {VIEWS.map((v, i) => (
              <button
                key={v}
                className={`${styles.viewPill} ${v === view ? styles.viewPillActive : ''}`}
                onClick={() => onView?.(v)}
              >
                {v}
                <Kbd small>{i + 1}</Kbd>
              </button>
            ))}
          </div>

          {/* Date nav */}
          <div className={styles.dateNav}>
            <button className={styles.iconBtn} onClick={onPrev} title="Previous">
              <Icon d={Icons.chevronLeft} size={16} />
            </button>
            <button className={`${styles.iconBtn} ${styles.todayBtn}`} onClick={onToday}>Today</button>
            <button className={styles.iconBtn} onClick={onNext} title="Next">
              <Icon d={Icons.chevronRight} size={16} />
            </button>
            <span className={styles.dateLabel}>
              {dateLabel}
              <Icon d={Icons.chevronDown} size={12} className={styles.dateLabelChevron} />
            </span>
          </div>
        </>
      ) : (
        <span className={styles.pageTitle}>{PAGE_TITLES[kind]}</span>
      )}

      <div className={styles.spacer} />

      {/* Search */}
      <label className={`${styles.searchWrap} loom-search-wrap`}>
        <Icon d={Icons.search} size={14} className={styles.searchIcon} />
        <input
          ref={searchRef}
          className={`${styles.searchInput} loom-search`}
          placeholder={semanticEnabled ? 'Semantic search…' : 'Search events, timelines…'}
          value={query}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKey}
          aria-label="Search"
        />
        <Kbd small>/</Kbd>
        {query.trim().length >= 2 && (
          <SearchDropdown query={query} semantic={semanticEnabled} onClose={closeSearch} />
        )}
      </label>
      {onSemanticToggle && (
        <button
          className={styles.iconBtn}
          onClick={onSemanticToggle}
          title={semanticEnabled ? 'Semantic search ON — click to use text search' : 'Click to enable semantic search'}
          aria-pressed={semanticEnabled}
          style={{ color: semanticEnabled ? 'var(--accent)' : undefined }}
        >
          <Icon d={Icons.help} size={15} />
        </button>
      )}

      {/* AI Quick-Add */}
      <button className={styles.aiBar} onClick={onMic} title="AI Quick-Add">
        <span className={styles.micBubble}>
          <Icon d={Icons.mic} size={12} />
        </span>
        <span className={styles.aiPrompt}>
          Ask AI… <span className={styles.aiExample}>"lunch Friday at 1pm"</span>
        </span>
      </button>

      {/* Bell */}
      <div className={styles.bellWrap}>
        <button className={styles.iconBtn} onClick={onBell} aria-label="Notifications">
          <Icon d={Icons.bell} size={16} />
        </button>
        {unread > 0 && (
          <span className={styles.badge} aria-label={`${unread} unread`}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </div>

      {/* SyncCenter + AccountAvatar (avatar rightmost per CLAUDE.md contract) */}
      {right}
    </header>
  );
}
