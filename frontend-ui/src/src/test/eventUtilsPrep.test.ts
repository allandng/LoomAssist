import { describe, it, expect } from 'vitest';
import { toFCEvents } from '../lib/eventUtils';
import type { Event, Calendar } from '../types';

const TIMELINES: Calendar[] = [
  { id: 1, name: 'Default', description: '', color: '#6366f1' },
];

const baseEvent: Event = {
  id: 42,
  title: 'Algorithms',
  start_time: '2024-04-25T11:00:00',
  end_time: '2024-04-25T12:00:00',
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
};

describe('toFCEvents — prep block emission', () => {
  it('emits a synthetic prep occurrence for a non-recurring lecture', () => {
    const ev: Event = { ...baseEvent, event_type: 'lecture', prep_minutes: 25 };
    const out = toFCEvents(ev, TIMELINES);
    expect(out).toHaveLength(2);
    const prep = out.find(e => e.id === '42_prep');
    expect(prep).toBeDefined();
    expect(prep!.extendedProps).toMatchObject({ isPrepBlock: true });
    expect((prep!.extendedProps as { event: Event }).event.id).toBe(42);
    expect(prep!.editable).toBe(false);
    // 25 min before 11:00 = 10:35
    expect(new Date(prep!.start as string).getMinutes()).toBe(35);
    expect(new Date(prep!.start as string).getHours()).toBe(10);
  });

  it('does NOT emit prep for a non-lecture even when prep_minutes is set', () => {
    const ev: Event = { ...baseEvent, event_type: 'lab', prep_minutes: 25 };
    const out = toFCEvents(ev, TIMELINES);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('42');
  });

  it('does NOT emit prep for an all-day lecture', () => {
    const ev: Event = { ...baseEvent, is_all_day: true, event_type: 'lecture', prep_minutes: 25 };
    const out = toFCEvents(ev, TIMELINES);
    expect(out).toHaveLength(1);
    expect(out[0].allDay).toBe(true);
  });

  it('emits 2N events for a recurring lecture across N occurrences', () => {
    const ev: Event = {
      ...baseEvent,
      is_recurring: true,
      recurrence_days: '4', // Thursdays only — 4 = Thursday in JS Date getDay()
      recurrence_end: '2024-05-23',
      event_type: 'lecture',
      prep_minutes: 15,
    };
    const out = toFCEvents(ev, TIMELINES);
    // 2024-04-25 is a Thursday. Thursdays through 2024-05-23: 04-25, 05-02, 05-09, 05-16, 05-23 → 5
    expect(out.length).toBe(10);
    const preps = out.filter(e => (e.extendedProps as { isPrepBlock?: boolean }).isPrepBlock);
    expect(preps.length).toBe(5);
  });

  it('skip-date hides BOTH the lecture and its prep for that day', () => {
    const ev: Event = {
      ...baseEvent,
      is_recurring: true,
      recurrence_days: '4',
      recurrence_end: '2024-05-09',
      event_type: 'lecture',
      prep_minutes: 15,
      skipped_dates: '2024-05-02',
    };
    const out = toFCEvents(ev, TIMELINES);
    // Thursdays in window: 04-25, 05-02 (skipped), 05-09 → 2 occurrences × 2 = 4 events
    expect(out.length).toBe(4);
    const ids = out.map(e => e.id);
    expect(ids).not.toContain('42_2024-05-02');
    expect(ids).not.toContain('42_2024-05-02_prep');
  });

  it('uses per-day-times for the prep anchor', () => {
    // Mon (dow=1) at 08:00, prep=15 → prep starts 07:45
    const ev: Event = {
      ...baseEvent,
      start_time: '2024-04-29T11:00:00', // Monday 2024-04-29
      end_time:   '2024-04-29T12:00:00',
      is_recurring: true,
      recurrence_days: '1',
      recurrence_end: '2024-04-29',
      event_type: 'lecture',
      prep_minutes: 15,
      per_day_times: JSON.stringify({ '1': { start: '08:00', end: '10:00' } }),
    };
    const out = toFCEvents(ev, TIMELINES);
    const prep = out.find(e => String(e.id).endsWith('_prep'));
    expect(prep).toBeDefined();
    const prepStart = new Date(prep!.start as string);
    expect(prepStart.getHours()).toBe(7);
    expect(prepStart.getMinutes()).toBe(45);
  });

  it('prep extendedProps.event points to the parent (for click handler)', () => {
    const ev: Event = { ...baseEvent, event_type: 'lecture', prep_minutes: 25 };
    const out = toFCEvents(ev, TIMELINES);
    const prep = out.find(e => e.id === '42_prep')!;
    expect((prep.extendedProps as { event: Event }).event.id).toBe(42);
    expect((prep.extendedProps as { event: Event }).event.title).toBe('Algorithms');
  });
});
