import { useState, useEffect, useCallback, useMemo } from 'react';
import styles from './FocusPage.module.css';
import { FocusSidebar } from '../components/focus/FocusSidebar';
import { KanbanBoard } from '../components/focus/KanbanBoard';
import { ListView } from '../components/focus/ListView';
import { PomodoroPanel } from '../components/focus/PomodoroPanel';
import { ContextSidebar } from '../components/sidebar/ContextSidebar';
import { Page, Toolbar, ToolbarSpacer, Button, Segmented, Badge, Skeleton, Icons } from '../components/ui';
import { useShortcuts } from '../hooks/useShortcuts';
import { listTasks, listCalendars, listEvents } from '../api';
import type { Task, Calendar, Event } from '../types';
import { useActiveTaskId, setActiveTaskId, useFocusVersion, doneTodayCount } from '../components/focus/focusStore';

type FocusViewMode = 'kanban' | 'list';

const VIEW_KEY  = 'loom:focus:view';
const PANEL_KEY = 'loom:panel:focus';
const VIEWS: FocusViewMode[] = ['kanban', 'list'];

function readView(): FocusViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'list' || v === 'kanban' ? v : 'kanban';
  } catch {
    return 'kanban';
  }
}

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function persist(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

/**
 * Focus: left panel (today's schedule, pinned tasks), the task board or list in
 * the middle, and the pomodoro timer on the right. Keys: F full screen, V
 * switch layout, B toggle panel, Space start/pause the timer.
 */
export function FocusPage() {
  const [viewMode, setViewMode] = useState<FocusViewMode>(readView);
  const [fullscreen, setFullscreen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(() => readFlag(PANEL_KEY));
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const activeTaskId = useActiveTaskId();
  const focusVersion = useFocusVersion();

  const [tasks, setTasks]         = useState<Task[]>([]);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const [events, setEvents]       = useState<Event[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    let alive = true;
    Promise.all([listTasks(), listCalendars(), listEvents()])
      .then(([t, c, e]) => {
        if (!alive) return;
        setTasks(t);
        setTimelines(c);
        setEvents(e);
        setError(false);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [reloadKey]);

  // A focused task that was deleted elsewhere should not linger in the timer.
  useEffect(() => {
    if (!loading && activeTaskId != null && !tasks.some(t => t.id === activeTaskId)) setActiveTaskId(null);
  }, [loading, tasks, activeTaskId]);

  const togglePanel = useCallback(() => {
    setPanelCollapsed(c => {
      const next = !c;
      persist(PANEL_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  useEffect(() => {
    window.addEventListener('loom-panel-toggle', togglePanel);
    return () => window.removeEventListener('loom-panel-toggle', togglePanel);
  }, [togglePanel]);

  const changeView = useCallback((v: FocusViewMode) => {
    setViewMode(v);
    persist(VIEW_KEY, v);
  }, []);

  const filteredTasks = useMemo(
    () => (onlyIncomplete ? tasks.filter(t => !t.is_complete) : tasks),
    [tasks, onlyIncomplete],
  );

  const doneToday = useMemo(() => doneTodayCount(tasks), [tasks, focusVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- store read keyed on its version

  useShortcuts(useMemo(() => [
    { key: 'f', handler: () => setFullscreen(v => !v) },
    { key: 'v', handler: () => changeView(VIEWS[(VIEWS.indexOf(viewMode) + 1) % VIEWS.length]) },
    { key: 'b', handler: togglePanel },
  ], [viewMode, changeView, togglePanel]));

  const boardProps = {
    tasks: filteredTasks,
    events,
    timelines,
    activeTaskId,
    onActiveTask: setActiveTaskId,
    onReload: reload,
  };

  return (
    <Page bare className={fullscreen ? styles.fullscreen : undefined}>
      {!fullscreen && (
        <ContextSidebar collapsed={panelCollapsed} onToggle={togglePanel}>
          <FocusSidebar
            tasks={tasks}
            events={events}
            timelines={timelines}
            onlyIncomplete={onlyIncomplete}
            onToggleOnlyIncomplete={() => setOnlyIncomplete(v => !v)}
          />
        </ContextSidebar>
      )}

      <div className={styles.main}>
        <Toolbar className={styles.toolbar}>
          <Segmented
            size="sm"
            aria-label="Layout"
            value={viewMode}
            onChange={changeView}
            options={[
              { value: 'kanban', label: 'Board', icon: Icons.kanban },
              { value: 'list',   label: 'List',  icon: Icons.list },
            ]}
          />
          {!loading && !error && (
            <span className={styles.meta}>
              {filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'} · {doneToday} done today
            </span>
          )}
          <ToolbarSpacer />
          <Button
            size="sm"
            variant={fullscreen ? 'secondary' : 'ghost'}
            icon={Icons.fullscreen}
            kbd="F"
            aria-pressed={fullscreen}
            onClick={() => setFullscreen(v => !v)}
          >
            {fullscreen ? 'Exit full screen' : 'Full screen'}
          </Button>
        </Toolbar>

        <div className={styles.content}>
          <div className={styles.boardArea}>
            {error ? (
              <div className={styles.errorRow} role="alert">
                <Badge tone="error" icon={Icons.alertCircle}>Couldn't load tasks</Badge>
                <Button size="sm" variant="subtle" icon={Icons.refresh} onClick={reload}>Retry</Button>
              </div>
            ) : loading ? (
              <div className={styles.skeleton} aria-hidden="true">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className={styles.skeletonCol}>
                    <Skeleton height={16} width="45%" />
                    <Skeleton height={64} />
                    <Skeleton height={64} />
                  </div>
                ))}
              </div>
            ) : viewMode === 'kanban' ? (
              <KanbanBoard {...boardProps} />
            ) : (
              <ListView {...boardProps} />
            )}
          </div>

          <PomodoroPanel
            activeTaskId={activeTaskId}
            tasks={tasks}
            events={events}
            timelines={timelines}
            onClearActive={() => setActiveTaskId(null)}
          />
        </div>
      </div>
    </Page>
  );
}
