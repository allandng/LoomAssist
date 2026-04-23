import { useState, useEffect, useCallback, useMemo } from 'react';
import styles from './FocusPage.module.css';
import { FocusSidebar } from '../components/focus/FocusSidebar';
import { KanbanBoard } from '../components/focus/KanbanBoard';
import { ListView } from '../components/focus/ListView';
import { PomodoroPanel } from '../components/focus/PomodoroPanel';
import { ContextSidebar } from '../components/sidebar/ContextSidebar';
import { Icon, Icons } from '../components/shared/Icon';
import { Kbd } from '../components/shared/Kbd';
import { useShortcuts } from '../hooks/useShortcuts';
import { listTasks, listCalendars } from '../api';
import type { Task, Calendar } from '../types';

type FocusViewMode = 'kanban' | 'list';

function readFocusView(): FocusViewMode {
  return (localStorage.getItem('loom:focus:view') as FocusViewMode) ?? 'kanban';
}

export function FocusPage() {
  const [viewMode, setViewMode] = useState<FocusViewMode>(readFocusView);
  const [fullscreen, setFullscreen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [timelines, setTimelines] = useState<Calendar[]>([]);

  const loadData = useCallback(async () => {
    const [t, c] = await Promise.all([listTasks(), listCalendars()]);
    setTasks(t);
    setTimelines(c);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const changeView = useCallback((v: FocusViewMode) => {
    setViewMode(v);
    localStorage.setItem('loom:focus:view', v);
  }, []);

  const filteredTasks = useMemo(
    () => onlyIncomplete ? tasks.filter(t => !t.is_complete) : tasks,
    [tasks, onlyIncomplete],
  );

  const doneToday = tasks.filter(t => t.is_complete).length;

  useShortcuts(useMemo(() => [
    { key: 'f', handler: () => setFullscreen(v => !v) },
    { key: 'Space', handler: () => changeView(viewMode === 'kanban' ? 'list' : 'kanban') },
    { key: 'b', handler: () => setSidebarCollapsed(v => !v) },
  ], [viewMode, changeView]));

  return (
    <div className={`${styles.page} ${fullscreen ? styles.fullscreen : ''}`}>
      {!fullscreen && (
        <ContextSidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)}>
          <FocusSidebar
            tasks={tasks}
            onlyIncomplete={onlyIncomplete}
            onToggleOnlyIncomplete={() => setOnlyIncomplete(v => !v)}
          />
        </ContextSidebar>
      )}

      <div className={styles.main}>
        <div className={styles.toolbar}>
          <div className={styles.modeToggle}>
            {(['kanban', 'list'] as const).map(m => (
              <button
                key={m}
                className={`${styles.modePill} ${viewMode === m ? styles.modePillActive : ''}`}
                onClick={() => changeView(m)}
              >
                <Icon d={m === 'kanban' ? Icons.kanban : Icons.list} size={13} />
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <span className={styles.taskCount}>{filteredTasks.length} tasks · {doneToday} done today</span>
          <div style={{ flex: 1 }} />
          <Kbd>Space</Kbd>
          <span className={styles.toggleHint}>toggle</span>
          <button
            className={`${styles.fsBtn} ${fullscreen ? styles.fsBtnActive : ''}`}
            onClick={() => setFullscreen(v => !v)}
            title="Toggle fullscreen (F)"
          >
            <Icon d={Icons.fullscreen} size={13} />
            {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.boardArea}>
            {viewMode === 'kanban' ? (
              <KanbanBoard
                tasks={filteredTasks}
                timelines={timelines}
                activeTaskId={activeTaskId}
                onActiveTask={setActiveTaskId}
                onReload={loadData}
              />
            ) : (
              <ListView
                tasks={filteredTasks}
                timelines={timelines}
                activeTaskId={activeTaskId}
                onReload={loadData}
              />
            )}
          </div>

          <PomodoroPanel
            activeTaskId={activeTaskId}
            tasks={tasks}
            timelines={timelines}
          />
        </div>
      </div>
    </div>
  );
}

export function FocusSidebarContent() {
  return null;
}
