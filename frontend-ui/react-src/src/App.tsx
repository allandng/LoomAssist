import { useState, useCallback, useMemo, useEffect } from 'react';
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
import { UndoProvider } from './contexts/UndoContext';
import { ModalProvider } from './contexts/ModalContext';
import { CalendarNavProvider, useCalendarNav } from './contexts/CalendarNavContext';
import { NotificationsProvider, useNotifications } from './store/notifications';
import { ModalRoot } from './components/modals/ModalRoot';
import { NotifPanel } from './components/NotifPanel';
import { getCrashFlag, exportLogs } from './api';
import { logger } from './lib/logger';

type Destination = 'calendar' | 'tasks' | 'focus' | 'settings';

const DEST_TO_PATH: Record<Destination, string> = {
  calendar: '/calendar', tasks: '/tasks', focus: '/focus', settings: '/settings',
};
const PATH_TO_DEST: Record<string, Destination> = {
  '/calendar': 'calendar', '/tasks': 'tasks', '/focus': 'focus', '/settings': 'settings',
};

function readSidebarCollapsed(): boolean {
  const v = localStorage.getItem('loom:sidebar:collapsed') ?? localStorage.getItem('loom-sidebar');
  return v === '1' || v === 'hidden';
}

function Shell() {
  const navigate   = useNavigate();
  const location   = useLocation();
  const nav        = useCalendarNav();
  const { unreadCount, addNotification } = useNotifications();

  const dest: Destination = PATH_TO_DEST[location.pathname] ?? 'calendar';
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(readSidebarCollapsed);
  const [bellOpen, setBellOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Crash recovery on boot
  useEffect(() => {
    const crashHandler = () => {
      addNotification({
        type: 'error',
        title: 'LoomAssist crashed last session',
        message: 'Click to export logs for debugging.',
        actionable: true,
        actionLabel: 'Export logs',
        actionFn: async () => {
          const text = await exportLogs();
          const blob = new Blob([text], { type: 'text/plain' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `loom-crash-${Date.now()}.log`;
          a.click();
        },
      });
    };
    window.__loomCrashHandler = crashHandler;

    if (localStorage.getItem('loom_crash_reports_enabled') !== 'false') {
      getCrashFlag().then(flag => {
        if (flag.crashed) crashHandler();
      }).catch(() => {});
    }

    return () => { delete window.__loomCrashHandler; };
  }, [addNotification]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useShortcuts(useMemo(() => [
    { key: 'b', handler: () => toggleSidebar() },
    { key: 'f', handler: () => goTo('focus') },
    { key: '1', handler: () => dest === 'calendar' ? nav.setView('Month')  : goTo('calendar') },
    { key: '2', handler: () => dest === 'calendar' ? nav.setView('Week')   : undefined },
    { key: '3', handler: () => dest === 'calendar' ? nav.setView('Day')    : undefined },
    { key: '4', handler: () => dest === 'calendar' ? nav.setView('Agenda') : undefined },
  ], [toggleSidebar, goTo, dest, nav]));

  const topBarKind = (dest === 'tasks' ? 'tasks' : dest === 'focus' ? 'focus' : dest === 'settings' ? 'settings' : 'calendar') as Parameters<typeof TopBar>[0]['kind'];

  // Calendar sidebar is rendered inside CalendarPage itself; other routes use ContextSidebar
  const showContextSidebar = dest !== 'calendar';

  return (
    <div className={styles.shell}>
      <AppDrawer active={dest} onNavigate={goTo} />

      {showContextSidebar && (
        <ContextSidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar}>
          {dest === 'tasks'    && <TaskBoardSidebarContent />}
          {dest === 'focus'    && <FocusSidebarContent />}
          {dest === 'settings' && <SettingsSidebarContent />}
        </ContextSidebar>
      )}

      <div className={styles.main}>
        <TopBar
          kind={topBarKind}
          view={nav.view}
          dateLabel={nav.dateLabel}
          onView={nav.setView}
          onPrev={nav.goPrev}
          onToday={nav.goToday}
          onNext={nav.goNext}
          unread={unreadCount}
          onBell={() => setBellOpen(v => !v)}
        />
        {bellOpen && <NotifPanel onClose={() => setBellOpen(false)} />
        <div className={styles.content}>
          <Routes>
            <Route path="/calendar"  element={<CalendarPage key={reloadKey} />} />
            <Route path="/tasks"     element={<TaskBoardPage />} />
            <Route path="/focus"     element={<FocusPage />} />
            <Route path="/settings"  element={<SettingsPage />} />
            <Route path="*"          element={<Navigate to="/calendar" replace />} />
          </Routes>
          <ModalRoot onSaved={() => setReloadKey(k => k + 1)} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <NotificationsProvider>
        <UndoProvider>
          <ModalProvider>
            <CalendarNavProvider>
              <Shell />
            </CalendarNavProvider>
          </ModalProvider>
        </UndoProvider>
      </NotificationsProvider>
    </BrowserRouter>
  );
}
