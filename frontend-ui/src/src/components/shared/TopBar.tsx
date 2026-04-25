import type { ReactNode, ChangeEvent, KeyboardEvent } from 'react';
import { useRef } from 'react';
import styles from './TopBar.module.css';
import { Icon, Icons } from './Icon';
import { Kbd } from './Kbd';

type TopBarKind = 'calendar' | 'tasks' | 'focus' | 'settings';
type CalendarView = 'Month' | 'Week' | 'Day' | 'Agenda' | 'Year';

const VIEWS: CalendarView[] = ['Month', 'Week', 'Day', 'Year', 'Agenda'];
const PAGE_TITLES: Record<TopBarKind, string> = {
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
  onSettings?: () => void;
  onSearch?: (query: string) => void;
  onMic?: () => void;
  semanticEnabled?: boolean;
  onSemanticToggle?: () => void;
  syncStatus?: 'ok' | 'error' | 'syncing';
  syncLabel?: string;
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
  onSettings,
  onSearch,
  onMic,
  semanticEnabled = false,
  onSemanticToggle,
  syncStatus = 'ok',
  syncLabel = 'Synced',
  right,
}: TopBarProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  function handleSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') searchRef.current?.blur();
  }

  function handleSearchChange(e: ChangeEvent<HTMLInputElement>) {
    onSearch?.(e.target.value);
  }

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
      {right}

      {/* Search */}
      <label className={styles.searchWrap}>
        <Icon d={Icons.search} size={14} className={styles.searchIcon} />
        <input
          ref={searchRef}
          className={styles.searchInput}
          placeholder={semanticEnabled ? 'Semantic search…' : 'Search events, timelines…'}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKey}
        />
        <Kbd small>/</Kbd>
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

      {/* Sync indicator */}
      <div
        className={`${styles.sync} ${syncStatus === 'error' ? styles.syncError : ''}`}
        title={syncLabel}
      >
        <span className={`${styles.syncDot} ${syncStatus === 'syncing' ? styles.syncDotPulse : ''}`} />
        {syncLabel}
      </div>

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

      <button className={styles.iconBtn} onClick={onSettings} aria-label="Settings">
        <Icon d={Icons.settings} size={16} />
      </button>
    </header>
  );
}
