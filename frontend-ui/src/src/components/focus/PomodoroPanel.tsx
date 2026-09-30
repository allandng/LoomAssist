import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import styles from './PomodoroPanel.module.css';
import type { Task, Calendar, Event } from '../../types';
import { recordPomodoroSession } from '../../api';
import { Button, IconButton, Segmented, Switch, ProgressRing, Section, TLDot, Icon, Icons } from '../ui';
import { useShortcuts } from '../../hooks/useShortcuts';
import { recordLocalSession } from './focusStore';
import { taskColor, taskTitle } from '../tasks/taskUtils';

type TimerMode = 'work' | 'short-break' | 'long-break';
type TrayState = 'idle' | 'running' | 'break' | 'paused';

interface PomodoroSettings {
  work: number;        // minutes
  shortBreak: number;
  longBreak: number;
  rounds: number;
  sound: boolean;
  desktopNotif: boolean;
}

const SETTINGS_KEY = 'loom:focus:pomodoro';
const DEFAULT_SETTINGS: PomodoroSettings = {
  work: 25, shortBreak: 5, longBreak: 15, rounds: 4, sound: false, desktopNotif: true,
};
const HISTORY_CAP = 10;

const MODE_LABEL: Record<TimerMode, string> = { work: 'Focus', 'short-break': 'Short break', 'long-break': 'Long break' };
const MODE_KEY: Record<TimerMode, 'work' | 'shortBreak' | 'longBreak'> = { work: 'work', 'short-break': 'shortBreak', 'long-break': 'longBreak' };

type StepKey = 'work' | 'shortBreak' | 'longBreak' | 'rounds';
const STEPPERS: Array<{ key: StepKey; label: string; unit: string; min: number; max: number; step: number }> = [
  { key: 'work',       label: 'Focus length',            unit: 'min', min: 5, max: 120, step: 5 },
  { key: 'shortBreak', label: 'Short break',             unit: 'min', min: 1, max: 30,  step: 1 },
  { key: 'longBreak',  label: 'Long break',              unit: 'min', min: 5, max: 60,  step: 5 },
  { key: 'rounds',     label: 'Rounds before long break', unit: '',   min: 2, max: 12,  step: 1 },
];

interface SessionEntry { time: string; task: string }

function readSettings(): PomodoroSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PomodoroSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Tell the tray menu (src-tauri/src/lib.rs listens for `pomodoro-state-change`).
 * The dynamic import keeps browser dev working: outside Tauri the emit rejects
 * and is swallowed.
 */
function emitPomodoroState(state: TrayState): void {
  try {
    import('@tauri-apps/api/event')
      .then(m => m.emit('pomodoro-state-change', { state }))
      .catch(() => { /* not running inside Tauri */ });
  } catch {
    /* dynamic import unavailable */
  }
}

function chime(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.06;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    osc.onended = () => { void ctx.close(); };
  } catch {
    /* no audio available */
  }
}

function notifyDesktop(title: string, body: string): void {
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
  } catch {
    /* notifications unavailable */
  }
}

function pad(n: number): string { return String(Math.floor(n)).padStart(2, '0'); }
function formatTime(secs: number): string { return `${pad(secs / 60)}:${pad(secs % 60)}`; }
function secondsFor(mode: TimerMode, s: PomodoroSettings): number { return s[MODE_KEY[mode]] * 60; }

interface PomodoroPanelProps {
  activeTaskId: number | null;
  tasks: Task[];
  events: Event[];
  timelines: Calendar[];
  onClearActive: () => void;
}

/** The Focus page hero: a 220px ring around mm:ss, mode switcher, controls, settings. */
export function PomodoroPanel({ activeTaskId, tasks, events, timelines, onClearActive }: PomodoroPanelProps) {
  const [settings, setSettings] = useState<PomodoroSettings>(readSettings);
  const [editing, setEditing]   = useState(false);
  const [mode, setMode]         = useState<TimerMode>('work');
  const [round, setRound]       = useState(1);
  const [running, setRunning]   = useState(false);
  const [timeLeft, setTimeLeft] = useState(() => secondsFor('work', readSettings()));
  const [sessions, setSessions] = useState<SessionEntry[]>([]);

  // Latest values for the interval callback (which is created once per run).
  const latest = useRef({ timeLeft, mode, round, settings, activeTaskId, tasks });
  useEffect(() => {
    latest.current = { timeLeft, mode, round, settings, activeTaskId, tasks };
  });

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  }, [settings]);

  const completeSession = useCallback(() => {
    const { mode: m, round: r, settings: s, activeTaskId: taskId, tasks: list } = latest.current;
    if (m === 'work') {
      const task = list.find(t => t.id === taskId);
      const completedAt = new Date();
      setSessions(prev => [
        { time: completedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), task: task ? taskTitle(task) : 'No task' },
        ...prev,
      ].slice(0, HISTORY_CAP));
      // Backend (energy map) and local ledger (Home tile) — never block the UI on either.
      recordPomodoroSession({
        completed_at: completedAt.toISOString(),
        duration_minutes: s.work,
        mode: 'work',
        task_id: taskId ?? null,
        task_note: task?.note ?? null,
        round_num: r,
      }).catch(() => { /* offline — the local ledger still has it */ });
      recordLocalSession({ completed_at: completedAt.toISOString(), duration_minutes: s.work });
      if (s.desktopNotif) notifyDesktop('Focus session complete', 'Time for a break.');
      if (s.sound) chime();
      const nextRound = r + 1;
      if (nextRound > s.rounds) {
        setMode('long-break');
        setTimeLeft(s.longBreak * 60);
        setRound(1);
      } else {
        setRound(nextRound);
        setMode('short-break');
        setTimeLeft(s.shortBreak * 60);
      }
    } else {
      if (s.desktopNotif) notifyDesktop('Break over', 'Ready for the next round?');
      if (s.sound) chime();
      setMode('work');
      setTimeLeft(s.work * 60);
    }
    emitPomodoroState('idle');
  }, []);

  // Countdown — deliberately NOT gated on tab visibility so it keeps advancing.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const next = latest.current.timeLeft - 1;
      if (next <= 0) {
        setTimeLeft(0);
        setRunning(false);
        completeSession();
      } else {
        setTimeLeft(next);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [running, completeSession]);

  const toggleRunning = useCallback(() => {
    const next = !running;
    setRunning(next);
    emitPomodoroState(next ? (mode === 'work' ? 'running' : 'break') : 'paused');
  }, [running, mode]);

  const reset = useCallback(() => {
    setRunning(false);
    setTimeLeft(secondsFor(mode, settings));
    emitPomodoroState('idle');
  }, [mode, settings]);

  const changeMode = useCallback((m: TimerMode) => {
    setMode(m);
    setRunning(false);
    setTimeLeft(secondsFor(m, settings));
    emitPomodoroState('idle');
  }, [settings]);

  function step(key: StepKey, delta: number) {
    const def = STEPPERS.find(s => s.key === key)!;
    const value = Math.min(def.max, Math.max(def.min, settings[key] + delta));
    setSettings({ ...settings, [key]: value });
    if (!running && key !== 'rounds' && MODE_KEY[mode] === key) setTimeLeft(value * 60);
  }

  function toggleDesktopNotif(next: boolean) {
    setSettings(prev => ({ ...prev, desktopNotif: next }));
    try {
      if (next && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    } catch { /* ignore */ }
  }

  // Space starts/pauses unless a control that already handles Space is focused.
  useShortcuts(useMemo(() => [{
    key: ' ',
    handler: (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button')) return;
      e.preventDefault();
      toggleRunning();
    },
  }], [toggleRunning]));

  const total = secondsFor(mode, settings);
  const progress = total > 0 ? 1 - timeLeft / total : 0;
  const ringColor = mode === 'work' ? 'var(--accent)' : 'var(--success)';
  const activeTask = tasks.find(t => t.id === activeTaskId) ?? null;
  const activeColor = activeTask ? taskColor(activeTask, events, timelines) : null;
  const primaryLabel = running ? 'Pause' : timeLeft < total ? 'Resume' : 'Start';

  return (
    <aside className={styles.panel} aria-label="Pomodoro timer">
      <Segmented
        size="sm"
        aria-label="Timer mode"
        value={mode}
        onChange={changeMode}
        options={[
          { value: 'work',        label: 'Focus' },
          { value: 'short-break', label: 'Short break' },
          { value: 'long-break',  label: 'Long break' },
        ]}
      />

      <div className={styles.hero}>
        <ProgressRing
          value={progress}
          size={220}
          stroke={10}
          color={ringColor}
          trackColor="var(--bg-inset)"
          aria-label={`${MODE_LABEL[mode]}: ${formatTime(timeLeft)} remaining`}
        >
          <div className={styles.ringInner}>
            <span className={styles.modeLabel}>{MODE_LABEL[mode]}</span>
            <span className={styles.time}>{formatTime(timeLeft)}</span>
            <span className={styles.roundLabel}>Round {round} of {settings.rounds}</span>
          </div>
        </ProgressRing>
        <div className={styles.dots} aria-hidden="true">
          {Array.from({ length: settings.rounds }, (_, i) => (
            <span
              key={i}
              className={[styles.dot, i < round - 1 ? styles.dotDone : i === round - 1 ? styles.dotCurrent : ''].join(' ')}
            />
          ))}
        </div>
      </div>

      <div className={styles.controls}>
        <Button
          variant="primary"
          size="lg"
          icon={running ? Icons.pause : Icons.play}
          kbd="Space"
          className={styles.mainBtn}
          aria-pressed={running}
          onClick={toggleRunning}
        >
          {primaryLabel}
        </Button>
        <IconButton size="lg" variant="ghost" icon={Icons.reset} label="Reset timer" onClick={reset} />
        <IconButton
          size="lg"
          variant="ghost"
          icon={Icons.settings}
          label="Timer settings"
          active={editing}
          aria-expanded={editing}
          onClick={() => setEditing(v => !v)}
        />
      </div>

      <div className={styles.task}>
        <span className={styles.taskLabel}>Focusing on</span>
        {activeTask ? (
          <div className={styles.taskRow}>
            <TLDot color={activeColor ?? 'var(--text-dim)'} size={8} />
            <span className={styles.taskTitle} title={taskTitle(activeTask)}>{taskTitle(activeTask)}</span>
            <IconButton size="sm" icon={Icons.x} label="Clear focus task" onClick={onClearActive} />
          </div>
        ) : (
          <p className={styles.taskHint}>Pick a task on the board to attribute this session to it.</p>
        )}
      </div>

      {editing && (
        <div className={styles.settings} role="group" aria-label="Timer settings">
          {STEPPERS.map(s => (
            <div key={s.key} className={styles.settingRow}>
              <span className={styles.settingLabel}>{s.label}</span>
              <div className={styles.stepper}>
                <IconButton
                  size="sm"
                  icon={Icons.minus}
                  label={`Decrease ${s.label.toLowerCase()}`}
                  disabled={settings[s.key] <= s.min}
                  onClick={() => step(s.key, -s.step)}
                />
                <span className={styles.stepValue}>{settings[s.key]}</span>
                <IconButton
                  size="sm"
                  icon={Icons.plus}
                  label={`Increase ${s.label.toLowerCase()}`}
                  disabled={settings[s.key] >= s.max}
                  onClick={() => step(s.key, s.step)}
                />
              </div>
              <span className={styles.unit}>{s.unit}</span>
            </div>
          ))}
          <Switch
            size="sm"
            label="Sound at session end"
            checked={settings.sound}
            onChange={v => setSettings(prev => ({ ...prev, sound: v }))}
          />
          <Switch
            size="sm"
            label="Desktop notification"
            description="Notify when a session ends"
            checked={settings.desktopNotif}
            onChange={toggleDesktopNotif}
          />
        </div>
      )}

      {sessions.length > 0 && (
        <Section small title={`Today · ${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`}>
          <ul className={styles.history}>
            {sessions.map((s, i) => (
              <li key={`${s.time}-${i}`} className={styles.historyRow}>
                <span className={styles.historyTime}>{s.time}</span>
                <span className={styles.historyTask}>{s.task}</span>
                <Icon d={Icons.check} size={12} className={styles.historyCheck} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </aside>
  );
}
