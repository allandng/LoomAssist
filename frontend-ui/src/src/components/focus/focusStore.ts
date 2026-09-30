/**
 * Focus-session state shared by the Focus page, the Task Board and Home.
 *
 * Everything lives in localStorage so it survives a reload and is visible to
 * every page. Every write dispatches `loom-focus-changed` on `window`; the
 * `useFocusVersion` hook subscribes to that event (and to cross-window
 * `storage` events) so consumers re-read the store when it changes.
 *
 * Keys
 *   loom:focus:activeTaskId  number | null   task the running pomodoro is attributed to
 *   loom:focus:pinned        number[]        task ids pinned in the Focus sidebar
 *   loom:focus:doneAt        {[taskId]: ISO} when a task was last marked done
 *   loom:focus:sessions      FocusSession[]  local ledger of completed focus sessions
 *   loom:focus:pomodoro      PomodoroSettings (owned by PomodoroPanel)
 */
import { useSyncExternalStore } from 'react';
import type { Task } from '../../types';

export const FOCUS_CHANGED_EVENT = 'loom-focus-changed';
export const ACTIVE_TASK_KEY = 'loom:focus:activeTaskId';
export const PINNED_KEY = 'loom:focus:pinned';
export const DONE_AT_KEY = 'loom:focus:doneAt';
export const SESSIONS_KEY = 'loom:focus:sessions';

export interface FocusSession {
  completed_at: string;      // ISO datetime
  duration_minutes: number;
}

const SESSION_CAP = 400;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode / quota) — state stays in memory */
  }
}

let version = 0;

function notify(): void {
  version += 1;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FOCUS_CHANGED_EVENT));
}

/* ── Active task ─────────────────────────────────────────────────────────── */

export function getActiveTaskId(): number | null {
  const v = read<unknown>(ACTIVE_TASK_KEY, null);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function setActiveTaskId(id: number | null): void {
  if (id == null) {
    try { localStorage.removeItem(ACTIVE_TASK_KEY); } catch { /* ignore */ }
  } else {
    write(ACTIVE_TASK_KEY, id);
  }
  notify();
}

/* ── Pinned tasks ────────────────────────────────────────────────────────── */

export function getPinnedIds(): number[] {
  const v = read<unknown>(PINNED_KEY, []);
  return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
}

export function isPinned(id: number): boolean {
  return getPinnedIds().includes(id);
}

export function togglePinned(id: number): void {
  const cur = getPinnedIds();
  write(PINNED_KEY, cur.includes(id) ? cur.filter(p => p !== id) : [...cur, id]);
  notify();
}

/* ── Completion timestamps ("Done today") ────────────────────────────────── */

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Record (or clear) the moment a task was marked done. Call from every toggle. */
export function markTaskDone(taskId: number, done: boolean): void {
  const map = read<Record<string, string>>(DONE_AT_KEY, {});
  if (done) map[String(taskId)] = new Date().toISOString();
  else delete map[String(taskId)];
  write(DONE_AT_KEY, map);
  notify();
}

/** Tasks that are complete AND were marked done today (local time). */
export function doneTodayCount(tasks: Task[], now: Date = new Date()): number {
  const map = read<Record<string, string>>(DONE_AT_KEY, {});
  const today = localDateKey(now);
  let n = 0;
  for (const t of tasks) {
    if (!t.is_complete) continue;
    const iso = map[String(t.id)];
    if (!iso) continue;
    const d = new Date(iso);
    if (!isNaN(d.getTime()) && localDateKey(d) === today) n += 1;
  }
  return n;
}

/* ── Local session ledger (Home "Focus this week" tile) ──────────────────── */

export function recordLocalSession(s: FocusSession): void {
  const list = read<FocusSession[]>(SESSIONS_KEY, []);
  list.push(s);
  write(SESSIONS_KEY, list.slice(-SESSION_CAP));
  notify();
}

export function focusMinutesBetween(from: Date, to: Date): number {
  const list = read<FocusSession[]>(SESSIONS_KEY, []);
  let total = 0;
  for (const s of list) {
    const t = new Date(s.completed_at).getTime();
    if (isNaN(t) || t < from.getTime() || t >= to.getTime()) continue;
    total += Number(s.duration_minutes) || 0;
  }
  return total;
}

/* ── React subscription ──────────────────────────────────────────────────── */

function subscribe(cb: () => void): () => void {
  const onStorage = () => { version += 1; cb(); };
  window.addEventListener(FOCUS_CHANGED_EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(FOCUS_CHANGED_EVENT, cb);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Re-renders the caller whenever the focus store changes. Read the store
 * (getPinnedIds / doneTodayCount / focusMinutesBetween) inside a `useMemo`
 * keyed on the returned version.
 */
export function useFocusVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

export function useActiveTaskId(): number | null {
  return useSyncExternalStore(subscribe, getActiveTaskId, () => null);
}
