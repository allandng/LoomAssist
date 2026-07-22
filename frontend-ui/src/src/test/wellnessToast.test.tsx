import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  WellnessToast,
  wellnessDismissKey,
  isWellnessDismissed,
  markWellnessDismissed,
} from '../components/calendar/WellnessToast';

describe('WellnessToast dismissal persistence', () => {
  beforeEach(() => sessionStorage.clear());

  it('key is derived from date + message', () => {
    expect(wellnessDismissKey('2026-07-15', 'Busy')).toBe('2026-07-15|Busy');
  });

  it('isWellnessDismissed reflects markWellnessDismissed', () => {
    expect(isWellnessDismissed('2026-07-15', 'Busy')).toBe(false);
    markWellnessDismissed('2026-07-15', 'Busy');
    expect(isWellnessDismissed('2026-07-15', 'Busy')).toBe(true);
  });

  it('empty message is never stored or matched', () => {
    markWellnessDismissed('2026-07-15', '');
    expect(isWellnessDismissed('2026-07-15', '')).toBe(false);
  });

  it('dismissing hides the toast and persists across remount', () => {
    const { unmount } = render(<WellnessToast date="2026-07-15" message="Heavy day" />);
    fireEvent.click(screen.getByLabelText('Dismiss wellness warning'));
    expect(screen.queryByText('Heavy day')).toBeNull();
    unmount();
    // Remount with the same warning — stays dismissed.
    render(<WellnessToast date="2026-07-15" message="Heavy day" />);
    expect(screen.queryByText('Heavy day')).toBeNull();
  });

  it('a different warning still shows after another was dismissed', () => {
    markWellnessDismissed('2026-07-15', 'Heavy day');
    render(<WellnessToast date="2026-07-16" message="Different day" />);
    expect(screen.getByText('Different day')).toBeTruthy();
  });
});
