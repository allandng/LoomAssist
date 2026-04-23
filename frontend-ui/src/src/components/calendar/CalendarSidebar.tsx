import { useState, useCallback, useRef } from 'react';
import styles from './CalendarSidebar.module.css';
import { Icon, Icons } from '../shared/Icon';
import { Kbd } from '../shared/Kbd';
import { SectionLabel } from '../shared/SectionLabel';
import type { Calendar, EventTemplate, SyllabusEvent } from '../../types';

export interface ScanEventEdit {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  calendarId: number;
}

const FILTERS = [
  { id: 'checklist', label: 'Has checklist', icon: Icons.filter },
  { id: 'recurring', label: 'Recurring only', icon: Icons.sync },
  { id: 'thisweek',  label: 'This week',      icon: Icons.clock },
] as const;

interface CalendarSidebarProps {
  open?: boolean;
  onToggle?: () => void;
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
  onScanFile: (file: File) => void;
  scanLoading?: boolean;
  scanResults?: SyllabusEvent[] | null;
  onApproveScan: (ev: ScanEventEdit, idx: number) => void;
  onDismissScan: (idx: number) => void;
  onClearScan: () => void;
  onNewTimeline: () => void;
  onRenameTimeline: (id: number, name: string) => void;
  onDeleteTimeline: (id: number) => void;
  onApplyTemplate: (t: EventTemplate) => void;
}

// ── Scan event card ──────────────────────────────────────────────

function ScanEventCard({
  ev,
  defaultCalendarId,
  timelines,
  onApprove,
  onDismiss,
}: {
  ev: SyllabusEvent;
  defaultCalendarId: number;
  timelines: Calendar[];
  onApprove: (e: ScanEventEdit) => void;
  onDismiss: () => void;
}) {
  const [title,      setTitle]      = useState(ev.title);
  const [date,       setDate]       = useState(ev.date ?? '');
  const [startTime,  setStartTime]  = useState(ev.start_time ?? '');
  const [endTime,    setEndTime]    = useState(ev.end_time ?? '');
  const [calendarId, setCalendarId] = useState(ev.calendar_id ?? defaultCalendarId);

  return (
    <div className={styles.scanCard}>
      <input
        className={styles.scanField}
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Event name"
      />
      <div className={styles.scanTimeRow}>
        <input
          type="date"
          className={styles.scanField}
          value={date}
          onChange={e => setDate(e.target.value)}
        />
        <input
          type="time"
          className={styles.scanField}
          value={startTime}
          onChange={e => setStartTime(e.target.value)}
        />
        <input
          type="time"
          className={styles.scanField}
          value={endTime}
          onChange={e => setEndTime(e.target.value)}
        />
      </div>
      <select
        className={styles.scanField}
        value={calendarId}
        onChange={e => setCalendarId(Number(e.target.value))}
      >
        {timelines.map(t => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      <div className={styles.scanCardActions}>
        <button
          className={styles.scanApproveBtn}
          onClick={() => onApprove({ title, date, startTime, endTime, calendarId })}
          disabled={!title.trim() || !date}
        >
          ✓ Add
        </button>
        <button className={styles.scanDismissBtn} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ── Main sidebar ─────────────────────────────────────────────────

export function CalendarSidebar({
  open = true,
  onToggle,
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
  onScanFile,
  scanLoading = false,
  scanResults = null,
  onApproveScan,
  onDismissScan,
  onClearScan,
  onNewTimeline,
  onRenameTimeline,
  onDeleteTimeline,
  onApplyTemplate,
}: CalendarSidebarProps) {
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);
  const [renamingId,  setRenamingId]  = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef  = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startRename = useCallback((t: Calendar) => {
    setRenamingId(t.id);
    setRenameValue(t.name);
    setMenuOpenFor(null);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId !== null && renameValue.trim()) {
      onRenameTimeline(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }, [renamingId, renameValue, onRenameTimeline]);

  const isScanMode = scanLoading || scanResults !== null;
  const defaultCalendarId = timelines[0]?.id ?? 0;

  // ── Header label
  let headerTitle = 'Calendar';
  if (scanLoading)                               headerTitle = 'Scanning…';
  else if (scanResults !== null && scanResults.length > 0) headerTitle = `Scan Results · ${scanResults.length}`;
  else if (scanResults !== null)                 headerTitle = 'Scan Results';

  return (
    <div className={`${styles.sidebar} ${open ? '' : styles.collapsed}`}>

      {/* Header */}
      <div className={styles.header}>
        <button
          className={styles.toggleBtn}
          onClick={onToggle}
          aria-expanded={open}
          aria-label="Toggle sidebar"
        >
          <Icon d={open ? Icons.chevronLeft : Icons.chevronRight} size={14} />
        </button>
        {open && <span className={styles.headerTitle}>{headerTitle}</span>}
        {open && isScanMode && (
          <button className={styles.scanClear} onClick={onClearScan} title="Cancel scan">
            ✕
          </button>
        )}
      </div>

      {/* ── Scan mode ──────────────────── */}
      {open && isScanMode && (
        scanLoading ? (
          <div className={styles.scanLoading}>
            <div className={styles.scanSpinner} />
            <span>Reading file…</span>
          </div>
        ) : (
          <div className={styles.scanList}>
            {(scanResults ?? []).map((ev, idx) => (
              <ScanEventCard
                key={idx}
                ev={ev}
                defaultCalendarId={defaultCalendarId}
                timelines={timelines}
                onApprove={edit => onApproveScan(edit, idx)}
                onDismiss={() => onDismissScan(idx)}
              />
            ))}
          </div>
        )
      )}

      {/* ── Normal mode ────────────────── */}
      {open && !isScanMode && (
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
              const checked    = !hiddenTimelineIds.has(t.id);
              const isRenaming = renamingId === t.id;
              return (
                <div key={t.id} className={styles.tlRow}>
                  <button
                    className={styles.tlCheckbox}
                    style={{
                      background:  checked ? t.color : 'transparent',
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
                        if (e.key === 'Enter')  commitRename();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onFocus={e => (e.target as HTMLInputElement).select()}
                      autoFocus
                    />
                  ) : (
                    <span
                      className={styles.tlName}
                      style={{ color: checked ? 'var(--text-main)' : 'var(--text-muted)' }}
                      onDoubleClick={e => { e.stopPropagation(); startRename(t); }}
                    >
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
      )}

      {/* Hidden file input for scan */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) onScanFile(file);
          e.target.value = '';
        }}
      />

      {/* Footer — hidden during scan mode */}
      {open && !isScanMode && (
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
          <button
            className={`${styles.quickBtn} ${styles.quickBtnFull}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon d={Icons.doc} size={12} /> Scan File
          </button>
        </div>
      )}
    </div>
  );
}
