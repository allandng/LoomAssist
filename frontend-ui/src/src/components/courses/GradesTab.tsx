import { useId, useMemo } from 'react';
import styles from './courses.module.css';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Icons, ProgressBar, ProgressRing, Skeleton } from '../ui';
import type { Assignment, Course } from '../../types';
import { projectCourseGrade } from '../../lib/gradeProjection';
import { isGraded, parseWeights, trimNumber } from './courseUtils';

export interface GradeResult {
  grade: number | null;
  breakdown: Record<string, number | null>;
}

interface Props {
  course: Course;
  assignments: Assignment[];
  grade: GradeResult | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  assumedPct: number;
  onAssumedPct: (next: number) => void;
  onEditWeights: () => void;
}

const gradeColor = (g: number | null): string => (g == null ? 'var(--text-dim)' : g >= 70 ? 'var(--success)' : 'var(--error)');

export function GradesTab({ course, assignments, grade, loading, error, onReload, assumedPct, onAssumedPct, onEditWeights }: Props) {
  const sliderId = useId();
  const weights = useMemo(() => parseWeights(course.grade_weights), [course.grade_weights]);
  const projection = useMemo(() => projectCourseGrade(assignments, weights, assumedPct), [assignments, weights, assumedPct]);
  const gradedCount = assignments.filter(isGraded).length;

  if (loading) {
    return (
      <div className={styles.gradeGrid} aria-busy="true">
        <Card><CardBody className={styles.ringBody}><Skeleton width={132} height={132} radius={66} /><Skeleton width={120} height={13} /></CardBody></Card>
        <Card><CardBody className={styles.breakdown}>{[0, 1, 2].map(i => <Skeleton key={i} width="100%" height={28} />)}</CardBody></Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <div className={styles.errorRow}>
          <Badge tone="error" dot>{error}</Badge>
          <Button size="sm" variant="subtle" onClick={onReload}>Retry</Button>
        </div>
      </Card>
    );
  }

  if (assignments.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Icons.graduation}
          title="No grades yet"
          description="Add assignments with a score and maximum to see your standing here."
        />
      </Card>
    );
  }

  const current = grade?.grade ?? null;

  return (
    <div className={styles.tabStack}>
      <div className={styles.gradeGrid}>
        <Card>
          <CardHeader compact title="Current grade" description={`${gradedCount} of ${assignments.length} scored`} />
          <CardBody className={styles.ringBody}>
            <ProgressRing value={current != null ? current / 100 : 0} size={132} stroke={9} color={gradeColor(current)} aria-label="Current weighted grade">
              <span className={styles.ringValue} style={{ color: gradeColor(current) }}>
                {current != null ? `${trimNumber(current)}%` : '—'}
              </span>
              <span className={styles.ringSub}>{current != null ? 'weighted' : 'no scores'}</span>
            </ProgressRing>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            compact
            title="By category"
            description={weights.length ? 'Weighted averages of scored work' : 'No weights set — grade is a plain average'}
            actions={<Button size="sm" variant="subtle" icon={Icons.pencil} onClick={onEditWeights}>Edit weights</Button>}
          />
          <CardBody className={styles.breakdown}>
            {weights.length === 0 && (
              <p className={styles.dimText}>Add categories like “Homework 30%” so each one shows its own bar.</p>
            )}
            {weights.map(w => {
              const avg = grade?.breakdown?.[w.name] ?? null;
              return (
                <div key={w.name} className={styles.breakRow}>
                  <div className={styles.breakHead}>
                    <span className={styles.breakName}>{w.name}</span>
                    <Badge size="sm" tone="neutral" outline>{trimNumber(w.weight)}%</Badge>
                    <span className={[styles.breakValue, styles.mono].join(' ')}>{avg != null ? `${trimNumber(avg)}%` : '—'}</span>
                  </div>
                  <ProgressBar value={avg != null ? avg / 100 : 0} color={avg != null ? gradeColor(avg) : undefined} aria-label={`${w.name} average`} />
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader compact title="Projection" description="What the final grade looks like if the rest goes a certain way." />
        <CardBody className={styles.projection}>
          {projection.remainingCount > 0 ? (
            <>
              <div className={styles.sliderRow}>
                <label htmlFor={sliderId} className={styles.sliderLabel}>
                  If remaining work scores <strong className={styles.mono}>{assumedPct}%</strong>
                </label>
                <input
                  id={sliderId}
                  className={styles.slider}
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={assumedPct}
                  onChange={e => onAssumedPct(Number(e.target.value))}
                  aria-valuetext={`${assumedPct} percent`}
                />
              </div>
              <div className={styles.projResult}>
                <span className={styles.projLabel}>Projected final</span>
                <span className={[styles.projValue, styles.mono].join(' ')} style={{ color: gradeColor(projection.projected) }}>
                  {projection.projected != null ? `${trimNumber(projection.projected)}%` : '—'}
                </span>
                <span className={styles.dim}>{projection.remainingCount} remaining</span>
              </div>
            </>
          ) : (
            <p className={styles.dimText}>Everything with a maximum score is graded — the projection equals your current grade.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
