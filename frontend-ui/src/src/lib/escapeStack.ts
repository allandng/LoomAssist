/**
 * A single global Escape-key stack (WS4 shell audit #14).
 *
 * Before this, several surfaces each attached their own `window` keydown
 * listener for Escape — so one press could close a modal AND clear the
 * calendar selection AND close the palette in a single tick. This module owns
 * exactly one window listener and dispatches Escape to only the top-most
 * registered handler, so layered UI dismisses one level per press.
 *
 * Usage:
 *   useEffect(() => pushEscapeHandler(() => onClose()), [onClose]);
 *
 * The returned function unsubscribes. Handlers may return `false` to signal
 * "not handled — fall through to the next handler down the stack"; any other
 * return value (including undefined) is treated as handled and stops there.
 */

type EscapeHandler = () => boolean | void;

const stack: EscapeHandler[] = [];
let listening = false;

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  // Walk from the top of the stack; the first handler that doesn't explicitly
  // decline (return false) consumes the press.
  for (let i = stack.length - 1; i >= 0; i--) {
    const result = stack[i]();
    if (result !== false) {
      e.preventDefault();
      e.stopPropagation();
      break;
    }
  }
}

function ensureListening() {
  if (listening) return;
  // Capture phase so we intercept before component-local handlers.
  window.addEventListener('keydown', onKeyDown, true);
  listening = true;
}

/**
 * Register an Escape handler on top of the stack. Returns an unsubscribe
 * function; call it on unmount / when the surface closes.
 */
export function pushEscapeHandler(fn: EscapeHandler): () => void {
  stack.push(fn);
  ensureListening();
  return () => {
    const idx = stack.lastIndexOf(fn);
    if (idx !== -1) stack.splice(idx, 1);
  };
}

/** Test/introspection helper — current stack depth. */
export function escapeStackDepth(): number {
  return stack.length;
}
