import type { ReactNode, CSSProperties } from 'react';

interface IconProps {
  d: string | ReactNode;
  size?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}

/**
 * 24×24 stroke icon. Pass one of `Icons.*` (a JSX fragment) or a raw path
 * string. Always `aria-hidden` — put the accessible name on the control.
 */
export function Icon({
  d,
  size = 16,
  stroke = 'currentColor',
  fill = 'none',
  strokeWidth = 1.75,
  style,
  className,
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {typeof d === 'string' ? <path d={d} /> : d}
    </svg>
  );
}

export const Icons = {
  /* ── Navigation ────────────────────────────────────────────────────── */
  home:     <><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/></>,
  calendar: <><rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2v4M16 2v4"/></>,
  tasks:    <><rect x="3" y="5" width="7" height="7" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/><path d="M14 8h7M14 18h7"/><path d="m5 8 1.3 1.3L8.5 7"/></>,
  focus:    <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/></>,
  inbox:    <><path d="M4 4h16v16H4z" fill="none"/><path d="M4 13h4l2 3h4l2-3h4"/><path d="M4 4h16v16H4z"/></>,
  book:     <><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20"/><path d="M9 7h7"/></>,
  journal:  <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
  graduation: <><path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/><path d="M22 9v6"/></>,

  /* ── Actions ───────────────────────────────────────────────────────── */
  search:   <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
  mic:      <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></>,
  bell:     <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>,
  plus:     <path d="M12 5v14M5 12h14"/>,
  minus:    <path d="M5 12h14"/>,
  check:    <path d="M4 12l5 5L20 6"/>,
  x:        <path d="M6 6l12 12M18 6 6 18"/>,
  more:     <><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/></>,
  moreVertical: <><circle cx="12" cy="5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/></>,
  drag:     <><circle cx="9" cy="6" r="1.3" fill="currentColor"/><circle cx="15" cy="6" r="1.3" fill="currentColor"/><circle cx="9" cy="12" r="1.3" fill="currentColor"/><circle cx="15" cy="12" r="1.3" fill="currentColor"/><circle cx="9" cy="18" r="1.3" fill="currentColor"/><circle cx="15" cy="18" r="1.3" fill="currentColor"/></>,
  play:     <path d="M7 5v14l12-7z" fill="currentColor" stroke="none"/>,
  pause:    <><rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/></>,
  stop:     <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>,
  reset:    <><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></>,
  refresh:  <><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/></>,
  sync:     <><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></>,
  filter:   <path d="M4 5h16l-6 8v6l-4-2v-4z"/>,
  sort:     <><path d="M7 4v16M7 20l-3-3M7 20l3-3"/><path d="M17 20V4M17 4l-3 3M17 4l3 3"/></>,
  link:     <><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></>,
  externalLink: <><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
  upload:   <><path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/></>,
  download: <><path d="M12 4v12M6 10l6 6 6-6"/><path d="M4 20h16"/></>,
  pencil:   <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>,
  copy:     <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  trash:    <><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></>,
  archive:  <><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/></>,
  pin:      <path d="M12 2l3 5 5 1-3.5 4 1 6L12 15l-5.5 3 1-6L4 8l5-1z" fill="none"/>,
  star:     <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>,
  logOut:   <><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
  send:     <><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></>,
  sparkles: <><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M5 18l.7 1.8L7.5 20.5l-1.8.7L5 23l-.7-1.8-1.8-.7 1.8-.7z"/><path d="M19 3l.5 1.2 1.2.5-1.2.5L19 6.4l-.5-1.2-1.2-.5 1.2-.5z"/></>,
  zap:      <path d="M13 2 4 14h7l-1 8 9-12h-7z"/>,
  command:  <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>,
  keyboard: <><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></>,

  /* ── Chevrons & arrows ─────────────────────────────────────────────── */
  chevronLeft:  <path d="m15 6-6 6 6 6"/>,
  chevronRight: <path d="m9 6 6 6-6 6"/>,
  chevronDown:  <path d="m6 9 6 6 6-6"/>,
  chevronUp:    <path d="m6 15 6-6 6 6"/>,
  chevronsLeft: <path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/>,
  chevronsRight:<path d="m13 17 5-5-5-5M6 17l5-5-5-5"/>,
  arrowRight:   <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
  arrowLeft:    <><path d="M19 12H5"/><path d="m11 18-6-6 6-6"/></>,
  arrowUp:      <><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></>,
  arrowDown:    <><path d="M12 5v14"/><path d="m18 13-6 6-6-6"/></>,

  /* ── Objects ───────────────────────────────────────────────────────── */
  clock:    <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  timer:    <><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5"/><path d="M10 2h4M12 2v3"/></>,
  alarm:    <><circle cx="12" cy="13" r="7"/><path d="M12 10v3l2 1.5"/><path d="M5 4 2 7M19 4l3 3"/></>,
  repeat:   <><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>,
  mapPin:   <><path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></>,
  tag:      <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1" fill="currentColor"/></>,
  flag:     <><path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/></>,
  hash:     <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>,
  layers:   <><path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></>,
  grid:     <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  kanban:   <><rect x="3" y="4" width="5" height="16" rx="1.2"/><rect x="10" y="4" width="5" height="10" rx="1.2"/><rect x="17" y="4" width="4" height="13" rx="1.2"/></>,
  list:     <><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></>,
  columns:  <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></>,
  sidebar:  <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>,
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>,
  mail:     <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
  doc:      <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></>,
  file:     <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></>,
  folder:   <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>,
  user:     <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  users:    <><circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 13.5a6.5 6.5 0 0 1 4 6.5"/></>,
  lock:     <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
  shield:   <><path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/></>,
  cloud:    <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/>,
  wifi:     <><path d="M2 8.5a16 16 0 0 1 20 0"/><path d="M5 12a11 11 0 0 1 14 0"/><path d="M8.5 15.5a6 6 0 0 1 7 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></>,
  monitor:  <><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  sun:      <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  moon:     <path d="M21 13.5A8.5 8.5 0 0 1 10.5 3a8.5 8.5 0 1 0 10.5 10.5z"/>,
  palette:  <><circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2" fill="currentColor"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor"/><circle cx="16" cy="10" r="1.2" fill="currentColor"/><path d="M12 21a2.5 2.5 0 0 1 0-5h1.5a2 2 0 0 0 0-4H12"/></>,
  eye:      <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff:   <><path d="M3 3l18 18"/><path d="M10.6 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.2 4.1"/><path d="M6.6 6.6A15 15 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></>,
  target:   <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></>,
  coffee:   <><path d="M4 8h13a4 4 0 0 1 0 8h-1"/><path d="M4 8v6a5 5 0 0 0 5 5h3a5 5 0 0 0 5-5V8"/><path d="M8 3v2M12 3v2"/></>,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4"/>,
  trendingUp: <><path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/></>,
  chart:    <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  bookmark: <path d="M6 3h12v18l-6-4-6 4z"/>,
  smile:    <><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2"/><path d="M9 9.5h.01M15 9.5h.01"/></>,
  meh:      <><circle cx="12" cy="12" r="9"/><path d="M8.5 15h7"/><path d="M9 9.5h.01M15 9.5h.01"/></>,
  frown:    <><circle cx="12" cy="12" r="9"/><path d="M15.5 16s-1.3-2-3.5-2-3.5 2-3.5 2"/><path d="M9 9.5h.01M15 9.5h.01"/></>,

  /* ── Status ────────────────────────────────────────────────────────── */
  help:     <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 1-1 1.7M12 17h.01"/></>,
  info:     <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
  warning:  <><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/></>,
  alertCircle: <><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></>,
  checkCircle: <><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 5-5"/></>,
  xCircle:  <><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></>,
  circle:   <circle cx="12" cy="12" r="8"/>,
  circleDot:<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></>,
  loader:   <><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></>,
} as const;

export type IconName = keyof typeof Icons;
