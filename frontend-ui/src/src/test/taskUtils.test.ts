import { describe, it, expect, beforeEach } from 'vitest';
import { groupTasks, describeDue, matchesShow, NO_TIMELINE_GROUP, isValidISODate } from '../components/tasks/taskUtils';
import { currentCourseGrade, parseGradeWeights } from '../lib/gradeProjection';
import { habitStreak, tasksDueThisWeek } from '../components/home/homeStats';
import {
  getActiveTaskId, setActiveTaskId, togglePinned, getPinnedIds, markTaskDone, doneTodayCount,
  recordLocalSession, focusMinutesBetween, FOCUS_CHANGED_EVENT,
} from '../components/focus/focusStore';
import type { Task, Event, Calendar, Assignment, HabitEntry } from '../types';

const TODAY = '2026-09-30';

function task(over: Partial<Task>): Task {
  return {
    id: 1, event_id: 0, is_complete: false, note: 'Do thing', added_at: '2026-09-01T00:00:00',
    status: 'backlog', priority: 'med', due_date: '', ...over,
  };
}

function event(id: number, calendar_id: number): Event {
  return {
    id, title: `Event ${id}`, start_time: '2026-09-30T09:00:00', end_time: '2026-09-30T10:00:00', calendar_id,
    is_recurring: false, recurrence_days: '', recurrence_end: '', description: '', unique_description: '',
    reminder_minutes: 0, external_uid: '', timezone: 'local', is_all_day: false, skipped_dates: '',
    per_day_times: '', checklist: '',
  };
}

const timelines: Calendar[] = [
  { id: 10, name: 'School', description: '', color: '#6366F1' },
  { id: 20, name: 'Work',   description: '', color: '#10B981' },
];

describe('groupTasks', () => {
  it('keeps tasks with no event under "No timeline" instead of dropping them', () => {
    const tasks = [task({ id: 1, event_id: 0 }), task({ id: 2, event_id: 99 }), task({ id: 3, event_id: 5 })];
    const groups = groupTasks(tasks, 'timeline', [event(5, 10)], timelines, TODAY);
    const school = groups.find(g => g.id === '10')!;
    const none = groups.find(g => g.id === NO_TIMELINE_GROUP)!;
    expect(school.tasks.map(t => t.id)).toEqual([3]);
    expect(none.tasks.map(t => t.id).sort()).toEqual([1, 2]);
    expect(groups.find(g => g.id === '20')!.preset.calendar_id).toBe(20);
  });

  it('always returns every fixed bucket for status / priority grouping', () => {
    expect(groupTasks([], 'status', [], [], TODAY).map(g => g.id)).toEqual(['backlog', 'doing', 'done']);
    expect(groupTasks([], 'priority', [], [], TODAY).map(g => g.id)).toEqual(['high', 'med', 'low']);
  });

  it('buckets due dates relative to today', () => {
    const tasks = [
      task({ id: 1, due_date: '2026-09-28' }),
      task({ id: 2, due_date: TODAY }),
      task({ id: 3, due_date: '2026-10-01' }),
      task({ id: 4, due_date: '2026-10-04' }),
      task({ id: 5 }),
    ];
    const byId = Object.fromEntries(groupTasks(tasks, 'due', [], [], TODAY).map(g => [g.id, g.tasks.map(t => t.id)]));
    expect(byId.overdue).toEqual([1]);
    expect(byId.today).toEqual([2]);
    expect(byId.tomorrow).toEqual([3]);
    expect(byId.week).toEqual([4]);
    expect(byId.none).toEqual([5]);
  });
});

describe('describeDue / filters', () => {
  it('describes relative due dates', () => {
    expect(describeDue('2026-09-29', TODAY)).toMatchObject({ label: 'Yesterday', tone: 'overdue' });
    expect(describeDue('2026-09-27', TODAY)).toMatchObject({ label: '3 days ago', tone: 'overdue' });
    expect(describeDue(TODAY, TODAY)).toMatchObject({ label: 'Today', tone: 'today' });
    expect(describeDue('2026-10-01', TODAY)).toMatchObject({ label: 'Tomorrow', tone: 'soon' });
    expect(describeDue('2026-11-15', TODAY)?.tone).toBe('later');
    expect(describeDue('nope', TODAY)).toBeNull();
  });

  it('applies the show filter', () => {
    const overdue = task({ due_date: '2026-09-01' });
    expect(matchesShow(overdue, 'overdue', TODAY)).toBe(true);
    expect(matchesShow({ ...overdue, is_complete: true }, 'overdue', TODAY)).toBe(false);
    expect(matchesShow(task({ is_complete: true }), 'incomplete', TODAY)).toBe(false);
  });

  it('validates ISO dates strictly', () => {
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-02-28')).toBe(true);
  });
});

describe('currentCourseGrade', () => {
  const asg = (over: Partial<Assignment>): Assignment => ({
    id: 1, course_id: 1, title: 'A', due_date: TODAY, weight_category: null, score: null, max_score: 100, event_id: null, ...over,
  });

  it('weights graded work only and counts the remainder', () => {
    const weights = parseGradeWeights('[{"name":"HW","weight":40},{"name":"Exam","weight":60}]');
    const summary = currentCourseGrade([
      asg({ id: 1, weight_category: 'HW', score: 90 }),
      asg({ id: 2, weight_category: 'Exam', score: 70 }),
      asg({ id: 3, weight_category: 'Exam', score: null }),
    ], weights);
    expect(summary.current).toBe(78);
    expect(summary.gradedCount).toBe(2);
    expect(summary.remainingCount).toBe(1);
  });

  it('returns null with nothing graded and tolerates bad weight JSON', () => {
    expect(parseGradeWeights('not json')).toEqual([]);
    expect(currentCourseGrade([asg({ score: null })], []).current).toBeNull();
  });
});

describe('homeStats', () => {
  it('counts tasks due in the next 7 days and overdue separately', () => {
    const r = tasksDueThisWeek([
      task({ id: 1, due_date: '2026-09-29' }),
      task({ id: 2, due_date: TODAY }),
      task({ id: 3, due_date: '2026-10-06' }),
      task({ id: 4, due_date: '2026-10-07' }),
      task({ id: 5, due_date: TODAY, is_complete: true }),
    ], TODAY);
    expect(r).toEqual({ due: 2, overdue: 1 });
  });

  it('computes a habit streak ending today or yesterday', () => {
    const e = (date: string): HabitEntry => ({ id: 1, habit_id: 1, date, count: 1 });
    expect(habitStreak([e('2026-09-30'), e('2026-09-29'), e('2026-09-27')], TODAY)).toBe(2);
    expect(habitStreak([e('2026-09-29'), e('2026-09-28')], TODAY)).toBe(2);
    expect(habitStreak([], TODAY)).toBe(0);
  });
});

describe('focusStore', () => {
  beforeEach(() => localStorage.clear());

  it('persists the active task and pins, and announces changes', () => {
    let fired = 0;
    const onChange = () => { fired += 1; };
    window.addEventListener(FOCUS_CHANGED_EVENT, onChange);
    setActiveTaskId(7);
    expect(getActiveTaskId()).toBe(7);
    togglePinned(3);
    togglePinned(4);
    togglePinned(3);
    expect(getPinnedIds()).toEqual([4]);
    setActiveTaskId(null);
    expect(getActiveTaskId()).toBeNull();
    expect(fired).toBe(5);
    window.removeEventListener(FOCUS_CHANGED_EVENT, onChange);
  });

  it('counts only tasks completed today', () => {
    markTaskDone(1, true);
    localStorage.setItem('loom:focus:doneAt', JSON.stringify({ '1': new Date().toISOString(), '2': '2020-01-01T10:00:00.000Z' }));
    const tasks = [task({ id: 1, is_complete: true }), task({ id: 2, is_complete: true }), task({ id: 3, is_complete: true })];
    expect(doneTodayCount(tasks)).toBe(1);
  });

  it('sums focus minutes inside a window', () => {
    recordLocalSession({ completed_at: '2026-09-29T10:00:00.000Z', duration_minutes: 25 });
    recordLocalSession({ completed_at: '2026-09-30T10:00:00.000Z', duration_minutes: 50 });
    recordLocalSession({ completed_at: '2026-09-10T10:00:00.000Z', duration_minutes: 25 });
    expect(focusMinutesBetween(new Date('2026-09-28T00:00:00.000Z'), new Date('2026-10-05T00:00:00.000Z'))).toBe(75);
  });
});
