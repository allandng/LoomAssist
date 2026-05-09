import { describe, it, expect } from 'vitest';
import { isExamLike, stripExamWord } from '../lib/eventClassification';

describe('isExamLike', () => {
  it.each([
    'CS107 final exam',
    'Math midterm',
    'Final review',
    'Pop quiz',
    'Unit test 3',
    'PS3 due Friday',
    'Project deadline',
    'PSet 4',
    'Term paper',
    'Assignment 2',
  ])('matches union term in %s', (title) => {
    expect(isExamLike(title)).toBe(true);
  });

  it.each([
    'Lunch with Sam',
    'Standup',
    'Coffee break',
    'Yoga class',
    '',
  ])('does not match unrelated title %s', (title) => {
    expect(isExamLike(title)).toBe(false);
  });

  it('matches case-insensitively', () => {
    expect(isExamLike('FINAL EXAM')).toBe(true);
    expect(isExamLike('quiz')).toBe(true);
  });

  it('respects word boundaries', () => {
    expect(isExamLike('Examine the data')).toBe(false);
    expect(isExamLike('Finalize report')).toBe(false);
  });

  it('flags known false positives — accepted tradeoff for v1', () => {
    expect(isExamLike('Final review of slides')).toBe(true);
    expect(isExamLike('Assignment debrief')).toBe(true);
  });
});

describe('stripExamWord', () => {
  it('removes the matched term and trims', () => {
    expect(stripExamWord('CS107 final exam')).toBe('CS107  exam');
    expect(stripExamWord('Math midterm')).toBe('Math');
    expect(stripExamWord('Assignment 2')).toBe('2');
  });

  it('returns original (trimmed) when no match', () => {
    expect(stripExamWord('  Lunch with Sam  ')).toBe('Lunch with Sam');
  });
});
