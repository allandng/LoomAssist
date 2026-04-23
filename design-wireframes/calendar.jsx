// Calendar page artboard

function CalendarSidebar({ collapsed = false }) {
  if (collapsed) {
    return (
      <div style={{
        width: 48, background: LA_TOKENS.bgPanel,
        borderRight: `1px solid ${LA_TOKENS.border}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '12px 0', gap: 6, flexShrink: 0,
      }}>
        <button style={{ ...collapsedBtn }}><Icon d={Icons.chevronRight} size={14} /></button>
        <div style={{ height: 1, width: 24, background: LA_TOKENS.border, margin: '6px 0' }} />
        {[LA_TOKENS.tl.school, LA_TOKENS.tl.work, LA_TOKENS.tl.personal, LA_TOKENS.tl.health, LA_TOKENS.tl.family].map((c,i) => (
          <div key={i} style={{ width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center' }}>
            <TLDot color={c} size={10} />
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <button style={{ ...collapsedBtn, background: LA_TOKENS.accent, color: 'white' }}>
          <Icon d={Icons.plus} size={14} />
        </button>
      </div>
    );
  }

  return (
    <div style={{
      width: 260, background: LA_TOKENS.bgPanel,
      borderRight: `1px solid ${LA_TOKENS.border}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      {/* Collapse header */}
      <div style={{
        height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 14px', borderBottom: `1px solid ${LA_TOKENS.border}`,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: LA_TOKENS.textMain }}>Calendar</div>
        <button style={{ ...barIconBtn2, color: LA_TOKENS.textMuted }} title="Collapse sidebar · B">
          <Icon d={Icons.chevronLeft} size={14} />
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 0' }}>
        {/* Timelines */}
        <SectionLabel right={<button style={miniPlus}><Icon d={Icons.plus} size={11} /></button>}>
          Timelines
        </SectionLabel>
        <div style={{ padding: '0 6px', marginBottom: 18 }}>
          {[
            { name: 'CS 161 — OS', color: LA_TOKENS.tl.school, checked: true },
            { name: 'Work', color: LA_TOKENS.tl.work, checked: true },
            { name: 'Personal', color: LA_TOKENS.tl.personal, checked: true },
            { name: 'Health', color: LA_TOKENS.tl.health, checked: true },
            { name: 'Family', color: LA_TOKENS.tl.family, checked: false },
            { name: 'Errands', color: LA_TOKENS.tl.errands, checked: true },
          ].map((t, i) => (
            <div key={i} style={tlRow}>
              <div style={{
                width: 14, height: 14, borderRadius: 4,
                background: t.checked ? t.color : 'transparent',
                border: `1.5px solid ${t.checked ? t.color : LA_TOKENS.borderStrong}`,
                display: 'grid', placeItems: 'center', flexShrink: 0,
              }}>
                {t.checked && <Icon d={Icons.check} size={9} stroke="#0B1120" strokeWidth={3} />}
              </div>
              <span style={{ fontSize: 12.5, color: t.checked ? LA_TOKENS.textMain : LA_TOKENS.textMuted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              <span style={{ fontSize: 10.5, color: LA_TOKENS.textDim, fontFamily: LA_MONO }}>{[14,8,5,3,2,4][i]}</span>
            </div>
          ))}
        </div>

        {/* Filters */}
        <SectionLabel>Filters</SectionLabel>
        <div style={{ padding: '0 10px', marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={filterChip}>
            <Icon d={Icons.filter} size={12} stroke={LA_TOKENS.textMuted} />
            <span style={{ fontSize: 11.5, color: LA_TOKENS.textMain }}>Has checklist</span>
            <span style={{ marginLeft: 'auto', color: LA_TOKENS.textDim, fontSize: 11 }}>12</span>
          </div>
          <div style={filterChip}>
            <Icon d={Icons.sync} size={12} stroke={LA_TOKENS.textMuted} />
            <span style={{ fontSize: 11.5, color: LA_TOKENS.textMain }}>Recurring only</span>
            <span style={{ marginLeft: 'auto', color: LA_TOKENS.textDim, fontSize: 11 }}>8</span>
          </div>
          <div style={filterChip}>
            <Icon d={Icons.clock} size={12} stroke={LA_TOKENS.textMuted} />
            <span style={{ fontSize: 11.5, color: LA_TOKENS.textMain }}>This week</span>
            <span style={{ marginLeft: 'auto', color: LA_TOKENS.textDim, fontSize: 11 }}>19</span>
          </div>
        </div>

        {/* Templates */}
        <SectionLabel right={<span style={{ color: LA_TOKENS.textDim, fontSize: 10 }}>4</span>}>
          Templates
        </SectionLabel>
        <div style={{ padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { name: 'Weekly 1:1', meta: 'Mon · 30 min · Work' },
            { name: 'Office hours', meta: 'Tue/Thu · 1 hr' },
            { name: 'Gym session', meta: '6:30 AM · Health' },
          ].map((t, i) => (
            <div key={i} style={tplCard}>
              <div style={{ fontSize: 12, fontWeight: 600, color: LA_TOKENS.textMain, marginBottom: 2 }}>{t.name}</div>
              <div style={{ fontSize: 10.5, color: LA_TOKENS.textMuted }}>{t.meta}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Pinned quick actions */}
      <div style={{
        padding: 10, borderTop: `1px solid ${LA_TOKENS.border}`,
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
      }}>
        <button style={{ ...quickBtn, background: LA_TOKENS.accent, color: 'white', gridColumn: '1 / 3' }}>
          <Icon d={Icons.plus} size={12} /> New Event <Kbd small>N</Kbd>
        </button>
        <button style={quickBtn}><Icon d={Icons.mail} size={12} /> Availability</button>
        <button style={quickBtn}><Icon d={Icons.upload} size={12} /> Import ICS</button>
        <button style={{ ...quickBtn, gridColumn: '1 / 3' }}><Icon d={Icons.doc} size={12} /> Parse Syllabus PDF</button>
      </div>
    </div>
  );
}

const tlRow = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
  borderRadius: 6, cursor: 'pointer',
};
const filterChip = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
  border: `1px solid ${LA_TOKENS.border}`, background: LA_TOKENS.bgSubtle,
};
const tplCard = {
  padding: '8px 10px', borderRadius: 6,
  border: `1px solid ${LA_TOKENS.border}`, background: LA_TOKENS.bgSubtle,
  cursor: 'pointer',
};
const quickBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  padding: '7px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 500,
  background: LA_TOKENS.bgSubtle, color: LA_TOKENS.textMain,
  border: `1px solid ${LA_TOKENS.border}`, cursor: 'pointer',
};
const miniPlus = {
  width: 18, height: 18, borderRadius: 4, border: `1px solid ${LA_TOKENS.border}`,
  background: 'transparent', color: LA_TOKENS.textMuted,
  display: 'grid', placeItems: 'center', cursor: 'pointer',
};
const collapsedBtn = {
  width: 28, height: 28, borderRadius: 6, border: 'none',
  background: 'transparent', color: LA_TOKENS.textMuted,
  display: 'grid', placeItems: 'center', cursor: 'pointer',
};
const barIconBtn2 = {
  width: 26, height: 26, borderRadius: 6, border: 'none',
  background: 'transparent',
  display: 'grid', placeItems: 'center', cursor: 'pointer',
};

// ---- MONTH GRID ----
function MonthGrid() {
  // April 2026 starts on Wednesday
  const weeks = [
    [null, null, null, 1, 2, 3, 4],
    [5, 6, 7, 8, 9, 10, 11],
    [12, 13, 14, 15, 16, 17, 18],
    [19, 20, 21, 22, 23, 24, 25],
    [26, 27, 28, 29, 30, null, null],
  ];
  const today = 23;

  const events = {
    1: [{ t: '9:00', title: 'OS Lecture', c: LA_TOKENS.tl.school }],
    2: [{ t: '10a', title: 'Standup', c: LA_TOKENS.tl.work }],
    3: [{ t: 'All day', title: 'Azores Flight →', c: LA_TOKENS.tl.personal, span: true }],
    6: [{ t: '14:00', title: 'Design review', c: LA_TOKENS.tl.work }, { t: '18:00', title: 'Yoga', c: LA_TOKENS.tl.health }],
    8: [{ t: '9:00', title: 'OS Lecture', c: LA_TOKENS.tl.school }, { t: '11a', title: 'Advisor meeting', c: LA_TOKENS.tl.school, chk: '2/5' }],
    10: [{ t: '13:00', title: 'Lunch w/ mom', c: LA_TOKENS.tl.family }],
    13: [{ t: '10a', title: 'Standup', c: LA_TOKENS.tl.work }, { t: '15:00', title: 'Therapy', c: LA_TOKENS.tl.health }],
    15: [{ t: '9:00', title: 'OS Lecture', c: LA_TOKENS.tl.school }, { t: '14:00', title: 'Study group', c: LA_TOKENS.tl.school }],
    17: [{ t: 'All day', title: 'Midterm week', c: LA_TOKENS.tl.school }],
    20: [{ t: '10a', title: 'Standup', c: LA_TOKENS.tl.work }, { t: '18:00', title: 'Climbing gym', c: LA_TOKENS.tl.health }],
    21: [{ t: '14:00', title: 'Design review', c: LA_TOKENS.tl.work }],
    22: [{ t: '9:00', title: 'OS Lecture', c: LA_TOKENS.tl.school }, { t: '12:00', title: 'Lunch — Priya', c: LA_TOKENS.tl.personal }],
    23: [{ t: '10a', title: 'OKR planning', c: LA_TOKENS.tl.work, chk: '3/6' }, { t: '13:00', title: 'Focus block', c: LA_TOKENS.tl.school }, { t: '18:30', title: 'Dinner — Sam', c: LA_TOKENS.tl.personal }],
    24: [{ t: '11a', title: 'Dentist', c: LA_TOKENS.tl.health }, { t: '15:00', title: 'Project demo', c: LA_TOKENS.tl.work }],
    27: [{ t: '10a', title: 'Standup', c: LA_TOKENS.tl.work }],
    28: [{ t: '17:00', title: 'Pick up groceries', c: LA_TOKENS.tl.errands }],
    29: [{ t: '9:00', title: 'OS Final review', c: LA_TOKENS.tl.school }, { t: '14:00', title: 'Design review', c: LA_TOKENS.tl.work }, { t: '19:00', title: 'Movie night', c: LA_TOKENS.tl.personal }],
    30: [{ t: 'All day', title: 'Conference — Boston', c: LA_TOKENS.tl.work }],
  };

  const dowHeader = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  return (
    <div style={{
      margin: 16, flex: 1, display: 'flex', flexDirection: 'column',
      background: LA_TOKENS.bgPanel, border: `1px solid ${LA_TOKENS.border}`,
      borderRadius: 10, overflow: 'hidden',
    }}>
      {/* DoW row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        borderBottom: `1px solid ${LA_TOKENS.border}`,
      }}>
        {dowHeader.map(d => (
          <div key={d} style={{
            padding: '8px 10px', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.08em', color: LA_TOKENS.textDim,
          }}>{d}</div>
        ))}
      </div>
      {/* Weeks */}
      <div style={{ flex: 1, display: 'grid', gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((w, wi) => (
          <div key={wi} style={{
            display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
            borderBottom: wi < weeks.length - 1 ? `1px solid ${LA_TOKENS.border}` : 'none',
          }}>
            {w.map((d, di) => {
              const isToday = d === today;
              const isOther = d == null;
              const evs = d ? (events[d] || []) : [];
              return (
                <div key={di} style={{
                  padding: 6, borderRight: di < 6 ? `1px solid ${LA_TOKENS.border}` : 'none',
                  background: isToday ? 'rgba(99,102,241,0.06)' : 'transparent',
                  opacity: isOther ? 0.35 : 1, minHeight: 0, overflow: 'hidden',
                  display: 'flex', flexDirection: 'column', gap: 3,
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: isToday ? 700 : 500, marginBottom: 2,
                    color: isToday ? LA_TOKENS.accent : LA_TOKENS.textMuted,
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    {isToday ? (
                      <span style={{
                        display: 'inline-grid', placeItems: 'center',
                        width: 20, height: 20, borderRadius: '50%',
                        background: LA_TOKENS.accent, color: 'white', fontSize: 10.5,
                      }}>{d}</span>
                    ) : d}
                  </div>
                  {evs.slice(0, 4).map((e, ei) => (
                    <EventPill key={ei} {...e} />
                  ))}
                  {evs.length > 4 && (
                    <div style={{ fontSize: 10, color: LA_TOKENS.textMuted, padding: '2px 4px' }}>
                      +{evs.length - 4} more
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function EventPill({ t, title, c, span, chk }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      background: span ? c : `${c}22`,
      color: span ? 'white' : c,
      fontSize: 10.5, fontWeight: 500, padding: '2px 6px',
      borderRadius: 4, overflow: 'hidden', whiteSpace: 'nowrap',
      borderLeft: span ? 'none' : `2px solid ${c}`,
    }}>
      <span style={{ fontFamily: LA_MONO, fontSize: 9.5, opacity: span ? 0.9 : 0.75 }}>{t}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: span ? 'white' : LA_TOKENS.textMain }}>{title}</span>
      {chk && <span style={{
        marginLeft: 'auto', fontSize: 9, background: LA_TOKENS.bgSubtle,
        color: LA_TOKENS.textMuted, padding: '0 4px', borderRadius: 3,
        fontFamily: LA_MONO,
      }}>{chk}</span>}
    </div>
  );
}

// ---- QUICK-PEEK HOVER CARD (overlay) ----
function QuickPeek() {
  return (
    <div style={{
      position: 'absolute', top: 280, left: 440, width: 280,
      background: LA_TOKENS.bgElevated, border: `1px solid ${LA_TOKENS.borderStrong}`,
      borderRadius: 10, padding: 14, zIndex: 50,
      boxShadow: '0 20px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <TLDot color={LA_TOKENS.tl.work} size={7} />
        <span style={{ fontSize: 10, color: LA_TOKENS.textMuted, letterSpacing: '0.04em' }}>WORK</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: LA_TOKENS.textMain, marginBottom: 2 }}>OKR planning</div>
      <div style={{ fontSize: 11.5, color: LA_TOKENS.textMuted, marginBottom: 10 }}>Thu Apr 23 · 10:00 – 11:30 AM</div>
      <div style={{
        fontSize: 11.5, color: LA_TOKENS.textMain, lineHeight: 1.5,
        padding: '8px 10px', background: LA_TOKENS.bgSubtle, borderRadius: 6, marginBottom: 10,
      }}>
        Close out Q2 priorities with <span style={{ color: LA_TOKENS.accent, background: LA_TOKENS.accentSoft, padding: '0 4px', borderRadius: 3 }}>@[design-review]</span>. Bring latest mocks.
      </div>
      <div style={{ fontSize: 10, color: LA_TOKENS.textDim, letterSpacing: '0.06em', marginBottom: 6 }}>CHECKLIST · 3 / 6</div>
      {[
        { d: true, t: 'Draft Q2 wins' }, { d: true, t: 'Pull customer anecdotes' },
        { d: true, t: 'Review Jamie’s draft' }, { d: false, t: 'Share in #team-design' },
      ].map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, padding: '3px 0',
          color: c.d ? LA_TOKENS.textMuted : LA_TOKENS.textMain,
          textDecoration: c.d ? 'line-through' : 'none',
        }}>
          <span style={{
            width: 12, height: 12, borderRadius: 3,
            border: `1.5px solid ${c.d ? LA_TOKENS.textMuted : LA_TOKENS.borderStrong}`,
            background: c.d ? LA_TOKENS.textMuted : 'transparent',
            display: 'grid', placeItems: 'center', flexShrink: 0,
          }}>
            {c.d && <Icon d={Icons.check} size={8} stroke={LA_TOKENS.bgMain} strokeWidth={3} />}
          </span>
          {c.t}
        </div>
      ))}
    </div>
  );
}

function CalendarPage({ sidebarCollapsed, showPeek }) {
  const [view, setView] = React.useState('Month');
  return (
    <div style={pageShell}>
      <AppDrawer active="calendar" />
      <CalendarSidebar collapsed={sidebarCollapsed} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
        <TopBar kind="calendar" dateLabel="April 2026" view={view} onView={setView} unread={3} />
        <MonthGrid />
        {showPeek && <QuickPeek />}
        {/* Wellness warning */}
        <div style={{
          position: 'absolute', bottom: 24, right: 24, width: 320,
          background: LA_TOKENS.bgElevated, border: `1px solid ${LA_TOKENS.border}`,
          borderLeft: `3px solid ${LA_TOKENS.warning}`,
          borderRadius: 8, padding: '10px 14px',
          display: 'flex', gap: 10, alignItems: 'flex-start',
          boxShadow: '0 10px 24px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontSize: 14, lineHeight: 1 }}>⚠</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: LA_TOKENS.textMain, marginBottom: 2 }}>Busy day ahead</div>
            <div style={{ fontSize: 11, color: LA_TOKENS.textMuted, lineHeight: 1.4 }}>
              7 events on Apr 29 — consider adding a 30 min break between 14:00 – 15:00.
            </div>
          </div>
          <button style={{ ...barIconBtn2, color: LA_TOKENS.textDim }}><Icon d={Icons.x} size={12} /></button>
        </div>
      </div>
    </div>
  );
}

const pageShell = {
  display: 'flex', height: '100%', width: '100%',
  background: LA_TOKENS.bgMain, color: LA_TOKENS.textMain,
  fontFamily: LA_FONT, overflow: 'hidden',
};

Object.assign(window, { CalendarPage, CalendarSidebar, MonthGrid, QuickPeek, pageShell, barIconBtn2, quickBtn, tplCard, filterChip, tlRow, miniPlus });
