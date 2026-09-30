// Monochrome provider marks (currentColor only) for connection surfaces.
// No brand colors: a simple "G", the Apple silhouette, the Microsoft 2×2 grid
// and a generic calendar-server glyph for CalDAV.

import type { ConnectionKind } from '../../api';

export type ProviderGlyphKind = ConnectionKind | 'microsoft' | 'generic';

export function ProviderGlyph({ kind, size = 18, className }: { kind: ProviderGlyphKind; size?: number; className?: string }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    'aria-hidden': true as const,
    focusable: 'false' as const,
    className,
  };
  switch (kind) {
    case 'google':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
          <path d="M20 12h-8" />
          <path d="M19.5 9.5A8 8 0 1 0 20 12" />
        </svg>
      );
    case 'caldav_icloud':
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3.1 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.6-1-2.7-3.9zM14 5.5c.7-.8 1.1-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
        </svg>
      );
    case 'microsoft':
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <rect x="3" y="3" width="8" height="8" rx="0.5" />
          <rect x="13" y="3" width="8" height="8" rx="0.5" />
          <rect x="3" y="13" width="8" height="8" rx="0.5" />
          <rect x="13" y="13" width="8" height="8" rx="0.5" />
        </svg>
      );
    case 'caldav_generic':
    case 'generic':
    default:
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
          <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" />
          <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
        </svg>
      );
  }
}
