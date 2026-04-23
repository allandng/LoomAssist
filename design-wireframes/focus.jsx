// Focus Mode page — Kanban + List + Pomodoro

function FocusSidebar({ collapsed }) {
  if (collapsed) {
    return (
      <div style={{
        width: 48, background: LA_TOKENS.bgPanel,
        borderRight: `1px solid ${LA_TOKENS.border}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '12px 0', gap: 6, flexShrink: 0,
      }}>
        <button style={collapsedBtn}><Icon d={Icons.chevronRight} size={14} /></button>
      </div>
    );
  }
  return (
    <div style={{
      width: 260, background: LA_TOKENS.bgPanel,
      borderRight: `1px solid ${LA_TOKENS.border}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      <div style={{
        height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 14px', borderBottom: `1px solid ${LA_TOKENS.border}`,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Focus</div>
        <button style={{ ...barIconBtn2, color: LA_TOKENS.textMuted }}>
          <Icon d={Icons.chevronLeft} size={14} />
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 0' }}>
        <SectionLabel right={<span style={{ fontSize: 10, color: LA_TOKENS.textDim }}>TODAY</span>}>
          Up next
        </SectionLabel>
        <div style={{ padding: '0 10px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { t: '13:00', title: 'Focus block', c: LA_TOKENS.tl.school, now: true },
            { t: '15:00', title: 'Advisor call', c: LA_TOKENS.tl.school },
            { t: '18:30', title: 'Dinner — Sam', c: LA_TOKENS.tl.personal },
          ].map((e, i) => (
            <div key={i} style={{
              padding: 10, borderRadius: 8,
              border: `1px solid ${e.now ? LA_TOKENS.accent : LA_TOKENS.border}`,
              background: e.now ? LA_TOKENS.accentSoft : LA_TOKENS.bgSubtle,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <TLDot color={e.c} size={8} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: LA_TOKENS.textMain }}>{e.title}</div>
                <div style={{ fontSize: 10.5, color: LA_TOKENS.textMuted, fontFamily: LA_MONO }}>{e.t}</div>
              </div>
              {e.now && <Chip color={LA_TOKENS.accent}>NOW</Chip>}
            </div>
          ))}
        </div>

        <SectionLabel>Pinned tasks</SectionLabel>
        <div style={{ padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { t: 'Review OS midterm prep', c: LA_TOKENS.tl.school },
            { t: 'Finalize design system v2', c: LA_TOKENS.tl.work },
          ].map((p, i) => (
            <div key={i} style={{
              padding: 8, borderRadius: 6, background: LA_TOKENS.bgSubtle,
              border: `1px solid ${LA_TOKENS.border}`, fontSize: 12,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Icon d={Icons.pin} size={12} stroke={p.c} />
              <span style={{ color: LA_TOKENS.textMain }}>{p.t}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: 12, borderTop: `1px solid ${LA_TOKENS.border}` }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px', borderRadius: 6,
          background: LA_TOKENS.bgSubtle, border: `1px solid ${LA_TOKENS.border}`,
        }}>
          <div style={{
            width: 14, height: 14, borderRadius: 3,
            border: `1.5px solid ${LA_TOKENS.accent}`,
            background: LA_TOKENS.accentSoft,
          }} />
          <span style={{ fontSize: 11.5, color: LA_TOKENS.textMain }}>Only incomplete</span>
        </div>
      </div>
    </div>
  );
}

// ---- KANBAN BOARD ----
function KanbanBoard({ openMenuFor, onOpenMenu }) {
  const cols = [
    { id: 'backlog', title: 'Backlog', count: 5, cards: [
      { id: 'c1', title: 'Draft CS 161 midterm study plan', tl: 'CS 161 — OS', tlc: LA_TOKENS.tl.school, due: 'Apr 26', priority: 'high' },
      { id: 'c2', title: 'Respond to advisor email', tl: 'CS 161 — OS', tlc: LA_TOKENS.tl.school, priority: 'med' },
      { id: 'c3', title: 'Book climbing slot', tl: 'Health', tlc: LA_TOKENS.tl.health, due: 'Apr 25', priority: 'low' },
      { id: 'c4', title: 'Replace laptop charger', tl: 'Errands', tlc: LA_TOKENS.tl.errands, priority: 'low' },
      { id: 'c5', title: 'Write Q2 OKRs draft', tl: 'Work', tlc: LA_TOKENS.tl.work, priority: 'med' },
    ]},
    { id: 'doing', title: 'In Progress', count: 3, accent: true, cards: [
      { id: 'c6', title: 'Finalize design system tokens', tl: 'Work', tlc: LA_TOKENS.tl.work, due: 'Today', priority: 'high', active: true },
      { id: 'c7', title: 'Review Jamie\u2019s PR', tl: 'Work', tlc: LA_TOKENS.tl.work, priority: 'med' },
      { id: 'c8', title: 'Outline OS lecture notes', tl: 'CS 161 — OS', tlc: LA_TOKENS.tl.school, priority: 'med' },
    ]},
    { id: 'done', title: 'Done', count: 4, cards: [
      { id: 'c9', title: 'Submit expense report', tl: 'Work', tlc: LA_TOKENS.tl.work, done: true },
      { id: 'c10', title: 'Morning run', tl: 'Health', tlc: LA_TOKENS.tl.health, done: true },
      { id: 'c11', title: 'Send availability to Priya', tl: 'Personal', tlc: LA_TOKENS.tl.personal, done: true },
      { id: 'c12', title: 'Meal prep', tl: 'Personal', tlc: LA_TOKENS.tl.personal, done: true },
    ]},
  ];

  return (
    <div style={{
      flex: 1, display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`,
      gap: 14, padding: 16, minHeight: 0, overflow: 'hidden',
    }}>
      {cols.map(col => (
        <div key={col.id} style={{
          display: 'flex', flexDirection: 'column', minHeight: 0,
          background: LA_TOKENS.bgPanel, borderRadius: 10,
          border: `1px solid ${col.accent ? LA_TOKENS.accent + '66' : LA_TOKENS.border}`,
          overflow: 'hidden',
        }}>
          {/* Column header */}
          <div style={{
            padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8,
            borderBottom: `1px solid ${LA_TOKENS.border}`,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: col.accent ? LA_TOKENS.accent : LA_TOKENS.textDim,
            }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: LA_TOKENS.textMain }}>{col.title}</span>
            <span style={{ fontSize: 10.5, color: LA_TOKENS.textDim, fontFamily: LA_MONO }}>{col.count}</span>
            <div style={{ flex: 1 }} />
            <button style={{ ...barIconBtn2, color: LA_TOKENS.textMuted }}>
              <Icon d={Icons.more} size={14} />
            </button>
          </div>

          {/* Add task row */}
          <div style={{
            padding: '8px 10px', borderBottom: `1px solid ${LA_TOKENS.border}`,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 6,
              border: `1px dashed ${LA_TOKENS.border}`,
              color: LA_TOKENS.textDim, fontSize: 11.5, cursor: 'text',
            }}>
              <Icon d={Icons.plus} size={12} /> Add a task…
            </div>
          </div>

          {/* Cards */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {col.cards.map(card => (
              <KanbanCard
                key={card.id}
                card={card}
                menuOpen={openMenuFor === card.id}
                onClick={() => onOpenMenu?.(card.id)}
              />
            ))}
            {col.id === 'done' && col.cards.length === 0 && (
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                color: LA_TOKENS.textDim, fontSize: 11, gap: 6,
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: LA_TOKENS.bgSubtle,
                  display: 'grid', placeItems: 'center',
                }}>
                  <Icon d={Icons.check} size={16} stroke={LA_TOKENS.textDim} />
                </div>
                Nothing done yet
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function KanbanCard({ card, menuOpen, onClick }) {
  const pc = card.priority === 'high' ? LA_TOKENS.error : card.priority === 'med' ? LA_TOKENS.warning : LA_TOKENS.textDim;
  return (
    <div onClick={onClick} style={{
      position: 'relative',
      background: card.active ? LA_TOKENS.bgElevated : LA_TOKENS.bgSubtle,
      border: `1px solid ${card.active ? LA_TOKENS.accent : LA_TOKENS.border}`,
      borderRadius: 8, padding: '10px 11px', cursor: 'pointer',
      opacity: card.done ? 0.55 : 1,
      boxShadow: card.active ? `0 0 0 2px ${LA_TOKENS.accentSoft}` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        {card.priority && (
          <div title={card.priority} style={{
            width: 6, height: 6, borderRadius: '50%', background: pc,
            marginTop: 6, flexShrink: 0,
          }} />
        )}
        <div style={{
          fontSize: 12.5, fontWeight: 500, color: LA_TOKENS.textMain, lineHeight: 1.4,
          textDecoration: card.done ? 'line-through' : 'none', flex: 1,
        }}>{card.title}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 500, padding: '2px 6px',
          borderRadius: 4, color: card.tlc, background: `${card.tlc}1e`,
        }}>
          <Icon d={Icons.link} size={9} stroke={card.tlc} /> {card.tl}
        </div>
        {card.due && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, color: card.due === 'Today' ? LA_TOKENS.warning : LA_TOKENS.textMuted,
            fontFamily: LA_MONO,
          }}>
            <Icon d={Icons.clock} size={9} stroke={card.due === 'Today' ? LA_TOKENS.warning : LA_TOKENS.textMuted} /> {card.due}
          </div>
        )}
        {card.active && (
          <span style={{ marginLeft: 'auto', fontSize: 9.5, color: LA_TOKENS.accent, fontWeight: 600 }}>● FOCUSING</span>
        )}
      </div>

      {menuOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: LA_TOKENS.bgElevated, border: `1px solid ${LA_TOKENS.borderStrong}`,
          borderRadius: 8, padding: 4, zIndex: 30,
          boxShadow: '0 12px 24px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 9.5, color: LA_TOKENS.textDim, padding: '6px 10px 4px', letterSpacing: '0.06em' }}>MOVE TO →</div>
          {['Backlog', 'In Progress', 'Done'].map(c => (
            <div key={c} style={{
              padding: '6px 10px', borderRadius: 5, fontSize: 12,
              color: LA_TOKENS.textMain, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <TLDot color={c === 'In Progress' ? LA_TOKENS.accent : LA_TOKENS.textDim} size={6} />
              {c}
            </div>
          ))}
          <div style={{ height: 1, background: LA_TOKENS.border, margin: 4 }} />
          <div style={menuItem}>Edit…</div>
          <div style={menuItem}>Pin to sidebar</div>
          <div style={{ ...menuItem, color: LA_TOKENS.error }}>Delete</div>
        </div>
      )}
    </div>
  );
}

const menuItem = {
  padding: '6px 10px', borderRadius: 5, fontSize: 12,
  color: LA_TOKENS.textMain, cursor: 'pointer',
};

// ---- LIST VIEW ----
function ListView() {
  const groups = [
    { title: 'In Progress', color: LA_TOKENS.accent, items: [
      { t: 'Finalize design system tokens', tl: 'Work', tlc: LA_TOKENS.tl.work, due: 'Today', p: 'high', active: true },
      { t: 'Review Jamie\u2019s PR', tl: 'Work', tlc: LA_TOKENS.tl.work, p: 'med' },
      { t: 'Outline OS lecture notes', tl: 'CS 161 — OS', tlc: LA_TOKENS.tl.school, p: 'med' },
    ]},
    { title: 'Backlog', color: LA_TOKENS.textDim, items: [
      { t: 'Draft CS 161 midterm study plan', tl: 'CS 161 — OS', tlc: LA_TOKENS.tl.school, due: 'Apr 26', p: 'high' },
      { t: 'Respond to advisor email', tl: 'CS 161 — OS', tlc: LA_TOKENS.tl.school, p: 'med' },
      { t: 'Book climbing slot', tl: 'Health', tlc: LA_TOKENS.tl.health, due: 'Apr 25', p: 'low' },
      { t: 'Replace laptop charger', tl: 'Errands', tlc: LA_TOKENS.tl.errands, p: 'low' },
      { t: 'Write Q2 OKRs draft', tl: 'Work', tlc: LA_TOKENS.tl.work, p: 'med' },
    ]},
    { title: 'Done', color: LA_TOKENS.success, items: [
      { t: 'Submit expense report', tl: 'Work', tlc: LA_TOKENS.tl.work, done: true },
      { t: 'Morning run', tl: 'Health', tlc: LA_TOKENS.tl.health, done: true },
      { t: 'Send availability to Priya', tl: 'Personal', tlc: LA_TOKENS.tl.personal, done: true },
      { t: 'Meal prep', tl: 'Personal', tlc: LA_TOKENS.tl.personal, done: true },
    ]},
  ];

  return (
    <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
      <div style={{
        background: LA_TOKENS.bgPanel, borderRadius: 10,
        border: `1px solid ${LA_TOKENS.border}`, overflow: 'hidden',
      }}>
        {/* Add row */}
        <div style={{
          padding: '10px 14px', borderBottom: `1px solid ${LA_TOKENS.border}`,
          display: 'flex', alignItems: 'center', gap: 8,
          color: LA_TOKENS.textDim, fontSize: 12,
        }}>
          <Icon d={Icons.plus} size={13} /> Add task  <Kbd small>Enter</Kbd>
        </div>

        {groups.map((g, gi) => (
          <div key={g.title}>
            <div style={{
              padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 8,
              background: LA_TOKENS.bgSubtle,
              fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
              color: LA_TOKENS.textMuted, textTransform: 'uppercase',
              borderTop: gi > 0 ? `1px solid ${LA_TOKENS.border}` : 'none',
            }}>
              <Icon d={Icons.chevronDown} size={11} stroke={LA_TOKENS.textMuted} />
              {g.title}
              <span style={{ color: LA_TOKENS.textDim, fontWeight: 500 }}>· {g.items.length}</span>
            </div>
            {g.items.map((it, i) => (
              <div key={i} style={{
                padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
                borderBottom: i < g.items.length - 1 ? `1px solid ${LA_TOKENS.border}` : 'none',
                background: it.active ? LA_TOKENS.accentSoft : 'transparent',
                opacity: it.done ? 0.5 : 1,
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 4,
                  border: `1.5px solid ${it.done ? LA_TOKENS.success : LA_TOKENS.borderStrong}`,
                  background: it.done ? LA_TOKENS.success : 'transparent',
                  display: 'grid', placeItems: 'center', flexShrink: 0,
                }}>
                  {it.done && <Icon d={Icons.check} size={10} stroke="#0B1120" strokeWidth={3} />}
                </div>
                {it.p && !it.done && (
                  <div style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: it.p === 'high' ? LA_TOKENS.error : it.p === 'med' ? LA_TOKENS.warning : LA_TOKENS.textDim,
                  }} />
                )}
                <div style={{
                  fontSize: 12.5, color: LA_TOKENS.textMain, flex: 1,
                  textDecoration: it.done ? 'line-through' : 'none',
                }}>{it.t}</div>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 10, padding: '2px 6px',
                  borderRadius: 4, color: it.tlc, background: `${it.tlc}1e`,
                }}>
                  <TLDot color={it.tlc} size={5} /> {it.tl}
                </div>
                {it.due && (
                  <div style={{
                    fontSize: 10.5, color: it.due === 'Today' ? LA_TOKENS.warning : LA_TOKENS.textMuted,
                    fontFamily: LA_MONO, minWidth: 50, textAlign: 'right',
                  }}>{it.due}</div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- POMODORO ----
function PomodoroPanel({ editing, progress = 0.68 }) {
  const size = 180;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div style={{
      width: 300, flexShrink: 0, borderLeft: `1px solid ${LA_TOKENS.border}`,
      background: LA_TOKENS.bgPanel, display: 'flex', flexDirection: 'column',
      padding: 20, gap: 16,
    }}>
      {/* Running clock */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 11, color: LA_TOKENS.textDim, letterSpacing: '0.06em', marginBottom: 2 }}>
          THU APR 23
        </div>
        <div style={{ fontSize: 20, fontWeight: 500, color: LA_TOKENS.textMain, fontFamily: LA_MONO, fontVariantNumeric: 'tabular-nums' }}>
          2:47<span style={{ color: LA_TOKENS.textDim }}>:12</span> PM
        </div>
      </div>

      <div style={{ height: 1, background: LA_TOKENS.border }} />

      {/* Ring */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, position: 'relative' }}>
        <div style={{ position: 'relative', width: size, height: size }}>
          <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
            <circle cx={size/2} cy={size/2} r={r} stroke={LA_TOKENS.border} strokeWidth={stroke} fill="none" />
            <circle cx={size/2} cy={size/2} r={r}
              stroke={LA_TOKENS.accent} strokeWidth={stroke} fill="none"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - progress)}
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ fontSize: 10, color: LA_TOKENS.textDim, letterSpacing: '0.1em', marginBottom: 4 }}>WORK</div>
            <div style={{
              fontSize: 36, fontWeight: 600, color: LA_TOKENS.textMain,
              fontFamily: LA_MONO, fontVariantNumeric: 'tabular-nums',
            }}>17:08</div>
            <div style={{ fontSize: 11, color: LA_TOKENS.textMuted, marginTop: 4 }}>Round 2 of 4</div>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <button style={{
            flex: 2, padding: '10px 12px', borderRadius: 8,
            background: LA_TOKENS.accent, color: 'white', border: 'none',
            fontWeight: 600, fontSize: 12.5, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Icon d={Icons.pause} size={12} stroke="white" /> Pause
          </button>
          <button style={{
            flex: 1, padding: '10px', borderRadius: 8,
            background: LA_TOKENS.bgSubtle, color: LA_TOKENS.textMain,
            border: `1px solid ${LA_TOKENS.border}`, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon d={Icons.reset} size={13} />
          </button>
          <button style={{
            flex: 1, padding: '10px', borderRadius: 8,
            background: editing ? LA_TOKENS.accentSoft : LA_TOKENS.bgSubtle,
            color: editing ? LA_TOKENS.accent : LA_TOKENS.textMain,
            border: `1px solid ${editing ? LA_TOKENS.accent : LA_TOKENS.border}`,
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon d={Icons.settings} size={13} />
          </button>
        </div>
      </div>

      {/* Rounds dots */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{
            width: 10, height: 10, borderRadius: '50%',
            background: i < 2 ? LA_TOKENS.accent : i === 2 ? LA_TOKENS.accentSoft : LA_TOKENS.bgSubtle,
            border: i === 2 ? `1.5px solid ${LA_TOKENS.accent}` : `1px solid ${LA_TOKENS.border}`,
          }} />
        ))}
      </div>

      {/* Active task */}
      <div style={{
        padding: 10, borderRadius: 8,
        background: LA_TOKENS.bgSubtle, border: `1px solid ${LA_TOKENS.border}`,
      }}>
        <div style={{ fontSize: 9.5, color: LA_TOKENS.textDim, letterSpacing: '0.06em', marginBottom: 4 }}>
          FOCUSING ON
        </div>
        <div style={{
          fontSize: 12.5, fontWeight: 500, color: LA_TOKENS.textMain,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <TLDot color={LA_TOKENS.tl.work} size={6} />
          Finalize design system tokens
        </div>
      </div>

      {/* Settings editor inline */}
      {editing && (
        <div style={{
          padding: 12, borderRadius: 8,
          background: LA_TOKENS.bgElevated, border: `1px solid ${LA_TOKENS.accent}66`,
        }}>
          <div style={{ fontSize: 10.5, color: LA_TOKENS.textDim, letterSpacing: '0.06em', marginBottom: 10 }}>
            TIMER SETTINGS
          </div>
          {[
            { l: 'Work', v: 25, unit: 'min', min: 5, max: 90 },
            { l: 'Short break', v: 5, unit: 'min', min: 1, max: 30 },
            { l: 'Long break', v: 15, unit: 'min', min: 5, max: 60 },
            { l: 'Rounds before long', v: 4, unit: '', min: 2, max: 10 },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: LA_TOKENS.textMuted, flex: 1 }}>{s.l}</span>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: LA_TOKENS.bgSubtle, border: `1px solid ${LA_TOKENS.border}`,
                borderRadius: 5, padding: 2,
              }}>
                <button style={{ ...stepBtn }}>−</button>
                <span style={{
                  fontSize: 12, fontWeight: 600, minWidth: 28,
                  textAlign: 'center', fontFamily: LA_MONO,
                }}>{s.v}</span>
                <button style={{ ...stepBtn }}>+</button>
              </div>
              {s.unit && <span style={{ fontSize: 10.5, color: LA_TOKENS.textDim, width: 22 }}>{s.unit}</span>}
            </div>
          ))}
          <div style={{ height: 1, background: LA_TOKENS.border, margin: '10px 0' }} />
          {[
            { l: 'Sound on tick', on: false },
            { l: 'Desktop notification', on: true },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: LA_TOKENS.textMuted, flex: 1 }}>{s.l}</span>
              <div style={{
                width: 28, height: 16, borderRadius: 10,
                background: s.on ? LA_TOKENS.accent : LA_TOKENS.border,
                position: 'relative', cursor: 'pointer',
              }}>
                <div style={{
                  width: 12, height: 12, borderRadius: '50%',
                  background: 'white', position: 'absolute', top: 2,
                  left: s.on ? 14 : 2, transition: '0.15s',
                }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Session history */}
      <div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 10, letterSpacing: '0.06em', color: LA_TOKENS.textDim, marginBottom: 6,
        }}>
          <Icon d={Icons.chevronDown} size={10} stroke={LA_TOKENS.textDim} />
          TODAY · 3 POMODOROS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            { t: '9:30', task: 'OS lecture notes' },
            { t: '10:20', task: 'OS lecture notes' },
            { t: '13:10', task: 'Design system tokens' },
          ].map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5,
              color: LA_TOKENS.textMuted,
            }}>
              <span style={{ fontFamily: LA_MONO, width: 32 }}>{s.t}</span>
              <span style={{ color: LA_TOKENS.textMain, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.task}</span>
              <Icon d={Icons.check} size={10} stroke={LA_TOKENS.success} strokeWidth={2.5} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const stepBtn = {
  width: 18, height: 18, borderRadius: 3, border: 'none',
  background: 'transparent', color: LA_TOKENS.textMuted,
  fontSize: 12, cursor: 'pointer',
};

// ---- FOCUS PAGE ----
function FocusPage({ mode = 'kanban', pomoEditing = false, fullscreen = false }) {
  const [displayMode, setDisplayMode] = React.useState(mode);
  const [openMenuFor, setOpenMenuFor] = React.useState(null);

  React.useEffect(() => { setDisplayMode(mode); }, [mode]);

  return (
    <div style={pageShell}>
      {!fullscreen && <AppDrawer active="focus" />}
      {!fullscreen && <FocusSidebar />}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!fullscreen && (
          <TopBar kind="focus" unread={3} right={
            <div style={{
              display: 'flex', background: LA_TOKENS.bgPanel,
              border: `1px solid ${LA_TOKENS.border}`, borderRadius: 8, padding: 2, gap: 2,
            }}>
              {[
                { id: 'normal', label: 'Normal', icon: null },
                { id: 'fs', label: 'Fullscreen', icon: Icons.fullscreen },
              ].map((m) => {
                const active = (fullscreen ? 'fs' : 'normal') === m.id;
                return (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 500,
                    color: active ? LA_TOKENS.textMain : LA_TOKENS.textMuted,
                    background: active ? LA_TOKENS.bgElevated : 'transparent',
                    cursor: 'pointer',
                  }}>
                    {m.icon && <Icon d={m.icon} size={12} />}
                    {m.label}
                  </div>
                );
              })}
            </div>
          }/>
        )}

        {/* Display mode toggle */}
        <div style={{
          padding: '14px 16px 0', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            display: 'flex', background: LA_TOKENS.bgPanel,
            border: `1px solid ${LA_TOKENS.border}`, borderRadius: 8, padding: 2, gap: 2,
          }}>
            {[
              { id: 'kanban', icon: Icons.kanban, label: 'Kanban' },
              { id: 'list',   icon: Icons.list,   label: 'List' },
            ].map(m => {
              const active = displayMode === m.id;
              return (
                <div key={m.id} onClick={() => setDisplayMode(m.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                  color: active ? LA_TOKENS.textMain : LA_TOKENS.textMuted,
                  background: active ? LA_TOKENS.bgElevated : 'transparent',
                  cursor: 'pointer',
                }}>
                  <Icon d={m.icon} size={13} /> {m.label}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: LA_TOKENS.textMuted }}>12 tasks · 3 done today</div>
          <div style={{ flex: 1 }} />
          <Kbd>Space</Kbd>
          <span style={{ fontSize: 11, color: LA_TOKENS.textDim }}>toggle</span>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {displayMode === 'kanban'
              ? <KanbanBoard openMenuFor={openMenuFor} onOpenMenu={(id) => setOpenMenuFor(x => x === id ? null : id)} />
              : <ListView />}
          </div>
          <PomodoroPanel editing={pomoEditing} />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { FocusPage, KanbanBoard, ListView, PomodoroPanel, FocusSidebar });
