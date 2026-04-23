// Shared tokens, icons, and components for LoomAssist v2.0

const LA_TOKENS = {
  bgMain: '#0B1120',       // deeper than v1.5 for better contrast layering
  bgPanel: '#121B2E',      // sidebars, cards
  bgElevated: '#1A2540',   // raised surfaces: modals, hover rows
  bgSubtle: '#0F172A',     // even darker input wells
  border: '#1F2A44',
  borderStrong: '#2B3A5C',
  textMain: '#F1F5FA',
  textMuted: '#8A97B2',
  textDim: '#5D6B86',
  accent: '#6366F1',
  accentSoft: 'rgba(99,102,241,0.14)',
  accentHover: '#818CF8',
  success: '#10B981',
  warning: '#D97706',
  error: '#EF4444',
  info: '#3B82F6',
  progress: '#6366F1',
  // Timeline swatches (desaturated jewel tones)
  tl: {
    school: '#6366F1',
    work: '#10B981',
    personal: '#F59E0B',
    health: '#EC4899',
    family: '#06B6D4',
    errands: '#8B5CF6',
  },
};

const LA_FONT = `'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
const LA_MONO = `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`;

// ---- ICONS (tiny, stroke-based) ----
const Icon = ({ d, size = 16, stroke = 'currentColor', fill = 'none', strokeWidth = 1.6, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
    {typeof d === 'string' ? <path d={d} /> : d}
  </svg>
);

const Icons = {
  calendar: <><rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2v4M16 2v4"/></>,
  tasks: <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 6h6M14 9h4M14 16h6M14 19h4"/></>,
  focus: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
  mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  chevronLeft: <path d="m15 6-6 6 6 6"/>,
  chevronRight: <path d="m9 6 6 6-6 6"/>,
  chevronDown: <path d="m6 9 6 6 6-6"/>,
  sync: <><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></>,
  more: <><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/></>,
  check: <path d="M4 12l5 5L20 6"/>,
  x: <path d="M6 6l12 12M18 6 6 18"/>,
  drag: <><circle cx="9" cy="6" r="1.3" fill="currentColor"/><circle cx="15" cy="6" r="1.3" fill="currentColor"/><circle cx="9" cy="12" r="1.3" fill="currentColor"/><circle cx="15" cy="12" r="1.3" fill="currentColor"/><circle cx="9" cy="18" r="1.3" fill="currentColor"/><circle cx="15" cy="18" r="1.3" fill="currentColor"/></>,
  play: <path d="M7 5v14l12-7z" fill="currentColor" stroke="none"/>,
  pause: <><rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/></>,
  reset: <><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></>,
  filter: <path d="M4 5h16l-6 8v6l-4-2v-4z"/>,
  link: <><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  kanban: <><rect x="3" y="4" width="5" height="16" rx="1.2"/><rect x="10" y="4" width="5" height="10" rx="1.2"/><rect x="17" y="4" width="4" height="13" rx="1.2"/></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></>,
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>,
  pin: <path d="M12 2l3 5 5 1-3.5 4 1 6L12 15l-5.5 3 1-6L4 8l5-1z" fill="none"/>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
  upload: <><path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/></>,
  doc: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 1-1 1.7M12 17h.01"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
};

// Little keyboard-key pill
const Kbd = ({ children, small }) => (
  <kbd style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    minWidth: small ? 16 : 20, height: small ? 16 : 20, padding: '0 5px',
    fontSize: small ? 9.5 : 10.5, fontWeight: 500, fontFamily: LA_MONO,
    color: LA_TOKENS.textMuted, background: LA_TOKENS.bgSubtle,
    border: `1px solid ${LA_TOKENS.border}`, borderRadius: 4,
    lineHeight: 1,
  }}>{children}</kbd>
);

// Pill-ish chip
const Chip = ({ children, color, style }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 5,
    fontSize: 10.5, fontWeight: 600, padding: '2px 7px',
    borderRadius: 20, color: color || LA_TOKENS.accent,
    background: color ? `${color}22` : LA_TOKENS.accentSoft,
    ...style,
  }}>{children}</span>
);

// Timeline dot
const TLDot = ({ color, size = 8, style }) => (
  <span style={{
    width: size, height: size, borderRadius: '50%',
    background: color, flexShrink: 0, display: 'inline-block', ...style
  }} />
);

// ---- APP DRAWER (56px rail) ----
function AppDrawer({ active = 'calendar' }) {
  const items = [
    { id: 'calendar', label: 'Calendar', icon: Icons.calendar, k: '1' },
    { id: 'tasks',    label: 'Task Board', icon: Icons.tasks, k: '' },
    { id: 'focus',    label: 'Focus Mode', icon: Icons.focus, k: 'F' },
    { id: 'settings', label: 'Settings',  icon: Icons.settings, k: '' },
  ];
  return (
    <div style={{
      width: 56, background: LA_TOKENS.bgPanel, borderRight: `1px solid ${LA_TOKENS.border}`,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '14px 0', gap: 4, flexShrink: 0,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: `linear-gradient(135deg, ${LA_TOKENS.accent}, #A78BFA)`,
        display: 'grid', placeItems: 'center', color: 'white',
        fontFamily: LA_MONO, fontWeight: 700, fontSize: 13, marginBottom: 14,
      }}>L</div>
      {items.map(it => {
        const isActive = it.id === active;
        return (
          <div key={it.id} title={`${it.label}${it.k ? `  ·  ${it.k}` : ''}`} style={{
            width: 40, height: 40, borderRadius: 10,
            display: 'grid', placeItems: 'center',
            color: isActive ? LA_TOKENS.accent : LA_TOKENS.textMuted,
            background: isActive ? LA_TOKENS.accentSoft : 'transparent',
            cursor: 'pointer', position: 'relative',
          }}>
            <Icon d={it.icon} size={18} />
            {isActive && <div style={{
              position: 'absolute', left: -8, top: 8, bottom: 8, width: 2,
              background: LA_TOKENS.accent, borderRadius: 2,
            }} />}
          </div>
        );
      })}
      <div style={{ flex: 1 }} />
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: LA_TOKENS.bgElevated, display: 'grid', placeItems: 'center',
        color: LA_TOKENS.textMuted, fontSize: 11, fontWeight: 600,
        border: `1px solid ${LA_TOKENS.border}`,
      }}>AN</div>
    </div>
  );
}

// ---- TOP BAR ----
function TopBar({ kind = 'calendar', dateLabel = 'April 2026', view = 'Month', onView, unread = 3, showBell = true, right }) {
  const views = ['Month', 'Week', 'Day', 'Agenda'];
  return (
    <div style={{
      height: 56, display: 'flex', alignItems: 'center', gap: 14,
      padding: '0 18px', borderBottom: `1px solid ${LA_TOKENS.border}`,
      background: LA_TOKENS.bgMain, flexShrink: 0,
    }}>
      {kind === 'calendar' && (
        <>
          {/* View switcher */}
          <div style={{
            display: 'flex', background: LA_TOKENS.bgPanel,
            border: `1px solid ${LA_TOKENS.border}`, borderRadius: 8, padding: 2, gap: 2,
          }}>
            {views.map((v, i) => {
              const active = v === view;
              return (
                <div key={v} onClick={() => onView?.(v)} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                  color: active ? LA_TOKENS.textMain : LA_TOKENS.textMuted,
                  background: active ? LA_TOKENS.bgElevated : 'transparent',
                  cursor: 'pointer',
                }}>
                  {v}
                  <Kbd small>{i + 1}</Kbd>
                </div>
              );
            })}
          </div>
          {/* Date nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button style={barIconBtn}><Icon d={Icons.chevronLeft} size={16} /></button>
            <button style={{
              ...barIconBtn, width: 'auto', padding: '0 10px', fontSize: 12, fontWeight: 500,
              color: LA_TOKENS.textMain,
            }}>Today</button>
            <button style={barIconBtn}><Icon d={Icons.chevronRight} size={16} /></button>
            <div style={{ fontSize: 14, fontWeight: 600, marginLeft: 6, color: LA_TOKENS.textMain }}>
              {dateLabel} <Icon d={Icons.chevronDown} size={12} style={{ marginLeft: 2, color: LA_TOKENS.textMuted, verticalAlign: 'middle' }} />
            </div>
          </div>
        </>
      )}
      {kind !== 'calendar' && (
        <div style={{ fontSize: 14, fontWeight: 600, color: LA_TOKENS.textMain }}>
          {kind === 'tasks' ? 'Task Board' : kind === 'focus' ? 'Focus Mode' : 'Settings'}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {right}

      {/* Search */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: LA_TOKENS.bgPanel, border: `1px solid ${LA_TOKENS.border}`,
        borderRadius: 8, padding: '0 10px', width: 220, height: 32,
      }}>
        <Icon d={Icons.search} size={14} stroke={LA_TOKENS.textMuted} />
        <span style={{ fontSize: 12, color: LA_TOKENS.textDim, flex: 1 }}>Search events, timelines…</span>
        <Kbd small>/</Kbd>
      </div>

      {/* AI Quick-Add */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: LA_TOKENS.bgPanel, border: `1px solid ${LA_TOKENS.border}`,
        borderRadius: 8, padding: '0 10px', width: 280, height: 32,
      }}>
        <div style={{
          width: 20, height: 20, borderRadius: '50%', background: LA_TOKENS.accentSoft,
          display: 'grid', placeItems: 'center', color: LA_TOKENS.accent,
        }}>
          <Icon d={Icons.mic} size={12} />
        </div>
        <span style={{ fontSize: 12, color: LA_TOKENS.textDim, flex: 1 }}>
          Ask AI…  <span style={{ color: LA_TOKENS.textMuted }}>"lunch Friday at 1pm"</span>
        </span>
      </div>

      {/* Sync indicator */}
      <div title="Last sync 2 min ago" style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 11, color: LA_TOKENS.textMuted,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: LA_TOKENS.success, boxShadow: `0 0 6px ${LA_TOKENS.success}` }} />
        Synced
      </div>

      {/* Bell */}
      {showBell && (
        <div style={{ position: 'relative' }}>
          <button style={barIconBtn}><Icon d={Icons.bell} size={16} /></button>
          {unread > 0 && (
            <div style={{
              position: 'absolute', top: 2, right: 2,
              minWidth: 14, height: 14, padding: '0 3px',
              background: LA_TOKENS.error, color: 'white',
              fontSize: 9, fontWeight: 700, borderRadius: 20,
              display: 'grid', placeItems: 'center', lineHeight: 1,
            }}>{unread > 9 ? '9+' : unread}</div>
          )}
        </div>
      )}

      <button style={barIconBtn}><Icon d={Icons.settings} size={16} /></button>
    </div>
  );
}

const barIconBtn = {
  width: 32, height: 32, borderRadius: 8, border: 'none',
  background: 'transparent', color: LA_TOKENS.textMuted,
  display: 'grid', placeItems: 'center', cursor: 'pointer',
};

// Section header (used in sidebars)
const SectionLabel = ({ children, right }) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 14px', marginBottom: 8,
  }}>
    <div style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: LA_TOKENS.textDim,
    }}>{children}</div>
    {right}
  </div>
);

Object.assign(window, {
  LA_TOKENS, LA_FONT, LA_MONO,
  Icon, Icons, Kbd, Chip, TLDot,
  AppDrawer, TopBar, SectionLabel,
});
