import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ExamClusterBanner,
  clusterDismissKey,
  isClusterDismissed,
  markClusterDismissed,
  getClusterEventIds,
} from '../components/calendar/ExamClusterBanner';
import type { WellnessWarning } from '../types';

function makeWarning(overrides: Partial<WellnessWarning['context']> = {}): WellnessWarning {
  return {
    message: '3 exams within 5 days — consider rebalancing study time.',
    kind: 'exam_cluster',
    context: {
      event_ids: [1, 2, 3],
      titles: ['Calc Final', 'CS Midterm', 'Physics Quiz'],
      window_start: '2026-03-14',
      window_end: '2026-03-18',
      ...overrides,
    },
  };
}

describe('clusterDismissKey', () => {
  it('produces a stable key regardless of input order', () => {
    expect(clusterDismissKey([3, 1, 2])).toBe('1,2,3');
    expect(clusterDismissKey([2, 3, 1])).toBe('1,2,3');
  });

  it('keys differ when membership changes', () => {
    expect(clusterDismissKey([1, 2, 3])).not.toBe(clusterDismissKey([1, 2, 3, 4]));
  });
});

describe('sessionStorage persistence', () => {
  beforeEach(() => sessionStorage.clear());

  it('isClusterDismissed reflects markClusterDismissed', () => {
    expect(isClusterDismissed([1, 2, 3])).toBe(false);
    markClusterDismissed([1, 2, 3]);
    expect(isClusterDismissed([1, 2, 3])).toBe(true);
  });

  it('order-independent: dismissing [3,1,2] hides [1,2,3]', () => {
    markClusterDismissed([3, 1, 2]);
    expect(isClusterDismissed([1, 2, 3])).toBe(true);
  });

  it('different membership = different key, banner reappears', () => {
    markClusterDismissed([1, 2, 3]);
    expect(isClusterDismissed([1, 2, 3, 4])).toBe(false);
  });

  it('empty event_ids are not stored or matched', () => {
    markClusterDismissed([]);
    expect(isClusterDismissed([])).toBe(false);
  });
});

describe('getClusterEventIds', () => {
  it('extracts event_ids from context', () => {
    expect(getClusterEventIds(makeWarning())).toEqual([1, 2, 3]);
  });

  it('returns [] when context is malformed', () => {
    const w: WellnessWarning = { message: 'x', kind: 'exam_cluster', context: {} };
    expect(getClusterEventIds(w)).toEqual([]);
  });

  it('returns [] when context is missing', () => {
    const w: WellnessWarning = { message: 'x', kind: 'exam_cluster' };
    expect(getClusterEventIds(w)).toEqual([]);
  });
});

describe('ExamClusterBanner rendering', () => {
  beforeEach(() => sessionStorage.clear());

  it('renders headline derived from titles + span', () => {
    render(<ExamClusterBanner warning={makeWarning()} onDismiss={() => {}} />);
    expect(screen.getByText('3 exams in 5 days')).toBeTruthy();
  });

  it('renders all titles when count <= 3', () => {
    render(<ExamClusterBanner warning={makeWarning()} onDismiss={() => {}} />);
    expect(screen.getByText(/Calc Final, CS Midterm, Physics Quiz/)).toBeTruthy();
  });

  it('truncates titles with "+N more" when more than 3', () => {
    const w = makeWarning({
      titles: ['Calc', 'CS', 'Physics', 'Chem', 'Bio'],
      event_ids: [1, 2, 3, 4, 5],
    });
    render(<ExamClusterBanner warning={w} onDismiss={() => {}} />);
    expect(screen.getByText(/Calc, CS, Physics, \+2 more/)).toBeTruthy();
  });

  it('renders formatted date range', () => {
    render(<ExamClusterBanner warning={makeWarning()} onDismiss={() => {}} />);
    // Locale-dependent; just assert both endpoints appear in the rendered text.
    const detail = screen.getByText(/Calc Final/).parentElement!;
    expect(detail.textContent).toMatch(/Mar 14/);
    expect(detail.textContent).toMatch(/Mar 18/);
  });

  it('falls back to warning.message when context is missing', () => {
    const bare: WellnessWarning = {
      message: 'Fallback message',
      kind: 'exam_cluster',
    };
    render(<ExamClusterBanner warning={bare} onDismiss={() => {}} />);
    expect(screen.getByText('Fallback message')).toBeTruthy();
  });

  it('dismiss button calls onDismiss', () => {
    const spy = vi.fn();
    render(<ExamClusterBanner warning={makeWarning()} onDismiss={spy} />);
    fireEvent.click(screen.getByLabelText('Dismiss exam cluster warning'));
    expect(spy).toHaveBeenCalledOnce();
  });

  it('mounts without console errors or warnings (theme-agnostic)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<ExamClusterBanner warning={makeWarning()} onDismiss={() => {}} />);
    expect(errSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
