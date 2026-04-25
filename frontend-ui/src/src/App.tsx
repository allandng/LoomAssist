import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import styles from './App.module.css';
import { AppDrawer, type Destination } from './components/shared/AppDrawer';
import { TopBar } from './components/shared/TopBar';
import { ContextSidebar } from './components/sidebar/ContextSidebar';
import { CalendarPage } from './pages/CalendarPage';
import { TaskBoardPage, TaskBoardSidebarContent } from './pages/TaskBoardPage';
import { FocusPage, FocusSidebarContent } from './pages/FocusPage';
import { SettingsPage, SettingsSidebarContent } from './pages/SettingsPage';
import { InboxPage, InboxSidebarContent } from './pages/InboxPage';
import { CoursesPage, CoursesSidebarContent } from './pages/CoursesPage';
import { JournalPage, JournalSidebarContent } from './pages/JournalPage';
import { SignInPage } from './pages/SignInPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { AccountSettingsPage } from './pages/AccountSettingsPage';
import { ConnectionsSettingsPage } from './pages/ConnectionsSettingsPage';
import { ConnectionDetailPage } from './pages/ConnectionDetailPage';
import { SyncReviewPage } from './pages/SyncReviewPage';
import { AccountAvatar } from './components/topbar/AccountAvatar';
import { SyncCenter } from './components/topbar/SyncCenter';
import { AccountProvider } from './contexts/AccountContext';
import { SyncProvider } from './contexts/SyncContext';
import { InboxPanel } from './components/inbox/InboxPanel';
import { listCalendars, listInbox } from './api';
import { useShortcuts } from './hooks/useShortcuts';
import { loadKeybinds } from './lib/keybindConfig';
import { UndoProvider } from './contexts/UndoContext';
import { ModalProvider } from './contexts/ModalContext';
import { CalendarNavProvider, useCalendarNav } from './contexts/CalendarNavContext';
import { useModal } from './contexts/ModalContext';
import { NotificationsProvider, useNotifications } from './store/notifications';
import { ModalRoot } from './components/modals/ModalRoot';
import { NotifPanel } from './components/NotifPanel';
import { getCrashFlag, exportLogs, getWeeklyReview, transcribeAudio, applyVoiceIntent, semanticSearch } from './api';
import { getISOWeek, lastMonday } from './lib/eventUtils';

const DEST_TO_PATH: Record<Destination, string> = {
  calendar: '/calendar', tasks: '/tasks', focus: '/focus', inbox: '/inbox', courses: '/courses', journal: '/journal', settings: '/settings',
};
const PATH_TO_DEST: Record<string, Destination> = {
  '/calendar': 'calendar', '/tasks': 'tasks', '/focus': 'focus', '/inbox': 'inbox', '/courses': 'courses', '/journal': 'journal', '/settings': 'settings',
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

  // First-launch redirect: route to /onboarding once.
  useEffect(() => {
    if (!localStorage.getItem('loom:onboarded') && location.pathname === '/calendar') {
      navigate('/onboarding', { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Look up the destination from the path. /settings/* sub-routes still resolve to 'settings'.
  const pathRoot = '/' + (location.pathname.split('/')[1] || '');
  const dest: Destination = PATH_TO_DEST[pathRoot] ?? 'calendar';
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(readSidebarCollapsed);
  const [reloadKey, setReloadKey] = useState(0);
  const [keybinds, setKeybinds] = useState(loadKeybinds);

  // Inbox panel state (Phase 4)
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const [appTimelines, setAppTimelines] = useState<import('./types').Calendar[]>([]);

  useEffect(() => {
    listCalendars().then(setAppTimelines).catch(() => {});
  }, []);

  useEffect(() => {
    listInbox().then(items => setInboxCount(items.length)).catch(() => {});
  }, [inboxOpen]);

  // Semantic search (Phase 6)
  const [semanticEnabled, setSemanticEnabled] = useState(false);
  const handleSearch = useCallback(async (q: string) => {
    if (!semanticEnabled || q.trim().length < 3) return;
    try {
      const res = await semanticSearch(q.trim(), 5);
      if (res.results.length === 0) {
        addNotification({ type: 'info', title: 'No semantic matches', message: `No events match "${q}"` });
      } else {
        const titles = res.results.map(r => `${r.event.title} (${Math.round(r.score * 100)}%)`).join(', ');
        addNotification({ type: 'info', title: `Semantic results for "${q}"`, message: titles, autoRemoveMs: 8000 });
      }
    } catch {
      addNotification({ type: 'error', title: 'Semantic search failed', message: 'Is the backend running?' });
    }
  }, [semanticEnabled, addNotification]);

  // Voice intent handler (Phase 5)
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const [micActive, setMicActive] = useState(false);

  const handleMic = useCallback(async () => {
    if (micActive && recorderRef.current) {
      recorderRef.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        setMicActive(false);
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        try {
          const res = await transcribeAudio(blob);
          const results: unknown[] = (res as { execution_results?: unknown[] }).execution_results ?? [];
          for (const r of results) {
            const result = r as Record<string, unknown>;
            const action = result.action as string | undefined;
            if (!action || action === 'create_event' || action === 'parse_error') continue;
            if (result.status === 'pending_confirm') {
              const ev = result.resolved_event as Record<string, string>;
              const change = result.proposed_change as Record<string, unknown>;
              const label = action === 'cancel_event'
                ? `Delete "${ev.title}"?`
                : action === 'move_event'
                  ? `Move "${ev.title}" to ${new Date(change.start_time as string).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}?`
                  : `Resize "${ev.title}" to end ${new Date(change.end_time as string).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}?`;
              addNotification({
                type: 'warning',
                title: label,
                message: '',
                actionable: true,
                actionLabel: 'Confirm',
                actionFn: async () => {
                  await applyVoiceIntent({ action, event_id: ev.id as unknown as number, proposed_change: change });
                  setReloadKey(k => k + 1);
                },
              });
            } else if (result.status === 'not_found') {
              addNotification({ type: 'warning', title: 'No matching event found', message: String(result.detail ?? '') });
            } else if (result.status === 'ambiguous') {
              addNotification({ type: 'info', title: 'Multiple matches — please be more specific', message: '' });
            }
          }
        } catch {
          addNotification({ type: 'error', title: 'Transcription failed', message: 'Is the backend running?' });
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setMicActive(true);
      // Auto-stop after 10 seconds
      setTimeout(() => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); }, 10_000);
    } catch {
      addNotification({ type: 'error', title: 'Microphone unavailable', message: 'Grant microphone permission.' });
    }
  }, [micActive, addNotification, setReloadKey]);

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

  const { openEventEditor, openWeeklyReview } = useModal();

  // Monday auto-trigger: show weekly review notification once per week
  useEffect(() => {
    const now = new Date();
    if (now.getDay() !== 1) return; // only on Mondays

    const isoWeek = getISOWeek(now);
    const storageKey = 'loom_last_review_week';
    if (localStorage.getItem(storageKey) === isoWeek) return; // already shown this week

    const reviewWeekStart = lastMonday(now); // the Monday 7 days ago
    getWeeklyReview(reviewWeekStart.toISOString())
      .then(result => {
        addNotification({
          type: 'info',
          title: 'Weekly Review',
          message: result.summary.length > 100
            ? result.summary.slice(0, 97) + '…'
            : result.summary,
          actionable: true,
          actionLabel: 'Open full review',
          actionFn: () => openWeeklyReview(result.summary, reviewWeekStart.toISOString()),
        });
        localStorage.setItem(storageKey, isoWeek);
      })
      .catch(() => {}); // fail silently — not critical
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useShortcuts(useMemo(() => [
    { key: keybinds.sidebar_toggle.key, ctrl: keybinds.sidebar_toggle.ctrl, meta: keybinds.sidebar_toggle.meta, shift: keybinds.sidebar_toggle.shift, handler: () => toggleSidebar() },
    { key: keybinds.focus_mode.key,     ctrl: keybinds.focus_mode.ctrl,     meta: keybinds.focus_mode.meta,     shift: keybinds.focus_mode.shift,     handler: () => goTo('focus') },
    { key: keybinds.view_month.key,     ctrl: keybinds.view_month.ctrl,     meta: keybinds.view_month.meta,     shift: keybinds.view_month.shift,     handler: () => dest === 'calendar' ? nav.setView('Month')  : goTo('calendar') },
    { key: keybinds.view_week.key,      ctrl: keybinds.view_week.ctrl,      meta: keybinds.view_week.meta,      shift: keybinds.view_week.shift,      handler: () => dest === 'calendar' ? nav.setView('Week')   : undefined },
    { key: keybinds.view_day.key,       ctrl: keybinds.view_day.ctrl,       meta: keybinds.view_day.meta,       shift: keybinds.view_day.shift,       handler: () => dest === 'calendar' ? nav.setView('Day')    : undefined },
    { key: keybinds.view_agenda.key,    ctrl: keybinds.view_agenda.ctrl,    meta: keybinds.view_agenda.meta,    shift: keybinds.view_agenda.shift,    handler: () => dest === 'calendar' ? nav.setView('Agenda') : undefined },
    { key: keybinds.new_event.key,      ctrl: keybinds.new_event.ctrl,      meta: keybinds.new_event.meta,      shift: keybinds.new_event.shift,      handler: () => openEventEditor() },
    { key: keybinds.today.key,          ctrl: keybinds.today.ctrl,          meta: keybinds.today.meta,          shift: keybinds.today.shift,          handler: () => nav.goToday() },
    { key: 'i', ctrl: false, meta: false, shift: false, handler: () => setInboxOpen(o => !o) },
  ], [keybinds, toggleSidebar, goTo, dest, nav, openEventEditor, setInboxOpen]));

  const topBarKind = (dest === 'tasks' ? 'tasks' : dest === 'focus' ? 'focus' : dest === 'settings' ? 'settings' : 'calendar') as Parameters<typeof TopBar>[0]['kind'];

  // Calendar sidebar is rendered inside CalendarPage itself; other routes use ContextSidebar
  const showContextSidebar = dest !== 'calendar';

  return (
    <div className={styles.shell}>
      <AppDrawer active={dest} onNavigate={goTo} inboxCount={inboxCount} />

      {showContextSidebar && (
        <ContextSidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar}>
          {dest === 'tasks'    && <TaskBoardSidebarContent />}
          {dest === 'focus'    && <FocusSidebarContent />}
          {dest === 'inbox'    && <InboxSidebarContent />}
          {dest === 'courses'  && <CoursesSidebarContent />}
          {dest === 'journal'  && <JournalSidebarContent />}
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
          onBell={togglePanel}
          onMic={handleMic}
          onSearch={handleSearch}
          semanticEnabled={semanticEnabled}
          onSemanticToggle={() => setSemanticEnabled(e => !e)}
          right={
            <>
              <SyncCenter />
              <AccountAvatar />
            </>
          }
        />
        {panelOpen && <NotifPanel onClose={togglePanel} />}
        {inboxOpen && <InboxPanel onClose={() => setInboxOpen(false)} timelines={appTimelines} />}
        <div className={styles.content}>
          <Routes>
            <Route path="/calendar"                   element={<CalendarPage key={reloadKey} />} />
            <Route path="/calendar/sync-review"        element={<SyncReviewPage />} />
            <Route path="/tasks"                       element={<TaskBoardPage />} />
            <Route path="/focus"                       element={<FocusPage />} />
            <Route path="/inbox"                       element={<InboxPage />} />
            <Route path="/courses"                     element={<CoursesPage />} />
            <Route path="/journal"                     element={<JournalPage />} />
            <Route path="/settings"                    element={<SettingsPage />} />
            <Route path="/settings/account"            element={<AccountSettingsPage />} />
            <Route path="/settings/connections"        element={<ConnectionsSettingsPage />} />
            <Route path="/settings/connections/:id"    element={<ConnectionDetailPage />} />
            <Route path="*"                            element={<Navigate to="/calendar" replace />} />
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
      <AccountProvider>
        <NotificationsProvider>
          <SyncProvider>
            <UndoProvider>
              <ModalProvider>
                <CalendarNavProvider>
                  {/* Full-bleed routes bypass <Shell/> entirely (no app drawer / no top bar). */}
                  <Routes>
                    <Route path="/auth/sign-in" element={<SignInPage />} />
                    <Route path="/onboarding"   element={<OnboardingPage />} />
                    <Route path="*"             element={<Shell />} />
                  </Routes>
                </CalendarNavProvider>
              </ModalProvider>
            </UndoProvider>
          </SyncProvider>
        </NotificationsProvider>
      </AccountProvider>
    </BrowserRouter>
  );
}
