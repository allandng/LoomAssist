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
import { CalendarPage } from './pages/CalendarPage';
import { TaskBoardPage, TaskBoardSidebarContent } from './pages/TaskBoardPage';
import { FocusPage, FocusSidebarContent } from './pages/FocusPage';
import { SettingsPage, SettingsSidebarContent } from './pages/SettingsPage';
import { useShortcuts } from './hooks/useShortcuts';
import { loadKeybinds } from './lib/keybindConfig';
import { UndoProvider } from './contexts/UndoContext';
import { ModalProvider } from './contexts/ModalContext';
import { CalendarNavProvider, useCalendarNav } from './contexts/CalendarNavContext';
import { useModal } from './contexts/ModalContext';
import { NotificationsProvider, useNotifications } from './store/notifications';
import { ModalRoot } from './components/modals/ModalRoot';
import { NotifPanel } from './components/NotifPanel';
import { getCrashFlag, exportLogs } from './api';

type Destination = 'calendar' | 'tasks' | 'focus' | 'settings';

const DEST_TO_PATH: Record<Destination, string> = {
  calendar: '/calendar', tasks: '/tasks', focus: '/focus', settings: '/settings',
};
const PATH_TO_DEST: Record<string, Destination> = {
  '/calendar': 'calendar', '/tasks': 'tasks', '/focus': 'focus', '/settings': 'settings',
};

// Apply saved theme before first render to avoid flash
if (typeof document !== 'undefined') {
  document.body.classList.toggle('light-mode', localStorage.getItem('loom-theme') === 'light');
}

function readSidebarCollapsed(): boolean {
  const v = localStorage.getItem('loom:sidebar:collapsed') ?? localStorage.getItem('loom-sidebar');
  return v === '1' || v === 'hidden';
}

function Shell() {
  const navigate   = useNavigate();
  const location   = useLocation();
  const nav        = useCalendarNav();
  const { unreadCount, addNotification, panelOpen, togglePanel } = useNotifications();

  const dest: Destination = PATH_TO_DEST[location.pathname] ?? 'calendar';
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(readSidebarCollapsed);
  const [reloadKey, setReloadKey] = useState(0);
  const [keybinds, setKeybinds] = useState(loadKeybinds);

  useEffect(() => {
    const onChanged = () => setKeybinds(loadKeybinds());
    window.addEventListener('loom-keybinds-changed', onChanged);
    return () => window.removeEventListener('loom-keybinds-changed', onChanged);
  }, []);

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

  const { openEventEditor } = useModal();
  useShortcuts(useMemo(() => [
    { key: keybinds.sidebar_toggle.key, ctrl: keybinds.sidebar_toggle.ctrl, meta: keybinds.sidebar_toggle.meta, shift: keybinds.sidebar_toggle.shift, handler: () => toggleSidebar() },
    { key: keybinds.focus_mode.key,     ctrl: keybinds.focus_mode.ctrl,     meta: keybinds.focus_mode.meta,     shift: keybinds.focus_mode.shift,     handler: () => goTo('focus') },
    { key: keybinds.view_month.key,     ctrl: keybinds.view_month.ctrl,     meta: keybinds.view_month.meta,     shift: keybinds.view_month.shift,     handler: () => dest === 'calendar' ? nav.setView('Month')  : goTo('calendar') },
    { key: keybinds.view_week.key,      ctrl: keybinds.view_week.ctrl,      meta: keybinds.view_week.meta,      shift: keybinds.view_week.shift,      handler: () => dest === 'calendar' ? nav.setView('Week')   : undefined },
    { key: keybinds.view_day.key,       ctrl: keybinds.view_day.ctrl,       meta: keybinds.view_day.meta,       shift: keybinds.view_day.shift,       handler: () => dest === 'calendar' ? nav.setView('Day')    : undefined },
    { key: keybinds.view_agenda.key,    ctrl: keybinds.view_agenda.ctrl,    meta: keybinds.view_agenda.meta,    shift: keybinds.view_agenda.shift,    handler: () => dest === 'calendar' ? nav.setView('Agenda') : undefined },
    { key: keybinds.new_event.key,      ctrl: keybinds.new_event.ctrl,      meta: keybinds.new_event.meta,      shift: keybinds.new_event.shift,      handler: () => openEventEditor() },
    { key: keybinds.today.key,          ctrl: keybinds.today.ctrl,          meta: keybinds.today.meta,          shift: keybinds.today.shift,          handler: () => nav.goToday() },
  ], [keybinds, toggleSidebar, goTo, dest, nav, openEventEditor]));

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
          notifPanelOpen={panelOpen}
          onBell={togglePanel}
        />
        {panelOpen && <NotifPanel onClose={togglePanel} />}
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
