import { useState, useCallback, useRef } from 'react';
import styles from './CalendarSidebar.module.css';
import { Icon, Icons } from '../shared/Icon';
import { Kbd } from '../shared/Kbd';
import { SectionLabel } from '../shared/SectionLabel';
import type { Calendar, EventTemplate } from '../../types';


const FILTERS = [
  { id: 'checklist', label: 'Has checklist', icon: Icons.filter },
  { id: 'recurring', label: 'Recurring only', icon: Icons.sync },
  { id: 'thisweek',  label: 'This week',      icon: Icons.clock },
] as const;

interface CalendarSidebarProps {
  timelines: Calendar[];
  templates: EventTemplate[];
  hiddenTimelineIds: Set<number>;
  activeFilters: Set<string>;
  eventCountByTimeline: Record<number, number>;
  filterCounts: Record<string, number>;
  onToggleTimeline: (id: number) => void;
  onToggleFilter: (id: string) => void;
  onNewEvent: () => void;
  onAvailability: () => void;
  onImportICS: () => void;
  onParseSyllabus: () => void;
  onNewTimeline: () => void;
  onRenameTimeline: (id: number, name: string) => void;
  onDeleteTimeline: (id: number) => void;
  onApplyTemplate: (t: EventTemplate) => void;
}

export function CalendarSidebar({
  timelines,
  templates,
  hiddenTimelineIds,
  activeFilters,
  eventCountByTimeline,
  filterCounts,
  onToggleTimeline,
  onToggleFilter,
  onNewEvent,
  onAvailability,
  onImportICS,
  onParseSyllabus,
  onNewTimeline,
  onRenameTimeline,
  onDeleteTimeline,
  onApplyTemplate,
}: CalendarSidebarProps) {
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const startRename = useCallback((t: Calendar) => {
    setRenamingId(t.id);
    setRenameValue(t.name);
    setMenuOpenFor(null);
    requestAnimationFrame(() => renameRef.current?.select());
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId !== null && renameValue.trim()) {
      onRenameTimeline(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }, [renamingId, renameValue, onRenameTimeline]);

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Calendar</span>
      </div>

      <div className={styles.scroll}>
        {/* Timelines */}
        <SectionLabel right={
          <button className={styles.miniPlus} onClick={onNewTimeline} title="New timeline">
            <Icon d={Icons.plus} size={11} />
          </button>
        }>
          Timelines
        </SectionLabel>

        <div className={styles.tlList}>
          {timelines.map(t => {
            const checked = !hiddenTimelineIds.has(t.id);
            const isRenaming = renamingId === t.id;
            return (
              <div
                key={t.id}
                className={styles.tlRow}
                onDoubleClick={() => startRename(t)}
              >
                <button
                  className={styles.tlCheckbox}
                  style={{
                    background: checked ? t.color : 'transparent',
                    borderColor: checked ? t.color : 'var(--border-strong)',
                  }}
                  onClick={() => onToggleTimeline(t.id)}
                  aria-checked={checked}
                  role="checkbox"
                  aria-label={`Show ${t.name}`}
                >
                  {checked && <Icon d={Icons.check} size={9} stroke="#0B1120" strokeWidth={3} />}
                </button>

                {isRenaming ? (
                  <input
                    ref={renameRef}
                    className={styles.renameInput}
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    autoFocus
                  />
                ) : (
                  <span className={styles.tlName} style={{ color: checked ? 'var(--text-main)' : 'var(--text-muted)' }}>
                    {t.name}
                  </span>
                )}

                <span className={styles.tlCount}>{eventCountByTimeline[t.id] ?? 0}</span>

                <button
                  className={styles.moreBtn}
                  onClick={e => { e.stopPropagation(); setMenuOpenFor(menuOpenFor === t.id ? null : t.id); }}
                  aria-label={`${t.name} options`}
                >
                  <Icon d={Icons.more} size={13} />
                </button>

                {menuOpenFor === t.id && (
                  <div className={styles.tlMenu}>
                    <button onClick={() => startRename(t)}>Rename</button>
                    <button onClick={() => { setMenuOpenFor(null); onDeleteTimeline(t.id); }}>Delete</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Filters */}
        <SectionLabel>Filters</SectionLabel>
        <div className={styles.filterList}>
          {FILTERS.map(f => {
            const active = activeFilters.has(f.id);
            return (
              <button
                key={f.id}
                className={`${styles.filterChip} ${active ? styles.filterChipActive : ''}`}
                onClick={() => onToggleFilter(f.id)}
              >
                <Icon d={f.icon} size={12} />
                <span>{f.label}</span>
                <span className={styles.filterCount}>{filterCounts[f.id] ?? 0}</span>
              </button>
            );
          })}
        </div>

        {/* Templates */}
        {templates.length > 0 && (
          <>
            <SectionLabel right={<span className={styles.tplCount}>{templates.length}</span>}>
              Templates
            </SectionLabel>
            <div className={styles.tplList}>
              {templates.map(t => (
                <button key={t.id} className={styles.tplCard} onClick={() => onApplyTemplate(t)}>
                  <div className={styles.tplName}>{t.name}</div>
                  <div className={styles.tplMeta}>
                    {t.duration_minutes} min{t.is_recurring ? ' · recurring' : ''}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Pinned footer */}
      <div className={styles.footer}>
        <button className={`${styles.quickBtn} ${styles.quickBtnPrimary}`} onClick={onNewEvent}>
          <Icon d={Icons.plus} size={12} /> New Event <Kbd small>N</Kbd>
        </button>
        <button className={styles.quickBtn} onClick={onAvailability}>
          <Icon d={Icons.mail} size={12} /> Availability
        </button>
        <button className={styles.quickBtn} onClick={onImportICS}>
          <Icon d={Icons.upload} size={12} /> Import ICS
        </button>
        <button className={`${styles.quickBtn} ${styles.quickBtnFull}`} onClick={onParseSyllabus}>
          <Icon d={Icons.doc} size={12} /> Parse Syllabus PDF
        </button>
      </div>
    </div>
  );
}
