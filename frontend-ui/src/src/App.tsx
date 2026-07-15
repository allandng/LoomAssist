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
import { HomePage } from './pages/HomePage';
import { TaskBoardPage } from './pages/TaskBoardPage';
import { FocusPage } from './pages/FocusPage';
import { SettingsPage, SettingsSidebarContent } from './pages/SettingsPage';
import { InboxPage } from './pages/InboxPage';
import { CoursesPage } from './pages/CoursesPage';
import { JournalPage } from './pages/JournalPage';
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
import { CommandPalette } from './components/CommandPalette';
import { NotifPanel } from './components/NotifPanel';
import { ConfirmBar, type ConfirmBarItem } from './components/ConfirmBar';
import { getCrashFlag, exportLogs, getCachedWeeklyReview, generateWeeklyReview, getBriefing, transcribeAudio, applyVoiceIntent, semanticSearch } from './api';
import { getISOWeek, lastMonday } from './lib/eventUtils';

const DEST_TO_PATH: Record<Destination, string> = {
  home: '/home', calendar: '/calendar', tasks: '/tasks', focus: '/focus', inbox: '/inbox', courses: '/courses', journal: '/journal', settings: '/settings',
};
const PATH_TO_DEST: Record<string, Destination> = {
  '/home': 'home', '/calendar': 'calendar', '/tasks': 'tasks', '/focus': 'focus', '/inbox': 'inbox', '/courses': 'courses', '/journal': 'journal', '/settings': 'settings',
};

// Apply saved theme + font before first render to avoid flash
if (typeof document !== 'undefined') {
  const theme = localStorage.getItem('loom-theme');
  document.body.classList.toggle('light-mode',     theme === 'light');
  document.body.classList.toggle('high-contrast',  theme === 'high-contrast');
  document.body.classList.toggle('font-dyslexic',  localStorage.getItem('loom_font_dyslexic') === 'true');
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
    if (!localStorage.getItem('loom:onboarded') && (location.pathname === '/home' || location.pathname === '/calendar')) {
      navigate('/onboarding', { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Look up the destination from the path. /settings/* sub-routes still resolve to 'settings'.
  const pathRoot = '/' + (location.pathname.split('/')[1] || '');
  const dest: Destination = PATH_TO_DEST[pathRoot] ?? 'home';
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(readSidebarCollapsed);
  const [reloadKey, setReloadKey] = useState(0);
  const [keybinds, setKeybinds] = useState(loadKeybinds);

  // Inbox panel state (Phase 4)
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
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
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);
  const [micActive, setMicActive] = useState(false);

  // WS7 #1 — voice-intent confirmations render in a dedicated ConfirmBar
  // (explicit Confirm/Cancel, no auto-dismiss), not in a transient toast.
  const [confirmItems, setConfirmItems] = useState<ConfirmBarItem[]>([]);
  const resolveConfirm = useCallback(
    (id: string) => setConfirmItems(items => items.filter(c => c.id !== id)),
    [],
  );

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
        stream.getTracks().forEach(t => t.stop());
        if (!isMountedRef.current) return;
        setMicActive(false);
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
              const confirmId = `voice-${ev.id}-${Date.now()}`;
              setConfirmItems(items => [...items, {
                id: confirmId,
                message: label,
                confirmLabel: 'Confirm',
                destructive: action === 'cancel_event',
                onConfirm: async () => {
                  await applyVoiceIntent({ action, event_id: ev.id as unknown as number, proposed_change: change });
                  setReloadKey(k => k + 1);
                },
              }]);
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

  // Boot-time briefing: if the user opted in, fetch today's agenda from the
  // backend and (a) speak it via the macOS `say` Tauri command, (b) post it
  // as a notification so it's also visible. Once per session.
  useEffect(() => {
    if (localStorage.getItem('loom_speak_briefing') !== 'true') return;
    if (sessionStorage.getItem('loom_briefing_played') === '1') return;
    sessionStorage.setItem('loom_briefing_played', '1');
    (async () => {
      try {
        const { text } = await getBriefing();
        addNotification({ type: 'info', title: 'Today', message: text, autoRemoveMs: 8000 });
        const tauri = (window as unknown as { __TAURI__?: { core?: { invoke?: (cmd: string, args: object) => Promise<unknown> } } }).__TAURI__;
        if (tauri?.core?.invoke) {
          tauri.core.invoke('speak_briefing', { text }).catch(() => {});
        }
      } catch {
        // backend may be down on boot — silent
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sunday ≥ 21:00 auto-trigger: ensure a cached weekly review exists for the
  // just-ending week, then fire one notification per week.
  useEffect(() => {
    const now = new Date();
    if (now.getDay() !== 0 || now.getHours() < 21) return; // only Sun 9pm onward

    const isoWeek = getISOWeek(now);
    const storageKey = 'loom_last_review_week';
    if (localStorage.getItem(storageKey) === isoWeek) return; // already triggered this week

    const reviewWeekStart = lastMonday(now); // Monday at the start of the just-ending week
    const weekStartISO = reviewWeekStart.toISOString();

    (async () => {
      try {
        let row = await getCachedWeeklyReview(weekStartISO);
        if (!row) {
          row = await generateWeeklyReview(weekStartISO);
        }
        addNotification({
          type: 'info',
          title: 'Your weekly review is ready',
          message: row.markdown.length > 100 ? row.markdown.slice(0, 97) + '…' : row.markdown,
          actionable: true,
          actionLabel: 'Open',
          actionFn: () => openWeeklyReview(row!.markdown, weekStartISO),
        });
        localStorage.setItem(storageKey, isoWeek);
      } catch {
        // fail silently — not critical
      }
    })();
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
    { key: keybinds.snooze_week.key,    ctrl: keybinds.snooze_week.ctrl,    meta: keybinds.snooze_week.meta,    shift: keybinds.snooze_week.shift,    handler: () => { if (dest === 'calendar') window.dispatchEvent(new CustomEvent('loom-snooze-selected', { detail: { days: 7 } })); } },
    { key: keybinds.snooze_day.key,     ctrl: keybinds.snooze_day.ctrl,     meta: keybinds.snooze_day.meta,     shift: keybinds.snooze_day.shift,     handler: () => { if (dest === 'calendar') window.dispatchEvent(new CustomEvent('loom-snooze-selected', { detail: { days: 1 } })); } },
    { key: 'i', ctrl: false, meta: false, shift: false, handler: () => setInboxOpen(o => !o) },
    { key: keybinds.command_palette.key, ctrl: keybinds.command_palette.ctrl, meta: keybinds.command_palette.meta, shift: keybinds.command_palette.shift, force: true, handler: (e) => { e.preventDefault(); setPaletteOpen(o => !o); } },
  ], [keybinds, toggleSidebar, goTo, dest, nav, openEventEditor, setInboxOpen]));

  const topBarKind = (dest === 'home' ? 'home' : dest === 'tasks' ? 'tasks' : dest === 'focus' ? 'focus' : dest === 'settings' ? 'settings' : 'calendar') as Parameters<typeof TopBar>[0]['kind'];

  // Only Settings has sidebar content. Calendar renders its own sidebar inside CalendarPage.
  const showContextSidebar = dest === 'settings';

  return (
    <div className={styles.shell}>
      <AppDrawer active={dest} onNavigate={goTo} inboxCount={inboxCount} />

      {showContextSidebar && (
        <ContextSidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar}>
          <SettingsSidebarContent />
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
        <ConfirmBar items={confirmItems} onResolve={resolveConfirm} />
        {inboxOpen && <InboxPanel onClose={() => setInboxOpen(false)} timelines={appTimelines} />}
        <div className={styles.content}>
          <Routes>
            <Route path="/home"                        element={<HomePage />} />
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
            <Route path="*"                            element={<Navigate to="/home" replace />} />
          </Routes>
          <ModalRoot onSaved={() => setReloadKey(k => k + 1)} />
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
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
