import { useState, useEffect, useCallback, useRef } from 'react';
import styles from './PomodoroPanel.module.css';
import { Icon, Icons } from '../shared/Icon';
import { TLDot } from '../shared/TLDot';
import type { Task, Calendar } from '../../types';
import { timelineColor } from '../../lib/eventUtils';

type TimerMode = 'work' | 'short-break' | 'long-break';

interface PomodoroSettings {
  work: number;         // minutes
  shortBreak: number;
  longBreak: number;
  rounds: number;
  soundOnTick: boolean;
  desktopNotif: boolean;
}

const DEFAULT_SETTINGS: PomodoroSettings = {
  work: 25, shortBreak: 5, longBreak: 15, rounds: 4,
  soundOnTick: false, desktopNotif: true,
};

interface SessionEntry { time: string; task: string }

interface PomodoroPanelProps {
  activeTaskId: number | null;
  tasks: Task[];
  timelines: Calendar[];
}

function pad(n: number): string { return String(Math.floor(n)).padStart(2, '0'); }
function formatTime(secs: number): string { return `${pad(secs / 60)}:${pad(secs % 60)}`; }

export function PomodoroPanel({ activeTaskId, tasks, timelines }: PomodoroPanelProps) {
  const [settings, setSettings] = useState<PomodoroSettings>(DEFAULT_SETTINGS);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<TimerMode>('work');
  const [round, setRound] = useState(1);
  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(DEFAULT_SETTINGS.work * 60);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [clock, setClock] = useState(new Date());

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalSecs = (m: TimerMode) => {
    if (m === 'work') return settings.work * 60;
    if (m === 'short-break') return settings.shortBreak * 60;
    return settings.longBreak * 60;
  };

  const progress = (totalSecs(mode) - timeLeft) / totalSecs(mode);
  const SIZE = 180, STROKE = 10;
  const R = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * R;

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Countdown
  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          setRunning(false);
          handleSessionComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSessionComplete() {
    if (mode === 'work') {
      const activeTask = tasks.find(t => t.id === activeTaskId);
      setSessions(prev => [{
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        task: activeTask?.note ?? 'Untitled task',
      }, ...prev].slice(0, 10));

      if (settings.desktopNotif && Notification.permission === 'granted') {
        new Notification('Pomodoro complete!', { body: 'Time for a break.' });
      }

      const newRound = round + 1;
      if (newRound > settings.rounds) {
        setMode('long-break');
        setTimeLeft(settings.longBreak * 60);
        setRound(1);
      } else {
        setRound(newRound);
        setMode('short-break');
        setTimeLeft(settings.shortBreak * 60);
      }
    } else {
      setMode('work');
      setTimeLeft(settings.work * 60);
    }
  }

  const handlePauseResume = useCallback(() => setRunning(r => !r), []);

  const handleReset = useCallback(() => {
    setRunning(false);
    setTimeLeft(totalSecs(mode));
  }, [mode, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateSetting<K extends keyof PomodoroSettings>(key: K, delta: number) {
    setSettings(prev => {
      const s = { ...prev };
      const v = (prev[key] as number) + delta;
      (s as Record<string, number | boolean>)[key] = Math.max(key === 'rounds' ? 2 : 1, v);
      return s;
    });
  }

  const modeLabel = mode === 'work' ? 'WORK' : mode === 'short-break' ? 'SHORT BREAK' : 'LONG BREAK';
  const activeTask = tasks.find(t => t.id === activeTaskId);
  const activeTaskColor = activeTask ? timelineColor(timelines, activeTask.event_id) : 'var(--text-dim)';

  return (
    <div className={styles.panel}>
      {/* Clock */}
      <div className={styles.clock}>
        <div className={styles.clockDate}>
          {clock.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}
        </div>
        <div className={styles.clockTime}>
          {clock.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          <span className={styles.clockSecs}>:{pad(clock.getSeconds())}</span>
        </div>
      </div>

      <div className={styles.divider} />

      {/* Ring */}
      <div className={styles.ringWrap}>
        <svg width={SIZE} height={SIZE} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={SIZE/2} cy={SIZE/2} r={R} stroke="var(--border)" strokeWidth={STROKE} fill="none" />
          <circle
            cx={SIZE/2} cy={SIZE/2} r={R}
            stroke="var(--accent)" strokeWidth={STROKE} fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - progress)}
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </svg>
        <div className={styles.ringCenter}>
          <div className={styles.ringMode}>{modeLabel}</div>
          <div className={styles.ringTime}>{formatTime(timeLeft)}</div>
          <div className={styles.ringRound}>Round {round} of {settings.rounds}</div>
        </div>
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <button className={styles.pauseBtn} onClick={handlePauseResume}>
          <Icon d={running ? Icons.pause : Icons.play} size={12} stroke="white" />
          {running ? 'Pause' : 'Start'}
        </button>
        <button className={styles.iconCtrl} onClick={handleReset} title="Reset">
          <Icon d={Icons.reset} size={13} />
        </button>
        <button
          className={`${styles.iconCtrl} ${editing ? styles.iconCtrlActive : ''}`}
          onClick={() => setEditing(v => !v)}
          title="Settings"
        >
          <Icon d={Icons.settings} size={13} />
        </button>
      </div>

      {/* Round dots */}
      <div className={styles.roundDots}>
        {Array.from({ length: settings.rounds }, (_, i) => (
          <span
            key={i}
            className={styles.roundDot}
            style={{
              background: i < round - 1 ? 'var(--accent)' : i === round - 1 ? 'var(--accent-soft)' : 'var(--bg-subtle)',
              border: i === round - 1 ? '1.5px solid var(--accent)' : '1px solid var(--border)',
            }}
          />
        ))}
      </div>

      {/* Active task */}
      {activeTask && (
        <div className={styles.activeTask}>
          <div className={styles.activeLabel}>FOCUSING ON</div>
          <div className={styles.activeTitle}>
            <TLDot color={activeTaskColor} size={6} />
            {activeTask.note || `Task #${activeTask.id}`}
          </div>
        </div>
      )}

      {/* Inline settings */}
      {editing && (
        <div className={styles.settingsBox}>
          <div className={styles.settingsTitle}>TIMER SETTINGS</div>
          {([
            { label: 'Work',              key: 'work' as const,       unit: 'min' },
            { label: 'Short break',       key: 'shortBreak' as const, unit: 'min' },
            { label: 'Long break',        key: 'longBreak' as const,  unit: 'min' },
            { label: 'Rounds before long',key: 'rounds' as const,     unit: '' },
          ] as const).map(s => (
            <div key={s.key} className={styles.settingRow}>
              <span className={styles.settingLabel}>{s.label}</span>
              <div className={styles.stepper}>
                <button onClick={() => updateSetting(s.key, -1)}>−</button>
                <span>{settings[s.key]}</span>
                <button onClick={() => updateSetting(s.key, 1)}>+</button>
              </div>
              {s.unit && <span className={styles.settingUnit}>{s.unit}</span>}
            </div>
          ))}
          <div className={styles.divider} />
          {([
            { label: 'Sound on tick',        key: 'soundOnTick' as const },
            { label: 'Desktop notification', key: 'desktopNotif' as const },
          ] as const).map(s => (
            <div key={s.key} className={styles.settingRow}>
              <span className={styles.settingLabel}>{s.label}</span>
              <button
                className={`${styles.toggle} ${settings[s.key] ? styles.toggleOn : ''}`}
                onClick={() => setSettings(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
              />
            </div>
          ))}
        </div>
      )}

      {/* Session history */}
      {sessions.length > 0 && (
        <div className={styles.history}>
          <div className={styles.historyHeader}>
            <Icon d={Icons.chevronDown} size={10} /> TODAY · {sessions.length} POMODORO{sessions.length !== 1 ? 'S' : ''}
          </div>
          {sessions.map((s, i) => (
            <div key={i} className={styles.historyRow}>
              <span className={styles.historyTime}>{s.time}</span>
              <span className={styles.historyTask}>{s.task}</span>
              <Icon d={Icons.check} size={10} stroke="var(--success)" strokeWidth={2.5} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
