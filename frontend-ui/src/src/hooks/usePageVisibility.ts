import { useEffect, useRef, type RefObject } from 'react';

// Returns a ref whose .current is true while the tab is visible, false when hidden.
// Polling intervals that only refresh cosmetic UI (relative-time labels, clock
// displays) should early-return inside their setInterval callback when this is
// false, so backgrounded tabs don't queue setState bursts that flush on focus.
//
// Do NOT gate active timers (Pomodoro countdown, recording timeouts) — those
// must keep advancing in the background.
export function useIsVisibleRef(): RefObject<boolean> {
  const ref = useRef(typeof document === 'undefined' ? true : !document.hidden);
  useEffect(() => {
    const on = () => { ref.current = !document.hidden; };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return ref;
}
