import { describe, it, expect } from 'vitest';
import { getMissedButtonState } from '../lib/missedEvents';
import type { Event } from '../types';

const NOW = new Date('2026-05-08T15:00:00Z');

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 1,
    title: 'Lunch',
    start_time: '2026-05-08T12:00:00Z',
    end_time:   '2026-05-08T13:00:00Z', // 2h before NOW — past
    calendar_id: 1,
    is_recurring: false,
    recurrence_days: '',
    recurrence_end: '',
    description: '',
    unique_description: '',
    reminder_minutes: 0,
    external_uid: '',
    timezone: 'local',
    is_all_day: false,
    skipped_dates: '',
    per_day_times: '',
    checklist: '',
    ...overrides,
  };
}

describe('getMissedButtonState', () => {
  it('returns visible:false when event is null', () => {
    expect(getMissedButtonState(null, null, NOW)).toEqual({ visible: false });
  });

  it('returns visible:false when event is undefined', () => {
    expect(getMissedButtonState(undefined, null, NOW)).toEqual({ visible: false });
  });

  it('returns visible:false for a future event', () => {
    const ev = makeEvent({ end_time: '2026-05-08T16:00:00Z' }); // 1h after NOW
    expect(getMissedButtonState(ev, null, NOW)).toEqual({ visible: false });
  });

  it('returns visible:false for a recurring past event', () => {
    const ev = makeEvent({ is_recurring: true, recurrence_days: '1,3' });
    expect(getMissedButtonState(ev, null, NOW)).toEqual({ visible: false });
  });

  it('returns visible:false for an all-day past event', () => {
    const ev = makeEvent({ is_all_day: true });
    expect(getMissedButtonState(ev, null, NOW)).toEqual({ visible: false });
  });

  it('returns visible:false for a malformed end_time', () => {
    const ev = makeEvent({ end_time: 'not-a-date' });
    expect(getMissedButtonState(ev, null, NOW)).toEqual({ visible: false });
  });

  it('returns "Mark as missed" for a past unmarked event', () => {
    const ev = makeEvent();
    expect(getMissedButtonState(ev, null, NOW)).toEqual({
      visible: true,
      label: 'Mark as missed',
    });
  });

  it('returns "Unmark" for a past marked event', () => {
    const ev = makeEvent();
    expect(getMissedButtonState(ev, '2026-05-08T14:00:00Z', NOW)).toEqual({
      visible: true,
      label: 'Unmark',
    });
  });

  it('allows marking on a synced past event (synced events are NOT excluded here)', () => {
    const ev = makeEvent({ connection_calendar_id: 'cc-uuid-123' });
    expect(getMissedButtonState(ev, null, NOW)).toEqual({
      visible: true,
      label: 'Mark as missed',
    });
  });

  it('treats end_time exactly equal to now as not-yet-past', () => {
    const ev = makeEvent({ end_time: NOW.toISOString() });
    expect(getMissedButtonState(ev, null, NOW)).toEqual({ visible: false });
  });
});
