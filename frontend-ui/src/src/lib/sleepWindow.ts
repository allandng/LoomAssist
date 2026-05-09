export interface SleepWindowPrefs {
  enabled: boolean;
  time: string; // "HH:MM"
}

export interface SleepWindowWarning {
  message: string;
}

const TIME_RE = /^\d{2}:\d{2}$/;
const DEFAULT_TIME = '23:00';

export function loadSleepWindowPrefs(): SleepWindowPrefs {
  const enabled = localStorage.getItem('loom_sleep_window_enabled') === '1';
  const raw = localStorage.getItem('loom_sleep_window_time') ?? DEFAULT_TIME;
  const time = TIME_RE.test(raw) ? raw : DEFAULT_TIME;
  return { enabled, time };
}

export function saveSleepWindowPrefs(p: SleepWindowPrefs): void {
  localStorage.setItem('loom_sleep_window_enabled', p.enabled ? '1' : '0');
  localStorage.setItem('loom_sleep_window_time', p.time);
}

export function checkSleepWindow(
  startISO: string,
  endISO: string,
  allDay: boolean,
  prefs: SleepWindowPrefs = loadSleepWindowPrefs(),
): SleepWindowWarning | null {
  if (!prefs.enabled) return null;
  if (allDay) return null;

  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const [thH, thM] = prefs.time.split(':').map(Number);
  const thresholdMins = thH * 60 + thM;

  const sameDate =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  const endMins = end.getHours() * 60 + end.getMinutes();
  const crosses = !sameDate || endMins > thresholdMins;
  if (!crosses) return null;

  return { message: formatSleepWindowMessage(end, prefs.time) };
}

function formatSleepWindowMessage(end: Date, threshold: string): string {
  const endLabel = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const thLabel = formatThresholdLabel(threshold);
  return `Ends at ${endLabel}, past your ${thLabel} wind-down.`;
}

function formatThresholdLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
