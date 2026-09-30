import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './GradeWidget.module.css';
import { listCourses, listAssignments } from '../../api';
import type { Course, Assignment } from '../../types';
import { Card, CardHeader, CardBody, Button, Badge, EmptyState, ProgressRing, Skeleton, Icons } from '../ui';
import { DEFAULT_TIMELINE_COLOR } from '../../lib/colors';
import { currentCourseGrade, parseGradeWeights } from '../../lib/gradeProjection';

/**
 * Current weighted grade per course. Computed from Courses + Assignments (the
 * only place scores are recorded) — the old widget read Task.grade/weight,
 * which nothing ever writes, so it was always empty.
 */
export function GradeWidget() {
  const navigate = useNavigate();
  const [courses, setCourses]         = useState<Course[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([listCourses(), listAssignments()])
      .then(([c, a]) => {
        if (!alive) return;
        setCourses(c);
        setAssignments(a);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const rows = useMemo(
    () => courses.map(course => {
      const list = assignments.filter(a => a.course_id === course.id);
      const summary = currentCourseGrade(list, parseGradeWeights(course.grade_weights));
      return { course, ...summary };
    }),
    [courses, assignments],
  );

  return (
    <Card>
      <CardHeader
        title="Grades"
        description={rows.length ? 'Current standing per course' : undefined}
        actions={
          <Button size="sm" variant="subtle" iconRight={Icons.arrowRight} onClick={() => navigate('/courses')}>
            View courses
          </Button>
        }
      />
      <CardBody>
        {error ? (
          <div className={styles.errorRow} role="alert">
            <Badge tone="error" icon={Icons.alertCircle}>Couldn't load grades</Badge>
          </div>
        ) : loading ? (
          <ul className={styles.list} aria-hidden="true">
            {Array.from({ length: 2 }, (_, i) => (
              <li key={i} className={styles.row}>
                <Skeleton width={44} height={44} radius={99} />
                <div className={styles.text}>
                  <Skeleton width="60%" height={12} />
                  <Skeleton width="40%" height={10} />
                </div>
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            icon={Icons.graduation}
            title="No courses yet"
            description="Add a course and log assignment scores to track your standing."
            action={{ label: 'View courses', onClick: () => navigate('/courses') }}
          />
        ) : (
          <ul className={styles.list}>
            {rows.map(r => {
              const pct = r.current;
              const color = r.course.color || DEFAULT_TIMELINE_COLOR;
              return (
                <li key={r.course.id} className={styles.row}>
                  <ProgressRing
                    value={(pct ?? 0) / 100}
                    size={44}
                    stroke={4}
                    color={color}
                    aria-label={`${r.course.name}: ${pct != null ? `${Math.round(pct)} percent` : 'no grades yet'}`}
                  >
                    <span className={styles.ringText}>{pct != null ? Math.round(pct) : '–'}</span>
                  </ProgressRing>
                  <div className={styles.text}>
                    <div className={styles.name}>{r.course.name}</div>
                    <div className={styles.meta}>
                      {r.course.code ? `${r.course.code} · ` : ''}
                      {r.gradedCount} graded
                      {r.remainingCount ? ` · ${r.remainingCount} remaining` : ''}
                    </div>
                  </div>
                  <span className={styles.grade}>{pct != null ? `${pct.toFixed(1)}%` : '—'}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
