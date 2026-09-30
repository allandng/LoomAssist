import { useEffect, useMemo, useState } from 'react';
import styles from './HabitsPanel.module.css';
import { listHabits, listHabitEntries, createHabit, updateHabit, deleteHabit, logHabit, deleteHabitEntry } from '../../api';
import type { Habit, HabitEntry } from '../../types';
import { useNotifications } from '../../store/notifications';
import {
  Section, IconButton, Menu, Badge, ProgressBar, Skeleton, EmptyState, TLDot, Icons,
  confirm, prompt,
} from '../ui';
import { DEFAULT_TIMELINE_COLOR } from '../../lib/colors';
import { startOfWeek, addDays, isoDate, todayISO } from './taskUtils';

const DAY_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const MAX_TARGET = 14;

/**
 * Habits with a weekly target: one row per habit with this week's progress bar
 * and seven day toggles. Add / rename / retarget go through the shared prompt
 * dialog; delete confirms.
 */
export function HabitsPanel() {
  const { addNotification } = useNotifications();
  const [habits, setHabits]     = useState<Habit[]>([]);
  const [entries, setEntries]   = useState<Record<number, HabitEntry[]>>({});
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const [reloadKey, setReload]  = useState(0);

  useEffect(() => {
    let alive = true;
    listHabits()
      .then(async list => {
        const all: Record<number, HabitEntry[]> = {};
        await Promise.all(list.map(async h => {
          try { all[h.id] = await listHabitEntries(h.id); } catch { all[h.id] = []; }
        }));
        return { list, all };
      })
      .then(({ list, all }) => {
        if (!alive) return;
        setHabits(list);
        setEntries(all);
        setError(false);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [reloadKey]);

  const reload = () => setReload(k => k + 1);

  const week = useMemo(() => {
    const start = startOfWeek(new Date());
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, []);
  const today = todayISO();

  function fail(title: string) {
    addNotification({ type: 'error', title });
  }

  async function addHabit() {
    const name = await prompt({
      title: 'New habit',
      label: 'Name',
      placeholder: 'e.g. Read 20 minutes',
      confirmLabel: 'Add',
      validate: v => (v.trim() ? null : 'Enter a name'),
    });
    if (!name) return;
    try { await createHabit({ name: name.trim() }); reload(); } catch { fail('Could not create habit'); }
  }

  async function rename(h: Habit) {
    const name = await prompt({ title: 'Rename habit', label: 'Name', defaultValue: h.name, confirmLabel: 'Save', validate: v => (v.trim() ? null : 'Enter a name') });
    if (name == null || name.trim() === h.name) return;
    try { await updateHabit(h.id, { name: name.trim() }); reload(); } catch { fail('Could not rename habit'); }
  }

  async function editTarget(h: Habit) {
    const v = await prompt({
      title: `Weekly target for "${h.name}"`,
      label: 'Times per week',
      defaultValue: String(h.target_per_week || 1),
      confirmLabel: 'Save',
      validate: val => {
        const n = Number(val.trim());
        return Number.isInteger(n) && n >= 1 && n <= MAX_TARGET ? null : `Enter a whole number from 1 to ${MAX_TARGET}`;
      },
    });
    if (v == null) return;
    try { await updateHabit(h.id, { target_per_week: Number(v.trim()) }); reload(); } catch { fail('Could not update target'); }
  }

  async function remove(h: Habit) {
    const ok = await confirm({
      title: `Delete "${h.name}"?`,
      description: 'Its check-in history is removed too.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try { await deleteHabit(h.id); reload(); } catch { fail('Could not delete habit'); }
  }

  async function toggleDay(h: Habit, date: string) {
    const existing = (entries[h.id] ?? []).find(e => e.date === date);
    try {
      if (existing) await deleteHabitEntry(h.id, existing.id);
      else await logHabit(h.id, date, 1);
      reload();
    } catch {
      fail('Could not log habit');
    }
  }

  return (
    <Section
      small
      title="Habits"
      actions={<IconButton size="sm" icon={Icons.plus} label="Add habit" onClick={addHabit} />}
    >
      {error ? (
        <div className={styles.errorRow} role="alert">
          <Badge tone="error" icon={Icons.alertCircle}>Couldn't load habits</Badge>
        </div>
      ) : loading ? (
        <div className={styles.skeleton} aria-hidden="true">
          <Skeleton height={12} width="60%" />
          <Skeleton height={4} />
          <Skeleton height={22} />
        </div>
      ) : habits.length === 0 ? (
        <EmptyState
          compact
          icon={Icons.repeat}
          title="No habits yet"
          description="Track small daily wins alongside your tasks."
          action={{ label: 'Add habit', onClick: addHabit }}
        />
      ) : (
        <ul className={styles.list}>
          {habits.map(h => {
            const dates = new Set((entries[h.id] ?? []).map(e => e.date));
            const doneThisWeek = week.filter(d => dates.has(isoDate(d))).length;
            const target = Math.max(1, h.target_per_week || 1);
            const color = h.color || DEFAULT_TIMELINE_COLOR;
            const met = doneThisWeek >= target;
            return (
              <li key={h.id} className={styles.habit}>
                <div className={styles.head}>
                  <TLDot color={color} size={8} />
                  <span className={styles.name} title={h.name}>{h.name}</span>
                  <button
                    type="button"
                    className={[styles.target, met ? styles.targetMet : ''].join(' ')}
                    onClick={() => editTarget(h)}
                    aria-label={`${doneThisWeek} of ${target} this week. Change weekly target`}
                    title="Change weekly target"
                  >
                    {doneThisWeek}/{target}
                  </button>
                  <Menu
                    align="end"
                    items={[
                      { id: 'rename', label: 'Rename', icon: Icons.pencil, onSelect: () => rename(h) },
                      { id: 'target', label: 'Set weekly target', icon: Icons.target, onSelect: () => editTarget(h) },
                      { separator: true },
                      { id: 'delete', label: 'Delete', icon: Icons.trash, danger: true, onSelect: () => remove(h) },
                    ]}
                    trigger={({ open: _open, toggle, ref, ...a }) => (
                      <IconButton ref={ref} size="sm" icon={Icons.moreVertical} label={`Options for ${h.name}`} onClick={toggle} {...a} />
                    )}
                  />
                </div>
                <ProgressBar
                  value={doneThisWeek / target}
                  color={color}
                  height={4}
                  aria-label={`${h.name}: ${doneThisWeek} of ${target} this week`}
                />
                <div className={styles.days} role="group" aria-label={`${h.name}, this week`}>
                  {week.map((d, i) => {
                    const ds = isoDate(d);
                    const done = dates.has(ds);
                    const future = ds > today;
                    return (
                      <button
                        key={ds}
                        type="button"
                        className={[styles.day, done ? styles.dayDone : '', ds === today ? styles.dayToday : ''].join(' ')}
                        style={done ? { background: color, borderColor: color } : undefined}
                        disabled={future}
                        aria-pressed={done}
                        aria-label={`${d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}${done ? ', done' : ''}`}
                        onClick={() => toggleDay(h, ds)}
                      >
                        {DAY_SHORT[i]}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
