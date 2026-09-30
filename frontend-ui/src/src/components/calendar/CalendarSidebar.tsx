import { useCallback, useState } from 'react';
import styles from './CalendarSidebar.module.css';
import {
  Badge, Button, Checkbox, IconButton, Icon, Icons, Menu, Section, Select, prompt,
} from '../ui';
import { MiniCalendar } from './MiniCalendar';
import type { Calendar, Event, EventTemplate, FreeSlot, TimeBlockTemplate } from '../../types';

const FILTERS = [
  { id: 'checklist', label: 'Has checklist', icon: Icons.tasks },
  { id: 'recurring', label: 'Recurring only', icon: Icons.repeat },
  { id: 'thisweek',  label: 'This week',      icon: Icons.clock },
] as const;

// Working-hours choices for "Find free time" (whole hours, 24h clock).
const HOURS = Array.from({ length: 19 }, (_, i) => i + 5); // 05:00 … 23:00
const fmtHour = (h: number) => `${String(h).padStart(2, '0')}:00`;

export interface CalendarSidebarProps {
  open: boolean;
  onToggle: () => void;
  /** Sync status rendered as a dot badge in the panel header. */
  syncLabel: string;
  syncError: boolean;

  timelines: Calendar[];
  templates: EventTemplate[];
  timeBlockTemplates: TimeBlockTemplate[];
  events: Event[];
  hiddenTimelineIds: Set<number>;
  activeFilters: Set<string>;
  eventCountByTimeline: Record<number, number>;
  filterCounts: Record<string, number>;

  onToggleTimeline: (id: number) => void;
  onToggleFilter: (id: string) => void;
  onNewTimeline: () => void;
  onEditTimeline: (id: number) => void;
  onRenameTimeline: (id: number, name: string) => void;
  onDeleteTimeline: (id: number) => void;
  onExportTimeline: (id: number) => void;

  onApplyTemplate: (t: EventTemplate) => void;
  onDeleteTemplate: (id: number) => void;
  onNewTimeBlockTemplate: () => void;
  /** Opens the event-template manager (apply / delete saved event templates). */
  onManageTemplates?: () => void;
  onApplyTimeBlockTemplate: (tplId: number) => void;
  onDeleteTimeBlockTemplate: (id: number) => void;

  onFindFreeSlots: (durationMins: number, workingStart: number, workingEnd: number) => Promise<FreeSlot[]>;
  onScheduleSlot: (startISO: string, endISO: string) => void;

  missedCount: number;
  onOpenMissed: () => void;

  onImportICS: () => void;
  onScanSyllabus: () => void;
  onAvailability: () => void;

  // Mini-calendar data + navigation.
  miniAnchor: Date;
  miniSelected: Date | null;
  miniRangeStart: Date | null;
  miniRangeEnd: Date | null;
  onMiniPick: (d: Date) => void;
  onMiniPickDay: (d: Date) => void;
}

/**
 * Calendar context panel (left of the grid). Collapsible to zero width; the
 * page owns the open state and persists it under `loom:panel:calendar`.
 */
export function CalendarSidebar(props: CalendarSidebarProps) {
  const {
    open, onToggle, syncLabel, syncError,
    timelines, templates, timeBlockTemplates, events,
    hiddenTimelineIds, activeFilters, eventCountByTimeline, filterCounts,
    onToggleTimeline, onToggleFilter, onNewTimeline, onEditTimeline, onRenameTimeline, onDeleteTimeline, onExportTimeline,
    onApplyTemplate, onDeleteTemplate, onNewTimeBlockTemplate, onManageTemplates, onApplyTimeBlockTemplate, onDeleteTimeBlockTemplate,
    onFindFreeSlots, onScheduleSlot, missedCount, onOpenMissed,
    onImportICS, onScanSyllabus, onAvailability,
    miniAnchor, miniSelected, miniRangeStart, miniRangeEnd, onMiniPick, onMiniPickDay,
  } = props;

  const [filtersOpen, setFiltersOpen] = useState(true);
  const [freeOpen, setFreeOpen] = useState(false);
  const [freeDuration, setFreeDuration] = useState(60);
  const [freeStart, setFreeStart] = useState(9);
  const [freeEnd, setFreeEnd] = useState(18);
  const [freeLoading, setFreeLoading] = useState(false);
  const [freeSlots, setFreeSlots] = useState<FreeSlot[]>([]);
  const [freeSearched, setFreeSearched] = useState(false);
  const [freeError, setFreeError] = useState<string | null>(null);

  const handleFind = useCallback(async () => {
    setFreeLoading(true);
    setFreeSlots([]);
    setFreeSearched(false);
    setFreeError(null);
    try {
      setFreeSlots(await onFindFreeSlots(freeDuration, freeStart, freeEnd));
    } catch {
      setFreeError('Could not search. Is the backend running?');
    } finally {
      setFreeLoading(false);
      setFreeSearched(true);
    }
  }, [onFindFreeSlots, freeDuration, freeStart, freeEnd]);

  const renameTimeline = useCallback(async (t: Calendar) => {
    const name = await prompt({
      title: 'Rename timeline',
      label: 'Name',
      defaultValue: t.name,
      confirmLabel: 'Rename',
      validate: v => (v.trim() ? null : 'Enter a name'),
    });
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed && trimmed !== t.name) onRenameTimeline(t.id, trimmed);
  }, [onRenameTimeline]);

  const hasTemplates = templates.length > 0 || timeBlockTemplates.length > 0;

  return (
    <aside
      className={[styles.panel, open ? '' : styles.collapsed].join(' ')}
      aria-label="Calendar panel"
      aria-hidden={!open}
    >
      {open && (
        <>
          <div className={styles.header}>
            <span className={styles.headerTitle}>Calendar</span>
            <Badge size="sm" dot tone={syncError ? 'error' : 'success'} title={syncLabel}>
              {syncLabel}
            </Badge>
            <IconButton
              className={styles.collapseBtn}
              icon={Icons.chevronsLeft}
              label="Hide panel"
              size="sm"
              onClick={onToggle}
            />
          </div>

          <div className={styles.scroll}>
            <MiniCalendar
              events={events}
              timelines={timelines}
              anchorDate={miniAnchor}
              selectedDate={miniSelected}
              rangeStart={miniRangeStart}
              rangeEnd={miniRangeEnd}
              onPick={onMiniPick}
              onPickDay={onMiniPickDay}
            />

            {/* ── Timelines ─────────────────────────────────────────── */}
            <div className={styles.group}>
              <Section
                small
                title="Timelines"
                actions={<IconButton icon={Icons.plus} label="New timeline" size="sm" onClick={onNewTimeline} />}
              >
                <div className={styles.list}>
                  {timelines.map(t => {
                    const checked = !hiddenTimelineIds.has(t.id);
                    return (
                      <div key={t.id} className={styles.tlRow}>
                        <Checkbox
                          color={t.color}
                          checked={checked}
                          onChange={() => onToggleTimeline(t.id)}
                          aria-label={`Show ${t.name}`}
                        />
                        <span
                          className={[styles.tlName, checked ? '' : styles.tlNameHidden].join(' ')}
                          onDoubleClick={() => void renameTimeline(t)}
                          title="Double-click to rename"
                        >
                          {t.name}
                        </span>
                        <Badge size="sm">{eventCountByTimeline[t.id] ?? 0}</Badge>
                        <Menu
                          align="end"
                          width={200}
                          trigger={({ open: menuOpen, toggle, ref, ...a }) => (
                            <IconButton
                              ref={ref}
                              onClick={toggle}
                              icon={Icons.moreVertical}
                              label={`${t.name} options`}
                              size="sm"
                              active={menuOpen}
                              className={styles.rowMenuBtn}
                              {...a}
                            />
                          )}
                          items={[
                            { id: 'rename', label: 'Rename', icon: Icons.pencil, onSelect: () => void renameTimeline(t) },
                            { id: 'edit',   label: 'Edit',   icon: Icons.settings, onSelect: () => onEditTimeline(t.id) },
                            { id: 'export', label: 'Export .ics', icon: Icons.download, onSelect: () => onExportTimeline(t.id) },
                            { separator: true },
                            { id: 'delete', label: 'Delete', icon: Icons.trash, danger: true, onSelect: () => onDeleteTimeline(t.id) },
                          ]}
                        />
                      </div>
                    );
                  })}
                  {timelines.length === 0 && (
                    <p className={styles.muted}>No timelines yet.</p>
                  )}
                </div>
              </Section>
            </div>

            {/* ── Filters ───────────────────────────────────────────── */}
            <div className={styles.group}>
              <Section
                small
                title="Filters"
                actions={
                  <IconButton
                    icon={Icons.chevronDown}
                    label={filtersOpen ? 'Collapse filters' : 'Expand filters'}
                    size="sm"
                    className={[styles.chev, filtersOpen ? styles.chevOpen : ''].join(' ')}
                    aria-expanded={filtersOpen}
                    onClick={() => setFiltersOpen(o => !o)}
                  />
                }
              >
                {filtersOpen && (
                  <div className={styles.list}>
                    {FILTERS.map(f => {
                      const active = activeFilters.has(f.id);
                      return (
                        <button
                          key={f.id}
                          type="button"
                          className={[styles.filterRow, active ? styles.filterRowActive : ''].join(' ')}
                          aria-pressed={active}
                          onClick={() => onToggleFilter(f.id)}
                        >
                          <Icon d={f.icon} size={13} />
                          <span className={styles.filterLabel}>{f.label}</span>
                          <Badge size="sm" tone={active ? 'accent' : 'neutral'}>{filterCounts[f.id] ?? 0}</Badge>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Section>
            </div>

            {/* ── Templates ─────────────────────────────────────────── */}
            <div className={styles.group}>
              <Section
                small
                title="Templates"
                actions={
                  <>
                    {onManageTemplates && (
                      <IconButton icon={Icons.copy} label="Manage event templates" size="sm" onClick={onManageTemplates} />
                    )}
                    <IconButton icon={Icons.plus} label="New time-block template" size="sm" onClick={onNewTimeBlockTemplate} />
                  </>
                }
              >
                {!hasTemplates && (
                  <p className={styles.muted}>Save an event as a template from the editor, or build a weekly time-block template.</p>
                )}
                {hasTemplates && (
                  <div className={styles.list}>
                    {templates.map(t => (
                      <div key={`t-${t.id}`} className={styles.tplRow}>
                        <div className={styles.tplText}>
                          <div className={styles.tplName}>{t.name}</div>
                          <div className={styles.tplMeta}>
                            {t.duration_minutes} min{t.is_recurring ? ' · recurring' : ''}
                          </div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => onApplyTemplate(t)}>Apply</Button>
                        <Menu
                          align="end"
                          width={180}
                          trigger={({ open: menuOpen, toggle, ref, ...a }) => (
                            <IconButton
                              ref={ref}
                              onClick={toggle}
                              icon={Icons.moreVertical}
                              label={`${t.name} options`}
                              size="sm"
                              active={menuOpen}
                              className={styles.rowMenuBtn}
                              {...a}
                            />
                          )}
                          items={[
                            { id: 'delete', label: 'Delete', icon: Icons.trash, danger: true, onSelect: () => onDeleteTemplate(t.id) },
                          ]}
                        />
                      </div>
                    ))}
                    {timeBlockTemplates.map(t => (
                      <div key={`tb-${t.id}`} className={styles.tplRow}>
                        <div className={styles.tplText}>
                          <div className={styles.tplName}>{t.name}</div>
                          <div className={styles.tplMeta}>Weekly time blocks</div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => onApplyTimeBlockTemplate(t.id)}>Apply</Button>
                        <Menu
                          align="end"
                          width={180}
                          trigger={({ open: menuOpen, toggle, ref, ...a }) => (
                            <IconButton
                              ref={ref}
                              onClick={toggle}
                              icon={Icons.moreVertical}
                              label={`${t.name} options`}
                              size="sm"
                              active={menuOpen}
                              className={styles.rowMenuBtn}
                              {...a}
                            />
                          )}
                          items={[
                            { id: 'delete', label: 'Delete', icon: Icons.trash, danger: true, onSelect: () => onDeleteTimeBlockTemplate(t.id) },
                          ]}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>

            {/* ── Find free time ────────────────────────────────────── */}
            <div className={styles.group}>
              <Section
                small
                title="Find free time"
                actions={
                  <IconButton
                    icon={Icons.chevronDown}
                    label={freeOpen ? 'Collapse find free time' : 'Expand find free time'}
                    size="sm"
                    className={[styles.chev, freeOpen ? styles.chevOpen : ''].join(' ')}
                    aria-expanded={freeOpen}
                    onClick={() => setFreeOpen(o => !o)}
                  />
                }
              >
                {freeOpen && (
                  <div className={styles.freePanel}>
                    <Select size="sm" value={freeDuration} onChange={e => setFreeDuration(Number(e.target.value))} aria-label="Duration">
                      <option value={30}>30 min</option>
                      <option value={60}>1 hour</option>
                      <option value={90}>90 min</option>
                      <option value={120}>2 hours</option>
                    </Select>
                    <div className={styles.freeHours}>
                      <Select size="sm" value={freeStart} onChange={e => setFreeStart(Number(e.target.value))} aria-label="Working hours start">
                        {HOURS.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
                      </Select>
                      <span className={styles.freeDash} aria-hidden="true">–</span>
                      <Select size="sm" value={freeEnd} onChange={e => setFreeEnd(Number(e.target.value))} aria-label="Working hours end">
                        {HOURS.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
                      </Select>
                    </div>
                    <Button size="sm" variant="secondary" block icon={Icons.search} loading={freeLoading} onClick={() => void handleFind()}>
                      Find
                    </Button>

                    {freeSlots.length > 0 && (
                      <ul className={styles.slotList}>
                        {freeSlots.map((slot, i) => {
                          const s = new Date(slot.start);
                          const e = new Date(slot.end);
                          const dateStr = s.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
                          const timeStr = `${s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
                          return (
                            <li key={i} className={styles.slotRow}>
                              <div className={styles.slotText}>
                                <span className={styles.slotDate}>{dateStr}</span>
                                <span className={styles.slotTime}>{timeStr}</span>
                              </div>
                              <Button size="sm" variant="ghost" onClick={() => onScheduleSlot(slot.start, slot.end)}>Schedule</Button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {freeError && <Badge tone="error" dot>{freeError}</Badge>}
                    {freeSearched && !freeLoading && !freeError && freeSlots.length === 0 && (
                      <p className={styles.muted}>No free slots in the next 7 days.</p>
                    )}
                  </div>
                )}
              </Section>
            </div>

            {/* ── Missed ────────────────────────────────────────────── */}
            <div className={styles.group}>
              <Section
                small
                title="Missed"
                actions={missedCount > 0 ? <Badge size="sm" tone="warning">{missedCount}</Badge> : undefined}
              >
                {missedCount === 0
                  ? <p className={styles.muted}>Nothing marked as missed.</p>
                  : <Button size="sm" variant="ghost" block icon={Icons.alertCircle} onClick={onOpenMissed}>
                      Review {missedCount} missed
                    </Button>}
              </Section>
            </div>
          </div>

          <div className={styles.footer}>
            <Button size="sm" variant="ghost" icon={Icons.upload} className={styles.footerBtn} onClick={onImportICS}>Import .ics</Button>
            <Button size="sm" variant="ghost" icon={Icons.doc} className={styles.footerBtn} onClick={onScanSyllabus}>Scan syllabus</Button>
            <Button size="sm" variant="subtle" icon={Icons.mail} className={styles.footerBtn} onClick={onAvailability}>Share availability</Button>
          </div>
        </>
      )}
    </aside>
  );
}
