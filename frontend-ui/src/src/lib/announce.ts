/**
 * WS6 §5 — tiny pub/sub for screen-reader announcements.
 *
 * `announce(msg)` fans a string out to the single <LiveRegion/> mounted at the
 * App root, which renders it into a visually-hidden `aria-live="polite"` region.
 * Keeping this as a module-level bus (not React context) lets non-component code
 * — the keyboard move-mode in `useEventKeyNav`, for instance — post announcements
 * without threading a callback through props.
 */

type Listener = (msg: string) => void;

const listeners = new Set<Listener>();

/** Subscribe to announcements. Returns an unsubscribe function. */
export function subscribeAnnounce(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Post a polite announcement to every mounted live region. */
export function announce(msg: string): void {
  for (const fn of listeners) fn(msg);
}
