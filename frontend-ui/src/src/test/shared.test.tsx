import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Icon, Icons, Kbd, Chip, TLDot, Sidebar, TopBar, SectionLabel } from '../components/shared';

describe('Icon', () => {
  it('renders an svg with a string path', () => {
    const { container } = render(<Icon d="M12 5v14" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders an svg with jsx children (Icons dict)', () => {
    const { container } = render(<Icon d={Icons.calendar} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});

describe('Kbd', () => {
  it('renders its children', () => {
    render(<Kbd>N</Kbd>);
    expect(screen.getByText('N')).toBeTruthy();
  });

  it('renders small variant', () => {
    render(<Kbd small>1</Kbd>);
    expect(screen.getByText('1')).toBeTruthy();
  });
});

describe('Chip', () => {
  it('renders with default accent color', () => {
    render(<Chip>Label</Chip>);
    expect(screen.getByText('Label')).toBeTruthy();
  });

  it('renders with custom color', () => {
    const { container } = render(<Chip color="#10B981">Tag</Chip>);
    expect(container.firstChild).toBeTruthy();
  });
});

describe('TLDot', () => {
  it('renders a span with the given color', () => {
    const { container } = render(<TLDot color="#6366F1" />);
    const el = container.querySelector('span');
    expect(el).toBeTruthy();
    expect(el?.style.background).toBe('rgb(99, 102, 241)');
  });
});

describe('Sidebar', () => {
  it('renders every destination with a label when expanded', () => {
    render(<Sidebar active="calendar" onNavigate={() => {}} />);
    for (const label of ['Home', 'Calendar', 'Tasks', 'Inbox', 'Focus', 'Courses', 'Journal', 'Settings']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /^Calendar/ })).toHaveAttribute('aria-current', 'page');
  });

  it('calls onNavigate when a destination is clicked', () => {
    const spy = vi.fn();
    render(<Sidebar active="calendar" onNavigate={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /^Tasks/ }));
    expect(spy).toHaveBeenCalledWith('tasks');
  });

  it('shows the inbox count as a badge', () => {
    render(<Sidebar active="home" onNavigate={() => {}} inboxCount={3} />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('collapses to icons with accessible names', () => {
    const onToggle = vi.fn();
    render(<Sidebar active="home" onNavigate={() => {}} collapsed onToggle={onToggle} inboxCount={2} />);
    expect(screen.queryByText('Calendar')).toBeNull();
    expect(screen.getByRole('button', { name: /^Calendar/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Inbox, 2 items/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('wires the search and New event buttons', () => {
    const onSearch = vi.fn();
    const onNewEvent = vi.fn();
    render(<Sidebar active="home" onNavigate={() => {}} onSearch={onSearch} onNewEvent={onNewEvent} />);
    fireEvent.click(screen.getByRole('button', { name: /^Search/ }));
    fireEvent.click(screen.getByRole('button', { name: /^New event/ }));
    expect(onSearch).toHaveBeenCalledOnce();
    expect(onNewEvent).toHaveBeenCalledOnce();
  });
});

describe('TopBar', () => {
  it('renders view switcher for calendar kind', () => {
    render(<TopBar kind="calendar" view="Month" />);
    expect(screen.getByText('Month')).toBeTruthy();
    expect(screen.getByText('Week')).toBeTruthy();
    expect(screen.getByText('Day')).toBeTruthy();
    expect(screen.getByText('Agenda')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('renders the date title as a button that opens Jump to date', () => {
    const onDateClick = vi.fn();
    render(<TopBar kind="calendar" dateLabel="September 2026" onDateClick={onDateClick} />);
    fireEvent.click(screen.getByRole('button', { name: /September 2026/ }));
    expect(onDateClick).toHaveBeenCalledOnce();
  });

  // Title copy follows the sidebar ("Tasks", not "Task Board").
  it('renders page title for tasks kind', () => {
    render(<TopBar kind="tasks" />);
    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeTruthy();
    expect(screen.queryByText('Month')).toBeNull();
  });

  // Regression: these routes used to fall back to the calendar controls.
  it.each([
    ['inbox', 'Inbox'],
    ['courses', 'Courses'],
    ['journal', 'Journal'],
    ['sync-review', 'Sync review'],
  ] as const)('renders a page title for %s', (kind, title) => {
    render(<TopBar kind={kind} />);
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.queryByText('Today')).toBeNull();
  });

  it('renders unread badge', () => {
    render(<TopBar unread={3} />);
    expect(screen.getByLabelText('3 unread')).toBeTruthy();
  });

  it('shows 9+ when unread > 9', () => {
    render(<TopBar unread={12} />);
    expect(screen.getByText('9+')).toBeTruthy();
  });
});

describe('SectionLabel', () => {
  it('renders children', () => {
    render(<SectionLabel>Timelines</SectionLabel>);
    expect(screen.getByText('Timelines')).toBeTruthy();
  });

  it('renders right slot', () => {
    render(<SectionLabel right={<button>+</button>}>Filters</SectionLabel>);
    expect(screen.getByText('+')).toBeTruthy();
  });
});
