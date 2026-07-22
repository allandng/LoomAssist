import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmBar, type ConfirmBarItem } from '../components/ConfirmBar';

function item(over: Partial<ConfirmBarItem> = {}): ConfirmBarItem {
  return {
    id: 'x1',
    message: 'Delete "CS107 Lecture"?',
    onConfirm: () => {},
    ...over,
  };
}

describe('ConfirmBar', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(<ConfirmBar items={[]} onResolve={() => {}} />);
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it('shows the action sentence with Confirm and Cancel', () => {
    render(<ConfirmBar items={[item()]} onResolve={() => {}} />);
    expect(screen.getByText('Delete "CS107 Lecture"?')).toBeTruthy();
    expect(screen.getByText('Confirm')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('Cancel resolves without confirming', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const onResolve = vi.fn();
    render(<ConfirmBar items={[item({ onConfirm, onCancel })]} onResolve={onResolve} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onResolve).toHaveBeenCalledWith('x1');
  });

  it('Confirm awaits the action then resolves', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onResolve = vi.fn();
    render(<ConfirmBar items={[item({ onConfirm })]} onResolve={onResolve} />);
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('x1'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('keeps the bar up when the action rejects', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('nope'));
    const onResolve = vi.fn();
    render(<ConfirmBar items={[item({ onConfirm })]} onResolve={onResolve} />);
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm')).toBeTruthy();
  });

  it('Escape cancels the top bar', () => {
    const onResolve = vi.fn();
    render(<ConfirmBar items={[item()]} onResolve={onResolve} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onResolve).toHaveBeenCalledWith('x1');
  });
});
