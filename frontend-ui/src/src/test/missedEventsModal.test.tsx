import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MissedEventsModal } from '../components/modals/MissedEventsModal';
import { ModalProvider } from '../contexts/ModalContext';
import type { Event } from '../types';

vi.mock('../api', () => ({
  findFreeSlots: vi.fn(async () => ({ slots: [], duration_minutes: 60 })),
}));
import { findFreeSlots } from '../api';
const findFreeMock = findFreeSlots as unknown as ReturnType<typeof vi.fn>;

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 1,
    title: 'Lunch with Tara',
    start_time: '2026-05-04T12:00:00Z',
    end_time:   '2026-05-04T13:00:00Z',
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

function wrap(node: ReactNode) {
  return <ModalProvider>{node}</ModalProvider>;
}

describe('MissedEventsModal', () => {
  beforeEach(() => {
    findFreeMock.mockReset();
    findFreeMock.mockResolvedValue({ slots: [], duration_minutes: 60 });
  });

  it('renders an empty state when no items', () => {
    render(wrap(<MissedEventsModal items={[]} truncated={false} onReschedule={() => {}} />));
    expect(screen.getByText('Nothing marked as missed.')).toBeTruthy();
  });

  it('renders the title, original time, and reason for each row', async () => {
    const ev = makeEvent({ id: 7, title: 'Dentist' });
    render(wrap(<MissedEventsModal items={[ev]} truncated={false} onReschedule={() => {}} />));
    expect(screen.getByText('Dentist')).toBeTruthy();
    expect(screen.getByText(/You didn.t start this/i)).toBeTruthy();
    // Awaiting the suggestions promise so the loading state resolves.
    await waitFor(() => expect(findFreeMock).toHaveBeenCalled());
  });

  it('shows the suggested slot when find-free returns one', async () => {
    findFreeMock.mockResolvedValue({
      slots: [{ start: '2026-05-08T14:00:00Z', end: '2026-05-08T15:00:00Z' }],
      duration_minutes: 60,
    });
    const ev = makeEvent();
    render(wrap(<MissedEventsModal items={[ev]} truncated={false} onReschedule={() => {}} />));
    await waitFor(() => {
      expect(screen.getByText(/Suggested:/)).toBeTruthy();
    });
  });

  it('shows "No free slot in next 7 days" when find-free returns []', async () => {
    findFreeMock.mockResolvedValue({ slots: [], duration_minutes: 60 });
    const ev = makeEvent();
    render(wrap(<MissedEventsModal items={[ev]} truncated={false} onReschedule={() => {}} />));
    await waitFor(() => {
      expect(screen.getByText('No free slot in next 7 days')).toBeTruthy();
    });
  });

  it('renders the truncation footer when truncated=true', () => {
    render(wrap(<MissedEventsModal items={[makeEvent()]} truncated={true} onReschedule={() => {}} />));
    expect(screen.getByText('…and more')).toBeTruthy();
  });

  it('does NOT render the truncation footer when truncated=false', () => {
    render(wrap(<MissedEventsModal items={[makeEvent()]} truncated={false} onReschedule={() => {}} />));
    expect(screen.queryByText('…and more')).toBeNull();
  });

  it('disables the Reschedule button while suggestions are loading', () => {
    findFreeMock.mockReturnValue(new Promise(() => {})); // never resolves
    render(wrap(<MissedEventsModal items={[makeEvent()]} truncated={false} onReschedule={() => {}} />));
    const btn = screen.getByText('Reschedule') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('calls onReschedule with (event, start, end) when slot is found', async () => {
    findFreeMock.mockResolvedValue({
      slots: [{ start: '2026-05-08T14:00:00Z', end: '2026-05-08T15:00:00Z' }],
      duration_minutes: 60,
    });
    const ev = makeEvent({ id: 42 });
    const onReschedule = vi.fn();
    render(wrap(<MissedEventsModal items={[ev]} truncated={false} onReschedule={onReschedule} />));
    await waitFor(() => {
      const btn = screen.getByText('Reschedule') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByText('Reschedule'));
    expect(onReschedule).toHaveBeenCalledTimes(1);
    expect(onReschedule).toHaveBeenCalledWith(ev, '2026-05-08T14:00:00Z', '2026-05-08T15:00:00Z');
  });

  it('calls onReschedule with (event, null, null) when no slot is found', async () => {
    findFreeMock.mockResolvedValue({ slots: [], duration_minutes: 60 });
    const ev = makeEvent();
    const onReschedule = vi.fn();
    render(wrap(<MissedEventsModal items={[ev]} truncated={false} onReschedule={onReschedule} />));
    await waitFor(() => {
      const btn = screen.getByText('Reschedule') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByText('Reschedule'));
    expect(onReschedule).toHaveBeenCalledWith(ev, null, null);
  });
});
