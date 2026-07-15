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
import { loadKeybinds, type KeybindAction } from './lib/keybindConfig';
import { UndoProvider } from './contexts/UndoContext';
import { ModalProvider } from './contexts/ModalContext';
import { CalendarNavProvider, useCalendarNav } from './contexts/CalendarNavContext';
import { useModal } from './contexts/ModalContext';
import { NotificationsProvider, useNotifications } from './store/notifications';
import { ModalRoot } from './components/modals/ModalRoot';
import { CommandPalette } from './components/CommandPalette';
import { NotifPanel } from './components/NotifPanel';
import { ShortcutSheet } from './components/shell/ShortcutSheet';
import { JumpToDate } from './components/shell/JumpToDate';
import { ConfirmBar, type ConfirmBarItem } from './components/ConfirmBar';
import { getCrashFlag, exportLogs, getCachedWeeklyReview, generateWeeklyReview, getBriefing, transcribeAudio, applyVoiceIntent } from './api';
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
  // WS3 #8 — stable imperative refetch. Save/voice paths refresh the calendar in
  // place (CalendarPage registers its loader) instead of remounting the page.
  const reloadCalendar = nav.reload;
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
  const [keybinds, setKeybinds] = useState(loadKeybinds);

  // Inbox panel state (Phase 4)
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // WS4 #8/#9 — keyboard cheat sheet + jump-to-date overlays.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [appTimelines, setAppTimelines] = useState<import('./types').Calendar[]>([]);

  useEffect(() => {
    listCalendars().then(setAppTimelines).catch(() => {});
  }, []);

  useEffect(() => {
    listInbox().then(items => setInboxCount(items.length)).catch(() => {});
  }, [inboxOpen]);

  // Semantic search toggle (Phase 6). The results dropdown itself lives in the
  // TopBar's search input (WS4 #5) — no more results-as-notification path.
  const [semanticEnabled, setSemanticEnabled] = useState(false);

  // WS4 #9 — jump to a date. On the calendar we nudge the live FullCalendar via
  // a window event; from elsewhere we route to /calendar carrying the date.
  const handleJump = useCallback((date: Date) => {
    setJumpOpen(false);
    if (dest === 'calendar') {
      window.dispatchEvent(new CustomEvent('loom-jump-date', { detail: { date: date.toISOString() } }));
    } else {
      navigate('/calendar', { state: { date: date.toISOString() } });
    }
  }, [dest, navigate]);

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
                  reloadCalendar();
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
  }, [micActive, addNotification, reloadCalendar]);

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
  // WS4 #2/#3 — one truthful keyboard registry. Every binding reads its
  // key + modifiers from keybindConfig (so Settings rebinds propagate) and the
  // Shell dispatches by the current destination. Calendar-scoped actions
  // reach CalendarPage through CalendarNavContext or a window event; the
  // duplicate per-page useShortcuts call is gone.
  useShortcuts(useMemo(() => {
    const b = (action: KeybindAction, handler: (e: KeyboardEvent) => void, force = false) => {
      const k = keybinds[action];
      return { key: k.key, ctrl: k.ctrl, meta: k.meta, shift: k.shift, force, handler };
    };
    const onCal = (fn: () => void) => () => { if (dest === 'calendar') fn(); };
    return [
      b('sidebar_toggle',  () => toggleSidebar()),
      b('focus_mode',      () => goTo('focus')),
      b('view_month',      () => dest === 'calendar' ? nav.setView('Month')  : goTo('calendar')),
      b('view_week',       onCal(() => nav.setView('Week'))),
      b('view_day',        onCal(() => nav.setView('Day'))),
      b('view_year',       onCal(() => nav.setView('Year'))),
      b('view_agenda',     onCal(() => nav.setView('Agenda'))),
      b('new_event',       () => openEventEditor()),
      b('today',           onCal(() => nav.goToday())),
      b('prev_period',     onCal(() => nav.goPrev())),
      b('next_period',     onCal(() => nav.goNext())),
      b('delete_selected', onCal(() => window.dispatchEvent(new CustomEvent('loom-delete-selected')))),
      // Backspace is a non-rebindable alias for Delete on the calendar surface.
      { key: 'Backspace', handler: () => { if (dest === 'calendar') window.dispatchEvent(new CustomEvent('loom-delete-selected')); } },
      b('snooze_week',     onCal(() => window.dispatchEvent(new CustomEvent('loom-snooze-selected', { detail: { days: 7 } })))),
      b('snooze_day',      onCal(() => window.dispatchEvent(new CustomEvent('loom-snooze-selected', { detail: { days: 1 } })))),
      b('search',          () => document.querySelector<HTMLInputElement>('.loom-search')?.focus()),
      b('inbox',           () => setInboxOpen(o => !o)),
      b('jump_date',       () => setJumpOpen(true)),
      b('shortcut_sheet',  () => setSheetOpen(o => !o)),
      b('command_palette', (e) => { e.preventDefault(); setPaletteOpen(o => !o); }, true),
    ];
  }, [keybinds, toggleSidebar, goTo, dest, nav, openEventEditor, setInboxOpen]));

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
            <Route path="/calendar"                   element={<CalendarPage />} />
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
          <ModalRoot onSaved={reloadCalendar} />
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onOpenShortcuts={() => setSheetOpen(true)} onJumpToDate={() => setJumpOpen(true)} />
          {sheetOpen && <ShortcutSheet onClose={() => setSheetOpen(false)} />}
          {jumpOpen && <JumpToDate onPick={handleJump} onClose={() => setJumpOpen(false)} />}
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
