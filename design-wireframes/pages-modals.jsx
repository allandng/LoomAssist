// Task Board page, modals, notifications, tokens

// ---- TASK BOARD PAGE ----
function TaskBoardPage() {
  const groups = [
    { label: 'CS 161 — OS', c: LA_TOKENS.tl.school, items: [
      { t: 'Review lecture 12 notes', evt: 'OS Lecture · Apr 22', p: 'med', prog: 2, total: 4 },
      { t: 'Submit PS3 by Friday', evt: 'Midterm week', p: 'high', prog: 0, total: 3, overdue: true },
      { t: 'Schedule advisor meeting', evt: 'Advisor meeting · Apr 8', p: 'low', done: true },
    ]},
    { label: 'Work', c: LA_TOKENS.tl.work, items: [
      { t: 'Finalize design system tokens', evt: 'OKR planning · Today', p: 'high', prog: 3, total: 6, active: true },
      { t: 'Draft Q2 OKRs', evt: 'OKR planning · Today', p: 'med', prog: 1, total: 5 },
      { t: 'Conference prep — Boston', evt: 'Conference · Apr 30', p: 'med', prog: 0, total: 4 },
    ]},
    { label: 'Personal', c: LA_TOKENS.tl.personal, items: [
      { t: 'Pack for Azores trip', evt: 'Azores Flight · Apr 3', p: 'low', done: true },
      { t: 'Pick restaurant for dinner', evt: 'Dinner — Sam · Today', p: 'med', prog: 0, total: 1 },
    ]},
  ];

  return (
    <div style={pageShell}>
      <AppDrawer active="tasks" />
      {/* Standalone sidebar — filters */}
      <div style={{
        width: 240, background: LA_TOKENS.bgPanel, borderRight: `1px solid ${LA_TOKENS.border}`,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        <div style={{
          height: 48, display: 'flex', alignItems: 'center', padding: '0 14px',
          borderBottom: `1px solid ${LA_TOKENS.border}`,
          fontSize: 12, fontWeight: 600,
        }}>Task Board</div>
        <div style={{ padding: 14, flex: 1, overflow: 'auto' }}>
          <SectionLabel>Group by</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 16 }}>
            {['Timeline', 'Due date', 'Priority', 'Status'].map((g, i) => (
              <div key={g} style={{
                padding: '6px 10px', borderRadius: 6, fontSize: 12,
                color: i === 0 ? LA_TOKENS.textMain : LA_TOKENS.textMuted,
                background: i === 0 ? LA_TOKENS.accentSoft : 'transparent',
                cursor: 'pointer',
              }}>{g}</div>
            ))}
          </div>
          <SectionLabel>Show</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { l: 'All', c: 8, on: true },
              { l: 'Incomplete', c: 5 },
              { l: 'Completed', c: 3 },
              { l: 'Overdue', c: 1, warn: true },
            ].map(f => (
              <div key={f.l} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                background: f.on ? LA_TOKENS.bgSubtle : 'transparent',
                border: `1px solid ${f.on ? LA_TOKENS.border : 'transparent'}`,
              }}>
                <span style={{
                  fontSize: 12, flex: 1,
                  color: f.warn ? LA_TOKENS.warning : LA_TOKENS.textMain,
                }}>{f.l}</span>
                <span style={{ fontSize: 10.5, color: LA_TOKENS.textDim, fontFamily: LA_MONO }}>{f.c}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar kind="tasks" unread={3} />
        <div style={{ padding: 20, flex: 1, overflow: 'auto' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
            {groups.map((g, gi) => (
              <div key={gi}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
                  paddingBottom: 8, borderBottom: `1px solid ${LA_TOKENS.border}`,
                }}>
                  <TLDot color={g.c} size={10} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: LA_TOKENS.textMain }}>{g.label}</span>
                  <span style={{ fontSize: 11, color: LA_TOKENS.textDim, fontFamily: LA_MONO }}>
                    {g.items.filter(i => !i.done).length} open · {g.items.length} total
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  {g.items.map((it, i) => <TaskCard key={i} it={it} tlc={g.c} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskCard({ it, tlc }) {
  const pc = it.p === 'high' ? LA_TOKENS.error : it.p === 'med' ? LA_TOKENS.warning : LA_TOKENS.textDim;
  const progPct = it.total ? Math.round((it.prog / it.total) * 100) : 0;
  return (
    <div style={{
      padding: 14, borderRadius: 10,
      background: it.active ? LA_TOKENS.bgElevated : LA_TOKENS.bgPanel,
      border: `1px solid ${it.active ? LA_TOKENS.accent : LA_TOKENS.border}`,
      opacity: it.done ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 16, height: 16, borderRadius: 4, marginTop: 2,
          border: `1.5px solid ${it.done ? LA_TOKENS.success : LA_TOKENS.borderStrong}`,
          background: it.done ? LA_TOKENS.success : 'transparent',
          display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          {it.done && <Icon d={Icons.check} size={10} stroke="#0B1120" strokeWidth={3} />}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: LA_TOKENS.textMain,
            textDecoration: it.done ? 'line-through' : 'none', marginBottom: 4,
          }}>{it.t}</div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 10.5, color: LA_TOKENS.textMuted,
          }}>
            <Icon d={Icons.link} size={10} stroke={tlc} />
            <span style={{ color: tlc }}>{it.evt}</span>
          </div>
        </div>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: pc, marginTop: 8 }} />
      </div>
      {!it.done && it.total > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: LA_TOKENS.textDim, letterSpacing: '0.06em' }}>
              CHECKLIST {it.prog}/{it.total}
            </span>
            {it.overdue && (
              <span style={{ fontSize: 10, color: LA_TOKENS.warning, fontWeight: 600 }}>OVERDUE</span>
            )}
            {it.active && (
              <span style={{ fontSize: 10, color: LA_TOKENS.accent, fontWeight: 600 }}>● FOCUSING</span>
            )}
          </div>
          <div style={{ height: 4, background: LA_TOKENS.bgSubtle, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${progPct}%`, height: '100%', background: tlc, borderRadius: 2 }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---- EVENT EDITOR MODAL ----
function EventEditorModal() {
  return (
    <ModalShell title="New event" width={560}>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <FieldLabel>Title</FieldLabel>
          <input value="OS study session" readOnly style={fieldStyle} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <FieldLabel>Start</FieldLabel>
            <input value="Thu Apr 23, 2026 · 14:00" readOnly style={fieldStyle} />
          </div>
          <div>
            <FieldLabel>End</FieldLabel>
            <input value="Thu Apr 23, 2026 · 15:30" readOnly style={fieldStyle} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: LA_TOKENS.textMuted, paddingBottom: 10 }}>
            <div style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${LA_TOKENS.borderStrong}` }} />
            All-day
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <FieldLabel>Timeline</FieldLabel>
            <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <TLDot color={LA_TOKENS.tl.school} />
              <span style={{ flex: 1 }}>CS 161 — OS</span>
              <Icon d={Icons.chevronDown} size={12} stroke={LA_TOKENS.textMuted} />
            </div>
          </div>
          <div>
            <FieldLabel>Reminder</FieldLabel>
            <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1 }}>15 min before</span>
              <Icon d={Icons.chevronDown} size={12} stroke={LA_TOKENS.textMuted} />
            </div>
          </div>
        </div>

        {/* Recurrence */}
        <div style={{
          padding: 12, borderRadius: 8,
          background: LA_TOKENS.bgSubtle, border: `1px solid ${LA_TOKENS.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Icon d={Icons.sync} size={13} stroke={LA_TOKENS.accent} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Repeat weekly</span>
            <div style={{ marginLeft: 'auto', width: 26, height: 15, borderRadius: 10, background: LA_TOKENS.accent, position: 'relative' }}>
              <div style={{ width: 11, height: 11, background: 'white', borderRadius: '50%', position: 'absolute', top: 2, left: 13 }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {['S','M','T','W','T','F','S'].map((d, i) => {
              const on = [1,3,5].includes(i);
              return (
                <div key={i} style={{
                  flex: 1, padding: '6px 0', textAlign: 'center', fontSize: 11, fontWeight: 600,
                  borderRadius: 5, cursor: 'pointer',
                  background: on ? LA_TOKENS.accent : 'transparent',
                  color: on ? 'white' : LA_TOKENS.textMuted,
                  border: `1px solid ${on ? LA_TOKENS.accent : LA_TOKENS.border}`,
                }}>{d}</div>
              );
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ fontSize: 11, color: LA_TOKENS.textMuted }}>
              Ends
              <div style={{ ...fieldStyle, fontSize: 11.5, padding: '6px 8px', marginTop: 3 }}>Jun 12, 2026</div>
            </div>
            <div style={{ fontSize: 11, color: LA_TOKENS.textMuted }}>
              Skip dates
              <div style={{ ...fieldStyle, fontSize: 11.5, padding: '6px 8px', marginTop: 3, color: LA_TOKENS.accent }}>
                + Spring break (Apr 13-17)
              </div>
            </div>
          </div>
        </div>

        <div>
          <FieldLabel>Description <span style={{ color: LA_TOKENS.textDim, fontWeight: 400, fontSize: 10 }}>· Markdown</span></FieldLabel>
          <div style={{
            ...fieldStyle, minHeight: 64, padding: 10, fontSize: 12, lineHeight: 1.5,
          }}>
            Review <span style={{ color: LA_TOKENS.accent, textDecoration: 'underline' }}>process scheduling</span> chapter.
            Pair with <span style={{ color: LA_TOKENS.accent, background: LA_TOKENS.accentSoft, padding: '0 4px', borderRadius: 3 }}>@[Study group]</span>.
          </div>
        </div>

        <div>
          <FieldLabel>Checklist <span style={{ color: LA_TOKENS.textDim, fontWeight: 400, fontSize: 10 }}>· 1/3</span></FieldLabel>
          {[
            { t: 'Re-read lecture slides', d: true },
            { t: 'Solve practice problems 4.1–4.5', d: false },
            { t: 'Draft questions for advisor', d: false },
          ].map((c, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
            }}>
              <div style={{
                width: 14, height: 14, borderRadius: 3,
                border: `1.5px solid ${c.d ? LA_TOKENS.success : LA_TOKENS.borderStrong}`,
                background: c.d ? LA_TOKENS.success : 'transparent',
                display: 'grid', placeItems: 'center',
              }}>{c.d && <Icon d={Icons.check} size={9} stroke="#0B1120" strokeWidth={3} />}</div>
              <span style={{
                fontSize: 12, color: c.d ? LA_TOKENS.textMuted : LA_TOKENS.textMain,
                textDecoration: c.d ? 'line-through' : 'none', flex: 1,
              }}>{c.t}</span>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: LA_TOKENS.accent, cursor: 'pointer', marginTop: 4 }}>+ Add item</div>
        </div>
      </div>

      <ModalFooter>
        <button style={ghostBtn}>Save as template</button>
        <div style={{ flex: 1 }} />
        <button style={ghostBtn}>Cancel</button>
        <button style={primaryBtn}>Create event <Kbd small>⏎</Kbd></button>
      </ModalFooter>
    </ModalShell>
  );
}

// ---- AVAILABILITY SENDER MODAL ----
function AvailabilityModal() {
  // mini cal — 5 weeks
  const weeks = [
    [null,null,null,1,2,3,4],
    [5,6,7,8,9,10,11],
    [12,13,14,15,16,17,18],
    [19,20,21,22,23,24,25],
    [26,27,28,29,30,null,null],
  ];
  const selected = [24, 25, 28];
  return (
    <ModalShell title="Send availability" width={620}>
      <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Left: mini cal */}
        <div>
          <FieldLabel>Pick dates</FieldLabel>
          <div style={{
            padding: 12, background: LA_TOKENS.bgSubtle, borderRadius: 8,
            border: `1px solid ${LA_TOKENS.border}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Icon d={Icons.chevronLeft} size={14} stroke={LA_TOKENS.textMuted} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>April 2026</span>
              <Icon d={Icons.chevronRight} size={14} stroke={LA_TOKENS.textMuted} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
              {['S','M','T','W','T','F','S'].map((d, i) => (
                <div key={i} style={{ textAlign: 'center', fontSize: 9, color: LA_TOKENS.textDim, padding: '4px 0', fontWeight: 600, letterSpacing: '0.04em' }}>{d}</div>
              ))}
              {weeks.flat().map((d, i) => {
                const sel = selected.includes(d);
                const today = d === 23;
                const past = d && d < 23;
                return (
                  <div key={i} style={{
                    textAlign: 'center', padding: '6px 0', fontSize: 11,
                    borderRadius: 5, cursor: d ? 'pointer' : 'default',
                    visibility: d ? 'visible' : 'hidden',
                    background: sel ? LA_TOKENS.accent : 'transparent',
                    color: sel ? 'white' : past ? LA_TOKENS.textDim : today ? LA_TOKENS.accent : LA_TOKENS.textMain,
                    fontWeight: today ? 700 : 400,
                    opacity: past && !sel ? 0.4 : 1,
                    border: today && !sel ? `1px solid ${LA_TOKENS.accent}` : '1px solid transparent',
                  }}>{d}</div>
                );
              })}
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: LA_TOKENS.textDim, marginTop: 6 }}>
            3 dates selected · click to toggle
          </div>
        </div>

        {/* Right: time windows */}
        <div>
          <FieldLabel>Time windows</FieldLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
            {[
              { date: 'Fri Apr 24', s: '09:00', e: '12:00' },
              { date: 'Sat Apr 25', s: '14:00', e: '17:00' },
              { date: 'Tue Apr 28', s: '10:00', e: '13:00', conflict: true },
            ].map((w, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 9px', borderRadius: 7,
                background: LA_TOKENS.bgSubtle, border: `1px solid ${LA_TOKENS.border}`,
              }}>
                <Chip>{w.date}</Chip>
                <span style={{ ...fieldStyle, padding: '4px 8px', fontSize: 11, width: 60 }}>{w.s}</span>
                <span style={{ color: LA_TOKENS.textDim, fontSize: 11 }}>→</span>
                <span style={{ ...fieldStyle, padding: '4px 8px', fontSize: 11, width: 60 }}>{w.e}</span>
                <Icon d={Icons.x} size={12} stroke={LA_TOKENS.textDim} style={{ cursor: 'pointer' }} />
              </div>
            ))}
          </div>

          {/* Conflict warning */}
          <div style={{
            padding: '8px 10px', borderRadius: 6, marginBottom: 12,
            background: 'rgba(217,119,6,0.08)',
            borderLeft: `3px solid ${LA_TOKENS.warning}`, fontSize: 11, color: LA_TOKENS.textMain,
          }}>
            Tue Apr 28 overlaps your OKR planning (10:00–11:30).
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <FieldLabel>Duration</FieldLabel>
              <div style={{ ...fieldStyle, fontSize: 12 }}>30 min</div>
            </div>
            <div>
              <FieldLabel>Your name</FieldLabel>
              <div style={{ ...fieldStyle, fontSize: 12 }}>Allan</div>
            </div>
          </div>

          <FieldLabel>Share link</FieldLabel>
          <div style={{
            display: 'flex', gap: 6, padding: 6,
            border: `1px solid ${LA_TOKENS.accent}66`, borderRadius: 7,
            background: LA_TOKENS.accentSoft,
          }}>
            <code style={{
              fontSize: 11, color: LA_TOKENS.textMain, fontFamily: LA_MONO,
              padding: '6px 8px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>loom.local/avail/9x2k-7f3m</code>
            <button style={{
              padding: '6px 12px', borderRadius: 5, fontSize: 11, fontWeight: 600,
              background: LA_TOKENS.accent, color: 'white', border: 'none', cursor: 'pointer',
            }}>Copy</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 10.5, color: LA_TOKENS.textMuted }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: LA_TOKENS.success, animation: 'pulse 2s infinite' }} />
            Polling for replies… 0 responses
          </div>
        </div>
      </div>

      <ModalFooter>
        <div style={{ flex: 1 }} />
        <button style={ghostBtn}>Cancel</button>
        <button style={primaryBtn}><Icon d={Icons.mail} size={12} stroke="white" /> Send link</button>
      </ModalFooter>
    </ModalShell>
  );
}

// ---- NOTIFICATION PANEL ----
function NotificationPanelArtboard() {
  return (
    <div style={pageShell}>
      <AppDrawer active="calendar" />
      <CalendarSidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
        <TopBar kind="calendar" dateLabel="April 2026" unread={4} />
        <MonthGrid />
        {/* Dim backdrop */}
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', pointerEvents: 'none',
        }} />
        {/* Panel */}
        <div style={{
          position: 'absolute', top: 64, right: 16, width: 340, maxHeight: 520,
          background: LA_TOKENS.bgElevated, border: `1px solid ${LA_TOKENS.borderStrong}`,
          borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: `1px solid ${LA_TOKENS.border}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: LA_TOKENS.textMuted }}>
              NOTIFICATIONS · 4
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={{ fontSize: 11, color: LA_TOKENS.accent, background: 'none', border: 'none', cursor: 'pointer' }}>Mark all read</button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <NotifCard type="progress" title="Parsing syllabus…" msg="BIO 202_syllabus.pdf — extracting dates" progress={0.6} shimmer />
            <NotifCard type="success" title="Priya accepted" msg="Lunch Friday 12:00 — added to Personal" action="View event" />
            <NotifCard type="warning" title="Over-scheduled day" msg="Apr 29 has 7 events. Consider breaks." />
            <NotifCard type="info" title="Sync complete" msg="14 events imported from work.ics" />
            <NotifCard type="error" title="Ollama unreachable" msg="Voice commands unavailable" action="Retry" />
          </div>
        </div>
      </div>
    </div>
  );
}

function NotifCard({ type, title, msg, action, progress, shimmer }) {
  const color = {
    success: LA_TOKENS.success, warning: LA_TOKENS.warning,
    error: LA_TOKENS.error, info: LA_TOKENS.info, progress: LA_TOKENS.progress,
  }[type];
  return (
    <div style={{
      position: 'relative', padding: '10px 12px 10px 16px',
      background: LA_TOKENS.bgSubtle, borderRadius: 8,
      border: `1px solid ${LA_TOKENS.border}`,
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: color,
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: LA_TOKENS.textMain }}>{title}</div>
        <Icon d={Icons.x} size={12} stroke={LA_TOKENS.textDim} style={{ cursor: 'pointer', flexShrink: 0 }} />
      </div>
      <div style={{ fontSize: 11, color: LA_TOKENS.textMuted, lineHeight: 1.4, marginBottom: 6 }}>{msg}</div>
      {progress !== undefined && (
        <div style={{ height: 3, background: LA_TOKENS.border, borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
          <div style={{
            width: `${progress * 100}%`, height: '100%',
            background: shimmer
              ? `linear-gradient(90deg, ${LA_TOKENS.accent} 25%, ${LA_TOKENS.accentHover} 50%, ${LA_TOKENS.accent} 75%)`
              : color,
            backgroundSize: '200% 100%',
            animation: shimmer ? 'notif-shimmer 1.5s infinite linear' : 'none',
          }} />
        </div>
      )}
      {action && (
        <div style={{ fontSize: 11, color, fontWeight: 600, cursor: 'pointer' }}>{action} →</div>
      )}
      <div style={{ fontSize: 9.5, color: LA_TOKENS.textDim, marginTop: 4 }}>2 min ago</div>
    </div>
  );
}

// ---- SHELLS ----
function ModalShell({ title, width = 520, children }) {
  return (
    <div style={{
      width: '100%', height: '100%', background: 'rgba(6, 11, 24, 0.7)',
      backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center',
      padding: 20, fontFamily: LA_FONT,
    }}>
      <div style={{
        width, maxWidth: '100%', maxHeight: '100%',
        background: LA_TOKENS.bgPanel, border: `1px solid ${LA_TOKENS.borderStrong}`,
        borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: `1px solid ${LA_TOKENS.border}`,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: LA_TOKENS.textMain }}>{title}</div>
          <button style={{
            width: 24, height: 24, borderRadius: 5, border: 'none',
            background: 'transparent', color: LA_TOKENS.textMuted,
            display: 'grid', placeItems: 'center', cursor: 'pointer',
          }}><Icon d={Icons.x} size={14} /></button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}
function ModalFooter({ children }) {
  return (
    <div style={{
      display: 'flex', gap: 8, padding: '12px 18px',
      borderTop: `1px solid ${LA_TOKENS.border}`, background: LA_TOKENS.bgSubtle,
      alignItems: 'center',
    }}>{children}</div>
  );
}
function FieldLabel({ children }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em',
      textTransform: 'uppercase', color: LA_TOKENS.textMuted, marginBottom: 5,
    }}>{children}</div>
  );
}
const fieldStyle = {
  width: '100%', padding: '8px 10px', fontSize: 12.5, fontFamily: 'inherit',
  color: LA_TOKENS.textMain, background: LA_TOKENS.bgSubtle,
  border: `1px solid ${LA_TOKENS.border}`, borderRadius: 6, outline: 'none',
};
const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
  background: LA_TOKENS.accent, color: 'white', border: 'none', cursor: 'pointer',
};
const ghostBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
  background: 'transparent', color: LA_TOKENS.textMain,
  border: `1px solid ${LA_TOKENS.border}`, cursor: 'pointer',
};

// ---- DESIGN TOKENS ARTBOARD ----
function DesignTokensArtboard() {
  const colors = [
    { name: 'bg/main', v: LA_TOKENS.bgMain, note: 'deepest bg' },
    { name: 'bg/panel', v: LA_TOKENS.bgPanel, note: 'sidebars' },
    { name: 'bg/elevated', v: LA_TOKENS.bgElevated, note: 'modals, hover' },
    { name: 'bg/subtle', v: LA_TOKENS.bgSubtle, note: 'inputs, wells' },
    { name: 'border', v: LA_TOKENS.border, note: 'dividers' },
    { name: 'border/strong', v: LA_TOKENS.borderStrong, note: 'modals, focus' },
    { name: 'text/main', v: LA_TOKENS.textMain, note: '' },
    { name: 'text/muted', v: LA_TOKENS.textMuted, note: 'secondary' },
    { name: 'text/dim', v: LA_TOKENS.textDim, note: 'tertiary' },
    { name: 'accent', v: LA_TOKENS.accent, note: 'Indigo · primary' },
    { name: 'success', v: LA_TOKENS.success, note: '' },
    { name: 'warning', v: LA_TOKENS.warning, note: '' },
    { name: 'error', v: LA_TOKENS.error, note: '' },
    { name: 'info', v: LA_TOKENS.info, note: '' },
  ];

  return (
    <div style={{
      padding: 32, background: LA_TOKENS.bgMain, color: LA_TOKENS.textMain,
      fontFamily: LA_FONT, width: '100%', height: '100%', overflow: 'auto',
    }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ fontSize: 10.5, color: LA_TOKENS.accent, letterSpacing: '0.12em', fontWeight: 700, marginBottom: 6 }}>DESIGN TOKENS · v2.0</div>
        <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Slate & Indigo, tuned</div>
        <div style={{ fontSize: 14, color: LA_TOKENS.textMuted, maxWidth: 620, lineHeight: 1.6, marginBottom: 24 }}>
          Near-greyscale surfaces with a single indigo accent. Everything else is a neutral — errors, warnings, and success shades appear only on state, not chrome. Density and type match Linear/Fantastical.
        </div>

        <TokenSection title="Color">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {colors.map(c => (
              <div key={c.name} style={{
                padding: 12, borderRadius: 8,
                border: `1px solid ${LA_TOKENS.border}`, background: LA_TOKENS.bgPanel,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 6, background: c.v,
                  border: `1px solid ${LA_TOKENS.border}`, flexShrink: 0,
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontFamily: LA_MONO, color: LA_TOKENS.textMain }}>{c.name}</div>
                  <div style={{ fontSize: 10, fontFamily: LA_MONO, color: LA_TOKENS.textDim }}>{c.v}</div>
                  {c.note && <div style={{ fontSize: 10, color: LA_TOKENS.textMuted, marginTop: 2 }}>{c.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </TokenSection>

        <TokenSection title="Timeline swatches">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {Object.entries(LA_TOKENS.tl).map(([name, v]) => (
              <div key={name} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 20,
                background: `${v}22`, color: v, fontSize: 11.5, fontWeight: 600,
              }}>
                <TLDot color={v} size={8} /> {name}
              </div>
            ))}
          </div>
        </TokenSection>

        <TokenSection title="Type scale">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { size: 28, weight: 700, name: 'display/h1', role: 'Modal titles rare' },
              { size: 20, weight: 600, name: 'h2', role: 'Page titles' },
              { size: 16, weight: 600, name: 'h3', role: 'Section headers' },
              { size: 14, weight: 600, name: 'body/strong', role: 'Top bar, card titles' },
              { size: 12.5, weight: 500, name: 'body', role: 'Default' },
              { size: 11.5, weight: 500, name: 'body/small', role: 'Secondary' },
              { size: 10.5, weight: 700, name: 'label', role: 'UPPERCASE sections · 0.06em tracking' },
            ].map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                <div style={{
                  width: 160, fontFamily: LA_MONO, fontSize: 11, color: LA_TOKENS.textMuted,
                }}>{t.name} · {t.size}px/{t.weight}</div>
                <div style={{
                  fontSize: t.size, fontWeight: t.weight, color: LA_TOKENS.textMain,
                  letterSpacing: t.name === 'label' ? '0.06em' : 0,
                  textTransform: t.name === 'label' ? 'uppercase' : 'none',
                }}>The quick brown fox</div>
                <div style={{ marginLeft: 'auto', fontSize: 11, color: LA_TOKENS.textDim }}>{t.role}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, fontSize: 11.5, color: LA_TOKENS.textMuted }}>
            <span style={{ fontFamily: LA_FONT }}>Inter 400/500/600/700</span> for UI ·
            <span style={{ fontFamily: LA_MONO, marginLeft: 6 }}>JetBrains Mono</span> for times, keyboard keys, token values.
          </div>
        </TokenSection>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <TokenSection title="Spacing · 4px base">
            {[4,6,8,10,12,14,16,20,24,32].map(s => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: s, height: 10, background: LA_TOKENS.accent, borderRadius: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontFamily: LA_MONO, color: LA_TOKENS.textMuted }}>{s}px</span>
              </div>
            ))}
          </TokenSection>

          <TokenSection title="Radius">
            {[{n:'sm',v:4},{n:'md',v:6},{n:'lg',v:8},{n:'xl',v:10},{n:'2xl',v:12},{n:'pill',v:999}].map(r => (
              <div key={r.n} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 32, height: 20, background: LA_TOKENS.bgPanel, border: `1px solid ${LA_TOKENS.border}`, borderRadius: r.v, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontFamily: LA_MONO, color: LA_TOKENS.textMuted }}>{r.n} · {r.v === 999 ? '∞' : r.v + 'px'}</span>
              </div>
            ))}
          </TokenSection>

          <TokenSection title="Shadow">
            {[
              { n: 'sm', s: '0 1px 2px rgba(0,0,0,0.3)' },
              { n: 'md', s: '0 4px 12px rgba(0,0,0,0.35)' },
              { n: 'lg', s: '0 10px 24px rgba(0,0,0,0.45)' },
              { n: 'xl', s: '0 20px 50px rgba(0,0,0,0.55)' },
            ].map(sh => (
              <div key={sh.n} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 40, height: 24, background: LA_TOKENS.bgPanel, borderRadius: 6, boxShadow: sh.s, border: `1px solid ${LA_TOKENS.border}`, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontFamily: LA_MONO, color: LA_TOKENS.textMuted }}>{sh.n}</span>
              </div>
            ))}
          </TokenSection>
        </div>

        <TokenSection title="Keyboard shortcuts">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {[
              ['N','New event'],['T','Today'],['1–4','Switch views'],
              ['F','Focus Mode'],['/','Search'],['B','Toggle sidebar'],
              ['Esc','Close modal / panel'],['⌫','Bulk delete'],['?','Shortcut ref'],
              ['⌘Z / ⇧⌘Z','Undo / Redo'],['Space','Toggle checkbox'],['↑ ↓','Navigate list'],
            ].map(([k, d], i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 6,
                border: `1px solid ${LA_TOKENS.border}`, background: LA_TOKENS.bgPanel,
              }}>
                <Kbd>{k}</Kbd>
                <span style={{ fontSize: 11.5, color: LA_TOKENS.textMuted }}>{d}</span>
              </div>
            ))}
          </div>
        </TokenSection>
      </div>
    </div>
  );
}

function TokenSection({ title, children }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: LA_TOKENS.textDim, marginBottom: 12,
      }}>{title}</div>
      {children}
    </div>
  );
}

// ---- SIDEBAR RATIONALE ARTBOARD ----
function SidebarRationaleArtboard() {
  return (
    <div style={{
      padding: 32, background: LA_TOKENS.bgMain, color: LA_TOKENS.textMain,
      fontFamily: LA_FONT, width: '100%', height: '100%', overflow: 'auto',
    }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <div style={{ fontSize: 10.5, color: LA_TOKENS.accent, letterSpacing: '0.12em', fontWeight: 700, marginBottom: 6 }}>
          SIDEBAR RATIONALE
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>What was wrong, what we changed</div>
        <div style={{ fontSize: 13.5, color: LA_TOKENS.textMuted, maxWidth: 680, lineHeight: 1.6, marginBottom: 28 }}>
          v1.5's sidebar mixed timelines, filters, export panels and search results into one scrolling column. A hamburger overlay hid collapse state. Each destination rewired the sidebar in a different way.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[
            { h: 'Problem', p: 'One sidebar tried to be five panels. Opening Export replaced Timelines entirely; users lost their place.', c: LA_TOKENS.error },
            { h: 'Fix', p: 'Dedicated App Drawer (56px rail) for destinations. Context sidebar content always matches the active destination — predictable.', c: LA_TOKENS.success },
            { h: 'Problem', p: 'Collapse was a floating button with a different hamburger in the top bar. Users couldn’t tell if the sidebar was hidden or crashed.', c: LA_TOKENS.error },
            { h: 'Fix', p: 'Single collapse chevron at the top of the sidebar. Rail stays pinned. Smooth 200ms slide. <kbd>B</kbd> toggles.', c: LA_TOKENS.success },
            { h: 'Problem', p: 'Quick actions (New event, Import, Record voice) were scattered across mic button, FAB, and hamburger menu.', c: LA_TOKENS.error },
            { h: 'Fix', p: 'Pinned "quick actions" footer in the sidebar. Always visible: <strong>+ New Event</strong>, Availability, Import, Parse PDF. AI Quick-Add moves to top bar.', c: LA_TOKENS.success },
            { h: 'Problem', p: 'Long timeline lists clipped at the bottom of the viewport. Delete button required timeline to be checked first.', c: LA_TOKENS.error },
            { h: 'Fix', p: 'Sidebar is a flex column: header, scrollable middle, pinned footer. Timeline row has a three-dot menu (rename, color, export, delete) that’s always reachable.', c: LA_TOKENS.success },
          ].map((b, i) => (
            <div key={i} style={{
              padding: 16, borderRadius: 10,
              background: LA_TOKENS.bgPanel, border: `1px solid ${LA_TOKENS.border}`,
              borderLeft: `3px solid ${b.c}`,
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: b.c, marginBottom: 6 }}>
                {b.h.toUpperCase()}
              </div>
              <div style={{ fontSize: 12.5, color: LA_TOKENS.textMain, lineHeight: 1.55 }} dangerouslySetInnerHTML={{__html: b.p}} />
            </div>
          ))}
        </div>

        <div style={{ marginTop: 32, padding: 20, borderRadius: 10, background: LA_TOKENS.bgPanel, border: `1px solid ${LA_TOKENS.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: LA_TOKENS.textDim, marginBottom: 10 }}>
            Focus Kanban — interaction rules
          </div>
          <div style={{ fontSize: 12.5, color: LA_TOKENS.textMuted, lineHeight: 1.7 }}>
            • <strong style={{ color: LA_TOKENS.textMain }}>Drag-to-move</strong>: pick up any card; columns highlight with a dashed border + indigo fill as the drop zone.<br/>
            • <strong style={{ color: LA_TOKENS.textMain }}>Click-to-move</strong>: single-click a card opens an inline menu anchored below it (Move to → Backlog / In Progress / Done, plus Edit · Pin · Delete). Keyboard: arrows navigate, Enter activates.<br/>
            • <strong style={{ color: LA_TOKENS.textMain }}>Active task</strong>: the task currently linked to the Pomodoro shows an indigo outline and a FOCUSING chip — one at a time.<br/>
            • <strong style={{ color: LA_TOKENS.textMain }}>Pomodoro settings</strong>: gear icon expands an inline editor inside the right rail (no modal). Values clamp to min/max (e.g. Work 5–90 min); bad input shows a red hairline border + inline hint.
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  TaskBoardPage, EventEditorModal, AvailabilityModal,
  NotificationPanelArtboard, DesignTokensArtboard, SidebarRationaleArtboard,
  ModalShell, ModalFooter, primaryBtn, ghostBtn, fieldStyle,
});
