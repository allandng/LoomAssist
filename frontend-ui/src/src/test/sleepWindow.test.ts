import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkSleepWindow,
  loadSleepWindowPrefs,
  saveSleepWindowPrefs,
} from '../lib/sleepWindow';

beforeEach(() => {
  localStorage.clear();
});

function localISO(y: number, m: number, d: number, h: number, min: number): string {
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}

describe('checkSleepWindow', () => {
  it('returns null when prefs are disabled', () => {
    const start = localISO(2026, 5, 8, 21, 0);
    const end = localISO(2026, 5, 8, 23, 30);
    expect(checkSleepWindow(start, end, false, { enabled: false, time: '23:00' })).toBeNull();
  });

  it('returns null for all-day events', () => {
    const start = localISO(2026, 5, 8, 0, 0);
    const end = localISO(2026, 5, 8, 23, 59);
    expect(checkSleepWindow(start, end, true, { enabled: true, time: '23:00' })).toBeNull();
  });

  it('returns null when end is exactly at threshold', () => {
    const start = localISO(2026, 5, 8, 21, 0);
    const end = localISO(2026, 5, 8, 23, 0);
    expect(checkSleepWindow(start, end, false, { enabled: true, time: '23:00' })).toBeNull();
  });

  it('warns when end is one minute past threshold', () => {
    const start = localISO(2026, 5, 8, 21, 0);
    const end = localISO(2026, 5, 8, 23, 1);
    const result = checkSleepWindow(start, end, false, { enabled: true, time: '23:00' });
    expect(result).not.toBeNull();
    expect(result?.message).toMatch(/wind-down/);
  });

  it('returns null when end is before threshold', () => {
    const start = localISO(2026, 5, 8, 19, 0);
    const end = localISO(2026, 5, 8, 22, 0);
    expect(checkSleepWindow(start, end, false, { enabled: true, time: '23:00' })).toBeNull();
  });

  it('warns for multi-day event ending early next morning', () => {
    const start = localISO(2026, 5, 8, 22, 0);
    const end = localISO(2026, 5, 9, 1, 30);
    expect(checkSleepWindow(start, end, false, { enabled: true, time: '23:00' })).not.toBeNull();
  });

  it('warns for multi-day event ending late next morning', () => {
    const start = localISO(2026, 5, 8, 18, 0);
    const end = localISO(2026, 5, 9, 9, 0);
    expect(checkSleepWindow(start, end, false, { enabled: true, time: '23:00' })).not.toBeNull();
  });

  it('returns null for invalid ISO inputs without throwing', () => {
    expect(checkSleepWindow('not-a-date', 'also-bad', false, { enabled: true, time: '23:00' })).toBeNull();
  });
});

describe('loadSleepWindowPrefs', () => {
  it('reads disabled by default', () => {
    expect(loadSleepWindowPrefs()).toEqual({ enabled: false, time: '23:00' });
  });

  it('reads enabled when flag is "1"', () => {
    localStorage.setItem('loom_sleep_window_enabled', '1');
    localStorage.setItem('loom_sleep_window_time', '22:30');
    expect(loadSleepWindowPrefs()).toEqual({ enabled: true, time: '22:30' });
  });

  it('falls back to default when time pref is malformed', () => {
    localStorage.setItem('loom_sleep_window_enabled', '1');
    localStorage.setItem('loom_sleep_window_time', 'oops');
    expect(loadSleepWindowPrefs()).toEqual({ enabled: true, time: '23:00' });
  });
});

describe('saveSleepWindowPrefs', () => {
  it('round-trips through localStorage', () => {
    saveSleepWindowPrefs({ enabled: true, time: '22:00' });
    expect(loadSleepWindowPrefs()).toEqual({ enabled: true, time: '22:00' });
    saveSleepWindowPrefs({ enabled: false, time: '23:30' });
    expect(loadSleepWindowPrefs()).toEqual({ enabled: false, time: '23:30' });
  });
});
