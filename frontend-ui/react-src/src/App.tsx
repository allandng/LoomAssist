import { useState, useCallback, useMemo } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import styles from './App.module.css';
import { AppDrawer } from './components/shared/AppDrawer';
import { TopBar } from './components/shared/TopBar';
import { ContextSidebar } from './components/sidebar/ContextSidebar';
import { CalendarPage, CalendarSidebarContent } from './pages/CalendarPage';
import { TaskBoardPage, TaskBoardSidebarContent } from './pages/TaskBoardPage';
import { FocusPage, FocusSidebarContent } from './pages/FocusPage';
import { SettingsPage, SettingsSidebarContent } from './pages/SettingsPage';
import { useShortcuts } from './hooks/useShortcuts';

type Destination = 'calendar' | 'tasks' | 'focus' | 'settings';
type CalendarView = 'Month' | 'Week' | 'Day' | 'Agenda';

const DEST_TO_PATH: Record<Destination, string> = {
  calendar: '/calendar',
  tasks:    '/tasks',
  focus:    '/focus',
  settings: '/settings',
};

const PATH_TO_DEST: Record<string, Destination> = {
  '/calendar': 'calendar',
  '/tasks':    'tasks',
  '/focus':    'focus',
  '/settings': 'settings',
};

function readSidebarCollapsed(): boolean {
  const v = localStorage.getItem('loom:sidebar:collapsed') ?? localStorage.getItem('loom-sidebar');
  return v === '1' || v === 'hidden';
}

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();

  const dest: Destination = PATH_TO_DEST[location.pathname] ?? 'calendar';

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(readSidebarCollapsed);
  const [calView, setCalView] = useState<CalendarView>('Month');

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('loom:sidebar:collapsed', next ? '1' : '0');
      return next;
    });
  }, []);

  const goTo = useCallback((d: Destination) => {
    localStorage.setItem('loom:destination', d);
    navigate(DEST_TO_PATH[d]);
  }, [navigate]);

  const shortcuts = useMemo(() => [
    { key: 'b', handler: () => toggleSidebar() },
    { key: 'f', handler: () => goTo('focus') },
    { key: '1', handler: () => { if (dest === 'calendar') setCalView('Month'); else goTo('calendar'); } },
    { key: '2', handler: () => { if (dest === 'calendar') setCalView('Week');  } },
    { key: '3', handler: () => { if (dest === 'calendar') setCalView('Day');   } },
    { key: '4', handler: () => { if (dest === 'calendar') setCalView('Agenda');} },
    // Ctrl+Z / Shift+Z are force-wired — handled by the undo context (Phase 4)
  ], [toggleSidebar, goTo, dest]);

  useShortcuts(shortcuts);

  const topBarKind = dest === 'calendar' ? 'calendar' : dest === 'tasks' ? 'tasks' : dest === 'focus' ? 'focus' : 'settings';

  return (
    <div className={styles.shell}>
      <AppDrawer active={dest} onNavigate={goTo} />

      <ContextSidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar}>
        {dest === 'calendar' && <CalendarSidebarContent />}
        {dest === 'tasks'    && <TaskBoardSidebarContent />}
        {dest === 'focus'    && <FocusSidebarContent />}
        {dest === 'settings' && <SettingsSidebarContent />}
      </ContextSidebar>

      <div className={styles.main}>
        <TopBar
          kind={topBarKind}
          view={calView}
          onView={v => setCalView(v as CalendarView)}
        />
        <div className={styles.content}>
          <Routes>
            <Route path="/calendar"  element={<CalendarPage />} />
            <Route path="/tasks"     element={<TaskBoardPage />} />
            <Route path="/focus"     element={<FocusPage />} />
            <Route path="/settings"  element={<SettingsPage />} />
            <Route path="*"          element={<Navigate to="/calendar" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
