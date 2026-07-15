import { useEffect, useMemo, useState } from 'react';
import styles from './GradeWidget.module.css';
import { listTasks } from '../../api';
import type { Task, Calendar, Event } from '../../types';
import { TLDot } from '../shared/TLDot';
import { DEFAULT_TIMELINE_COLOR } from '../../lib/colors';

interface GradeWidgetProps {
  timelines: Calendar[];
  events: Event[];
}

export function GradeWidget({ timelines, events }: GradeWidgetProps) {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    listTasks().then(setTasks).catch(() => {});
  }, []);

  const rows = useMemo(() => {
    const courses = timelines.filter(t => t.is_course);
    return courses.map(course => {
      const courseEventIds = new Set(events.filter(ev => ev.calendar_id === course.id).map(ev => ev.id));
      const courseTasks = tasks.filter(t => courseEventIds.has(t.event_id) && t.grade != null && t.weight != null);
      const totalWeight = courseTasks.reduce((s, t) => s + (t.weight ?? 0), 0);
      const weightedGrade = courseTasks.reduce((s, t) => s + ((t.grade ?? 0) * (t.weight ?? 0)), 0);
      const grade = totalWeight > 0 ? weightedGrade / totalWeight : null;
      return { course, grade, totalWeight, count: courseTasks.length };
    }).filter(r => r.count > 0);
  }, [timelines, events, tasks]);

  if (rows.length === 0) return null;

  return (
    <section className={styles.widget}>
      <h2 className={styles.heading}>Grades</h2>
      <ul className={styles.list}>
        {rows.map(({ course, grade, totalWeight }) => (
          <li key={course.id} className={styles.row}>
            <TLDot color={course.color ?? DEFAULT_TIMELINE_COLOR} size={7} />
            <span className={styles.title}>{course.name}</span>
            <span className={styles.weight}>{Math.round(totalWeight)}% graded</span>
            <span className={styles.grade}>
              {grade != null ? `${grade.toFixed(1)}%` : '—'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
