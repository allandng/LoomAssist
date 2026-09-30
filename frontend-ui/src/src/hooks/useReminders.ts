import { useEffect, useRef } from 'react';
import type { Event } from '../types';

type NotifFn = (n: { title: string; message?: string; type: 'info' | 'success' | 'warning' | 'error' | 'progress' }) => void;

const ENABLED_KEY = 'loom_reminders_enabled';

function remindersEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) !== 'false'; } catch { return true; }
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Fires in-app + system reminders for events that have `reminder_minutes` set.
 * Respects Settings → Notifications → Event reminders. Skips reminders more than
 * 60 seconds in the past so a page wake doesn't replay a backlog.
 */
export function useReminders(events: Event[], addNotification: NotifFn) {
  const timerIdsRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    Object.values(timerIdsRef.current).forEach(clearTimeout);
    timerIdsRef.current = {};
    if (!remindersEnabled()) return;

    for (const ev of events) {
      if (!ev.reminder_minutes) continue;

      const triggerMs = new Date(ev.start_time).getTime() - ev.reminder_minutes * 60_000;
      const delta = triggerMs - Date.now();

      if (delta < -60_000) continue; // older than 60s — wake-up guard
      if (delta < 0) { fireReminder(ev, addNotification); continue; }

      timerIdsRef.current[ev.id] = setTimeout(() => fireReminder(ev, addNotification), delta);
    }

    return () => {
      Object.values(timerIdsRef.current).forEach(clearTimeout);
    };
  }, [events, addNotification]);
}

function fireReminder(ev: Event, addNotification: NotifFn) {
  if (!remindersEnabled()) return;
  const body = `Starts at ${timeLabel(ev.start_time)}`;

  addNotification({ type: 'info', title: `Reminder: ${ev.title}`, message: body });

  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    new Notification(ev.title, { body });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') new Notification(ev.title, { body });
    });
  }
}
