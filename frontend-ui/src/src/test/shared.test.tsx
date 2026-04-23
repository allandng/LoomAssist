import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Icon, Icons, Kbd, Chip, TLDot, AppDrawer, TopBar, SectionLabel } from '../components/shared';

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

describe('AppDrawer', () => {
  it('renders all four nav destinations', () => {
    render(<AppDrawer active="calendar" onNavigate={() => {}} />);
    expect(screen.getByTitle(/Calendar/)).toBeTruthy();
    expect(screen.getByTitle(/Task Board/)).toBeTruthy();
    expect(screen.getByTitle(/Focus Mode/)).toBeTruthy();
    expect(screen.getByTitle(/Settings/)).toBeTruthy();
  });

  it('calls onNavigate when a button is clicked', () => {
    const spy = vi.fn();
    render(<AppDrawer active="calendar" onNavigate={spy} />);
    screen.getByTitle(/Task Board/).click();
    expect(spy).toHaveBeenCalledWith('tasks');
  });
});

describe('TopBar', () => {
  it('renders view switcher for calendar kind', () => {
    render(<TopBar kind="calendar" view="Month" />);
    expect(screen.getByText('Month')).toBeTruthy();
    expect(screen.getByText('Week')).toBeTruthy();
    expect(screen.getByText('Day')).toBeTruthy();
    expect(screen.getByText('Agenda')).toBeTruthy();
  });

  it('renders page title for tasks kind', () => {
    render(<TopBar kind="tasks" />);
    expect(screen.getByText('Task Board')).toBeTruthy();
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
