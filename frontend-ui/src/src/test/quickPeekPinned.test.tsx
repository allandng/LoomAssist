import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// SourceBadge pulls in Router + Sync context; it renders nothing for a
// local-only event anyway, so stub it out to keep this an isolated unit test.
vi.mock('../components/shared/SourceBadge', () => ({ SourceBadge: () => null }));

import { QuickPeek } from '../components/calendar/QuickPeek';
import type { Event, Calendar } from '../types';

const timelines: Calendar[] = [
  { id: 1, name: 'School', description: '', color: '#6366F1' } as Calendar,
];

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 5,
    title: 'CS107 Lecture',
    start_time: '2026-05-04T09:00:00Z',
    end_time:   '2026-05-04T10:00:00Z',
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
    checklist: JSON.stringify([{ text: 'Read ch 3', done: false }, { text: 'Submit lab', done: true }]),
    ...overrides,
  };
}

describe('QuickPeek (WS5)', () => {
  it('hover mode shows no action row', () => {
    render(<QuickPeek event={makeEvent()} timelines={timelines} anchorX={100} anchorY={100} />);
    expect(screen.queryByLabelText('Edit event')).toBeNull();
    expect(screen.queryByLabelText('Delete event')).toBeNull();
  });

  it('pinned mode renders the Edit / Duplicate / Delete / Close action row', () => {
    render(<QuickPeek event={makeEvent()} timelines={timelines} anchorX={100} anchorY={100} pinned />);
    expect(screen.getByLabelText('Edit event')).toBeTruthy();
    expect(screen.getByLabelText('Duplicate event')).toBeTruthy();
    expect(screen.getByLabelText('Delete event')).toBeTruthy();
    expect(screen.getByLabelText('Close')).toBeTruthy();
  });

  it('Edit / Duplicate / Delete / Close fire their callbacks', () => {
    const onEdit = vi.fn(), onDuplicate = vi.fn(), onDelete = vi.fn(), onClose = vi.fn();
    const ev = makeEvent();
    render(
      <QuickPeek event={ev} timelines={timelines} anchorX={100} anchorY={100} pinned
        onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} onClose={onClose} />,
    );
    fireEvent.click(screen.getByLabelText('Edit event'));
    fireEvent.click(screen.getByLabelText('Duplicate event'));
    fireEvent.click(screen.getByLabelText('Delete event'));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onEdit).toHaveBeenCalledWith(ev);
    expect(onDuplicate).toHaveBeenCalledWith(ev);
    expect(onDelete).toHaveBeenCalledWith(ev);
    expect(onClose).toHaveBeenCalled();
  });

  it('pinned checklist checkboxes are toggleable and report the original index', () => {
    const onChecklistToggle = vi.fn();
    render(
      <QuickPeek event={makeEvent()} timelines={timelines} anchorX={100} anchorY={100} pinned
        onChecklistToggle={onChecklistToggle} />,
    );
    // Two checklist items → two toggle buttons.
    fireEvent.click(screen.getByLabelText('Toggle "Submit lab"'));
    expect(onChecklistToggle).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByLabelText('Toggle "Read ch 3"'));
    expect(onChecklistToggle).toHaveBeenCalledWith(0);
  });

  it('Escape closes the pinned peek', () => {
    const onClose = vi.fn();
    render(<QuickPeek event={makeEvent()} timelines={timelines} anchorX={100} anchorY={100} pinned onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
