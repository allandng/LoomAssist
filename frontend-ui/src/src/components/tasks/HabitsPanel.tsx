import { useEffect, useMemo, useState } from 'react';
import styles from './HabitsPanel.module.css';
import { listHabits, listHabitEntries, createHabit, deleteHabit, logHabit, deleteHabitEntry } from '../../api';
import type { Habit, HabitEntry } from '../../types';
import { useNotifications } from '../../store/notifications';

const WEEKS = 12;

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function intensityClass(filled: boolean, isToday: boolean): string {
  return [
    filled ? styles.cellFilled : styles.cellEmpty,
    isToday ? styles.cellToday : '',
  ].filter(Boolean).join(' ');
}

export function HabitsPanel() {
  const { addNotification } = useNotifications();
  const [habits, setHabits]   = useState<Habit[]>([]);
  const [entries, setEntries] = useState<Record<number, HabitEntry[]>>({});
  const [adding, setAdding]   = useState(false);
  const [newName, setNewName] = useState('');

  const loadAll = async () => {
    try {
      const list = await listHabits();
      setHabits(list);
      const allEntries: Record<number, HabitEntry[]> = {};
      await Promise.all(list.map(async h => {
        try { allEntries[h.id] = await listHabitEntries(h.id); }
        catch { allEntries[h.id] = []; }
      }));
      setEntries(allEntries);
    } catch { /* backend may be down — silent */ }
  };

  useEffect(() => { loadAll(); }, []);

  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const anchorEnd = new Date(today);
    anchorEnd.setDate(anchorEnd.getDate() + (6 - today.getDay()));
    const anchorStart = new Date(anchorEnd);
    anchorStart.setDate(anchorStart.getDate() - (WEEKS * 7 - 1));
    const arr: Date[] = [];
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = new Date(anchorStart);
      d.setDate(anchorStart.getDate() + i);
      arr.push(d);
    }
    return { arr, todayStr: isoDate(today) };
  }, []);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    try {
      await createHabit({ name });
      setNewName('');
      setAdding(false);
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Could not create habit' });
    }
  }

  async function handleToggle(habit: Habit, date: string) {
    const list = entries[habit.id] ?? [];
    const existing = list.find(e => e.date === date);
    try {
      if (existing) {
        await deleteHabitEntry(habit.id, existing.id);
      } else {
        await logHabit(habit.id, date, 1);
      }
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Could not log habit' });
    }
  }

  async function handleDelete(h: Habit) {
    if (!window.confirm(`Delete habit "${h.name}"?`)) return;
    try {
      await deleteHabit(h.id);
      await loadAll();
    } catch {
      addNotification({ type: 'error', title: 'Could not delete habit' });
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span>Habits</span>
        <button className={styles.miniBtn} onClick={() => setAdding(a => !a)} title="Add habit">+</button>
      </div>

      {adding && (
        <div className={styles.addRow}>
          <input
            className="loom-field"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Habit name…"
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            style={{ fontSize: 12 }}
            autoFocus
          />
          <button className="loom-btn-primary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={handleAdd}>Add</button>
        </div>
      )}

      {habits.length === 0 && !adding && (
        <div className={styles.empty}>No habits yet. Click + to add one.</div>
      )}

      {habits.map(h => {
        const dateSet = new Set((entries[h.id] ?? []).map(e => e.date));
        return (
          <div key={h.id} className={styles.habit}>
            <div className={styles.habitHeader}>
              <span className={styles.habitName}>{h.name}</span>
              <button className={styles.deleteBtn} onClick={() => handleDelete(h)} aria-label={`Delete ${h.name}`}>×</button>
            </div>
            <div className={styles.grid}>
              {days.arr.map((d, i) => {
                const ds = isoDate(d);
                const filled = dateSet.has(ds);
                const isFuture = ds > days.todayStr;
                return (
                  <button
                    key={i}
                    className={intensityClass(filled, ds === days.todayStr)}
                    onClick={() => !isFuture && handleToggle(h, ds)}
                    title={`${ds}${filled ? ' — done' : ''}`}
                    style={{
                      ...(filled ? { background: h.color } : null),
                      opacity: isFuture ? 0.3 : 1,
                      cursor: isFuture ? 'default' : 'pointer',
                    }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
