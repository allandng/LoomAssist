import { useEffect, useRef } from 'react';
import type { Event } from '../types';

/** Fires native + in-app reminders for events that have reminder_minutes set.
 *  Skips reminders more than 60 seconds in the past (prevents spam on page wake). */
export function useReminders(
  events: Event[],
  addNotification: (n: { title: string; message: string; type: string }) => void,
) {
  const timerIdsRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    // Clear existing timers
    Object.values(timerIdsRef.current).forEach(clearTimeout);
    timerIdsRef.current = {};

    for (const ev of events) {
      if (!ev.reminder_minutes) continue;

      const triggerMs = new Date(ev.start_time).getTime() - ev.reminder_minutes * 60_000;
      const nowMs = Date.now();
      const delta = triggerMs - nowMs;

      if (delta < -60_000) continue; // older than 60s — skip (wake-up guard)
      if (delta < 0) {
        // Missed by < 60s — fire immediately
        fireReminder(ev, addNotification);
        continue;
      }

      timerIdsRef.current[ev.id] = setTimeout(() => {
        fireReminder(ev, addNotification);
      }, delta);
    }

    return () => {
      Object.values(timerIdsRef.current).forEach(clearTimeout);
    };
  }, [events, addNotification]);
}

function fireReminder(ev: Event, addNotification: (n: { title: string; message: string; type: string }) => void) {
  addNotification({
    type: 'info',
    title: `Reminder: ${ev.title}`,
    message: `Starting at ${new Date(ev.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
  });

  if (Notification.permission === 'granted') {
    new Notification(`⏰ ${ev.title}`, {
      body: `Starting at ${new Date(ev.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        new Notification(`⏰ ${ev.title}`, { body: ev.start_time });
      }
    });
  }
}
