// Keep in sync with backend-api/services/exam_cluster.py::is_exam_like
// If you change the regex, update both files in the same commit.
// Tested by: frontend-ui/src/src/test/eventClassification.test.ts and
//            backend-api/tests/test_exam_cluster.py
const EXAM_LIKE_PATTERN = /\b(exam|midterm|final|quiz|test|due|deadline|pset|paper|assignment)\b/i;

export function isExamLike(title: string): boolean {
  return EXAM_LIKE_PATTERN.test(title);
}

export function stripExamWord(title: string): string {
  return title.replace(EXAM_LIKE_PATTERN, '').trim();
}
