import { useState, useCallback, useRef } from 'react';
import styles from './CalendarSidebar.module.css';
import { Icon, Icons } from '../shared/Icon';
import { Kbd } from '../shared/Kbd';
import { SectionLabel } from '../shared/SectionLabel';
import type { Calendar, EventTemplate, SyllabusEvent, FreeSlot, TimeBlockTemplate } from '../../types';

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
  onFindFreeSlots: (durationMins: number) => Promise<FreeSlot[]>;
  onScheduleSlot: (startISO: string, endISO: string) => void;
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
  timeBlockTemplates: TimeBlockTemplate[];
  onNewTimeBlockTemplate: () => void;
  onApplyTimeBlockTemplate: (tplId: number, weekMondayDate: string) => void;
  onDeleteTimeBlockTemplate: (id: number) => void;
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
  onFindFreeSlots,
  onScheduleSlot,
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
  timeBlockTemplates,
  onNewTimeBlockTemplate,
  onApplyTimeBlockTemplate,
  onDeleteTimeBlockTemplate,
}: CalendarSidebarProps) {
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);
  const [renamingId,  setRenamingId]  = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef  = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Time Block Template apply week-picker state
  const [applyWeekFor,   setApplyWeekFor]   = useState<number | null>(null);
  const [applyWeekValue, setApplyWeekValue] = useState('');

  const [filtersOpen, setFiltersOpen] = useState(true);

  // Smart Scheduler state
  const [schedulerOpen,     setSchedulerOpen]     = useState(false);
  const [schedulerDuration, setSchedulerDuration] = useState(60);
  const [schedulerLoading,  setSchedulerLoading]  = useState(false);
  const [schedulerSlots,    setSchedulerSlots]    = useState<FreeSlot[]>([]);
  const [schedulerSearched, setSchedulerSearched] = useState(false);

  const handleFindSlots = useCallback(async () => {
    setSchedulerLoading(true);
    setSchedulerSlots([]);
    setSchedulerSearched(false);
    try {
      const slots = await onFindFreeSlots(schedulerDuration);
      setSchedulerSlots(slots);
    } finally {
      setSchedulerLoading(false);
      setSchedulerSearched(true);
    }
  }, [onFindFreeSlots, schedulerDuration]);

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
          <SectionLabel right={
            <button
              className={styles.miniPlus}
              onClick={() => setFiltersOpen(o => !o)}
              title={filtersOpen ? 'Collapse' : 'Expand'}
            >
              <Icon d={Icons.chevronDown} size={11} style={{ transform: filtersOpen ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
            </button>
          }>
            Filters
          </SectionLabel>
          {filtersOpen && (
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
          )}

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

          {/* Time Block Templates */}
          <SectionLabel right={
            <button className={styles.miniPlus} onClick={onNewTimeBlockTemplate} title="New time block template">+</button>
          }>
            Time Block Templates
          </SectionLabel>
          {timeBlockTemplates.length > 0 && (
            <div className={styles.tbtList}>
              {timeBlockTemplates.map(t => (
                <div key={t.id} className={styles.tbtRow}>
                  <span className={styles.tbtName}>{t.name}</span>
                  <div className={styles.tbtActions}>
                    {applyWeekFor === t.id ? (
                      <>
                        <input
                          type="week"
                          className={styles.weekPicker}
                          value={applyWeekValue}
                          onChange={e => setApplyWeekValue(e.target.value)}
                        />
                        <button
                          className={styles.tbtApplyConfirm}
                          disabled={!applyWeekValue}
                          onClick={() => {
                            if (!applyWeekValue) return;
                            const [yearStr, weekStr] = applyWeekValue.split('-W');
                            const year = Number(yearStr);
                            const week = Number(weekStr);
                            // ISO 8601: Jan 4 is always in week 1
                            const jan4 = new Date(year, 0, 4);
                            const dayOfWeek = jan4.getDay() || 7;
                            const monday = new Date(jan4);
                            monday.setDate(jan4.getDate() - (dayOfWeek - 1) + (week - 1) * 7);
                            const mondayISO = monday.toISOString().slice(0, 10);
                            onApplyTimeBlockTemplate(t.id, mondayISO);
                            setApplyWeekFor(null);
                            setApplyWeekValue('');
                          }}
                        >
                          Apply
                        </button>
                        <button
                          className={styles.tbtCancel}
                          onClick={() => { setApplyWeekFor(null); setApplyWeekValue(''); }}
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <button
                        className={styles.tbtApplyBtn}
                        onClick={() => setApplyWeekFor(t.id)}
                        title="Apply to week"
                      >
                        Apply ▶
                      </button>
                    )}
                    <button
                      className={styles.tbtDeleteBtn}
                      onClick={() => onDeleteTimeBlockTemplate(t.id)}
                      title="Delete template"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Smart Scheduler */}
          <SectionLabel right={
            <button
              className={styles.miniPlus}
              onClick={() => setSchedulerOpen(o => !o)}
              title={schedulerOpen ? 'Collapse' : 'Expand'}
            >
              <Icon d={Icons.chevronDown} size={11} style={{ transform: schedulerOpen ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
            </button>
          }>
            Find Free Time
          </SectionLabel>

          {schedulerOpen && (
            <div className={styles.schedulerPanel}>
              <div className={styles.schedulerRow}>
                <select
                  className={styles.schedulerSelect}
                  value={schedulerDuration}
                  onChange={e => setSchedulerDuration(Number(e.target.value))}
                >
                  <option value={30}>30 min</option>
                  <option value={60}>1 hour</option>
                  <option value={90}>90 min</option>
                  <option value={120}>2 hours</option>
                </select>
                <button
                  className={styles.schedulerFindBtn}
                  onClick={handleFindSlots}
                  disabled={schedulerLoading}
                >
                  {schedulerLoading ? '…' : 'Search'}
                </button>
              </div>

              {schedulerSlots.map((slot, i) => {
                const s = new Date(slot.start);
                const e = new Date(slot.end);
                const dateStr = s.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
                const timeStr = `${s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
                return (
                  <button
                    key={i}
                    className={styles.schedulerSlot}
                    onClick={() => onScheduleSlot(slot.start, slot.end)}
                  >
                    <span className={styles.schedulerSlotDate}>{dateStr}</span>
                    <span className={styles.schedulerSlotTime}>{timeStr}</span>
                  </button>
                );
              })}

              {schedulerSearched && !schedulerLoading && schedulerSlots.length === 0 && (
                <p className={styles.schedulerEmpty}>No free slots found this week.</p>
              )}
            </div>
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
