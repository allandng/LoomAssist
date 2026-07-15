/**
 * WS6 §5 — the single persistent screen-reader live region.
 *
 * Mounted once at the App root (before the first announcement so the node
 * pre-exists in the DOM — a region added at announce-time is often missed by
 * assistive tech). `aria-live="polite"` yields to the user; assertive would
 * interrupt. Repeated identical messages re-announce because we clear the text
 * and re-set it a tick later — SRs only speak an attribute change.
 */

import { useEffect, useRef, useState } from 'react';
import { subscribeAnnounce } from '../../lib/announce';

// Visually hidden but present for AT (the standard clip-rect sr-only recipe).
const srOnly: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function LiveRegion() {
  const [msg, setMsg] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = subscribeAnnounce((next) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // Clear first, then set after a beat so an identical repeat re-announces.
      setMsg('');
      timerRef.current = setTimeout(() => setMsg(next), 50);
    });
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div aria-live="polite" aria-atomic="true" style={srOnly}>
      {msg}
    </div>
  );
}
