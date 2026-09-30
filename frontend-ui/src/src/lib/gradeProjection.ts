import type { Assignment, GradeWeight } from '../types';

export interface GradeProjection {
  projected: number | null;
  remainingCount: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function projectCourseGrade(
  assignments: Assignment[],
  weights: GradeWeight[],
  assumedRemainingPercent: number,
): GradeProjection {
  const weightMap = new Map<string, number>();
  for (const w of weights) {
    if (w?.name && typeof w.weight === 'number') weightMap.set(w.name, w.weight);
  }

  const categoryScores = new Map<string, number[]>();
  let remainingCount = 0;

  for (const a of assignments) {
    const max = a.max_score;
    if (max === null || max <= 0) continue;
    const cat = a.weight_category || 'Unweighted';
    const list = categoryScores.get(cat) ?? [];
    if (a.score !== null) {
      list.push((a.score / max) * 100);
    } else {
      list.push(assumedRemainingPercent);
      remainingCount += 1;
    }
    categoryScores.set(cat, list);
  }

  if (weightMap.size === 0) {
    const all: number[] = [];
    for (const list of categoryScores.values()) all.push(...list);
    if (all.length === 0) return { projected: null, remainingCount };
    return { projected: round2(all.reduce((s, p) => s + p, 0) / all.length), remainingCount };
  }

  let totalWeight = 0;
  let weightedSum = 0;
  for (const [cat, w] of weightMap) {
    const scores = categoryScores.get(cat) ?? [];
    if (scores.length === 0) continue;
    const avg = round2(scores.reduce((s, p) => s + p, 0) / scores.length);
    weightedSum += avg * w;
    totalWeight += w;
  }

  if (totalWeight === 0) return { projected: null, remainingCount };
  return { projected: round2(weightedSum / totalWeight), remainingCount };
}

/** Parse a Course.grade_weights JSON string; tolerant of malformed input. */
export function parseGradeWeights(raw: string | null | undefined): GradeWeight[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (w): w is GradeWeight =>
        !!w && typeof w === 'object' && typeof (w as GradeWeight).name === 'string' && typeof (w as GradeWeight).weight === 'number',
    );
  } catch {
    return [];
  }
}

export interface CourseGradeSummary {
  /** Weighted average over graded assignments only (0..100), or null when nothing is graded. */
  current: number | null;
  gradedCount: number;
  remainingCount: number;
}

/**
 * Current standing: only assignments with a score count. Unlike
 * `projectCourseGrade` no assumption is made about ungraded work.
 */
export function currentCourseGrade(assignments: Assignment[], weights: GradeWeight[]): CourseGradeSummary {
  const graded = assignments.filter(a => a.score !== null && a.max_score !== null && a.max_score > 0);
  const remainingCount = assignments.filter(a => a.score === null).length;
  if (graded.length === 0) return { current: null, gradedCount: 0, remainingCount };
  const { projected } = projectCourseGrade(graded, weights, 0);
  return { current: projected, gradedCount: graded.length, remainingCount };
}
