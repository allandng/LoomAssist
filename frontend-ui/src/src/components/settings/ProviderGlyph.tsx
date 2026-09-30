// Monochrome provider marks (currentColor) for sign-in and connection surfaces.
// Deliberately simple silhouettes — no brand colours, so they sit quietly in
// both themes and in high contrast.

export type ProviderId = 'google' | 'apple' | 'microsoft' | 'icloud' | 'caldav' | 'email';

const FILLED: Record<'google' | 'apple' | 'microsoft', string> = {
  google:
    'M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4c-.2 1.2-.9 2.3-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z' +
    'M12 21.5c2.7 0 4.9-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6c1.6 3.2 5 5.4 8.9 5.4z' +
    'M6.4 13.5c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9V7.1H3.1C2.4 8.5 2 10 2 11.6s.4 3.1 1.1 4.5l3.3-2.6z' +
    'M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 3 14.7 2 12 2 8.1 2 4.7 4.2 3.1 7.4l3.3 2.6c.8-2.4 3-4.1 5.6-4.1z',
  apple:
    'M16.4 12.7c0-2.4 2-3.5 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.6.9-.8 0-1.9-.9-3.1-.8C6.6 7.3 5.2 8.2 4.4 9.6c-1.7 2.9-.4 7.2 1.2 9.5.8 1.1 1.7 2.4 3 2.4 1.2 0 1.6-.8 3.1-.8 1.4 0 1.8.8 3.1.8 1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.6-1-2.6-3.8z' +
    'M14.1 5.6c.7-.8 1.1-1.9 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z',
  microsoft:
    'M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z',
};

export function ProviderGlyph({ id, size = 16, className }: { id: ProviderId; size?: number; className?: string }) {
  if (id === 'google' || id === 'apple' || id === 'microsoft') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
        <path d={FILLED[id]} />
      </svg>
    );
  }
  // Stroke glyphs for the non-brand providers.
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, focusable: 'false' as const, className };
  if (id === 'icloud') {
    return (
      <svg {...common}>
        <path d="M17.5 19a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.4 12.1 3.5 3.5 0 0 0 7 19h10.5z" />
      </svg>
    );
  }
  if (id === 'email') {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </svg>
    );
  }
  // caldav — a server stack
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <path d="M7 7h.01M7 17h.01" />
    </svg>
  );
}
