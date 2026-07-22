import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModalShell } from '../components/modals/ModalShell';

describe('ModalShell focus discipline (WS5)', () => {
  it('Escape closes immediately when not dirty', () => {
    const onClose = vi.fn();
    render(<ModalShell title="Test" onClose={onClose}><div>body</div></ModalShell>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('confirmOnClose surfaces a discard bar on Escape instead of closing', () => {
    const onClose = vi.fn();
    render(<ModalShell title="Test" onClose={onClose} confirmOnClose><div>body</div></ModalShell>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Discard changes?')).toBeTruthy();
  });

  it('"Keep editing" dismisses the discard bar without closing', () => {
    const onClose = vi.fn();
    render(<ModalShell title="Test" onClose={onClose} confirmOnClose><div>body</div></ModalShell>);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByText('Keep editing'));
    expect(screen.queryByText('Discard changes?')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a second Escape after the discard bar shows confirms the close', () => {
    const onClose = vi.fn();
    render(<ModalShell title="Test" onClose={onClose} confirmOnClose><div>body</div></ModalShell>);
    fireEvent.keyDown(window, { key: 'Escape' }); // shows bar
    fireEvent.keyDown(window, { key: 'Escape' }); // confirms
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the Discard button in the bar closes the modal', () => {
    const onClose = vi.fn();
    render(<ModalShell title="Test" onClose={onClose} confirmOnClose><div>body</div></ModalShell>);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByText('Discard'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the invoking element on close', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    expect(document.activeElement).toBe(btn);

    const { unmount } = render(<ModalShell title="Test" onClose={() => {}}><div>body</div></ModalShell>);
    // Focus has moved into the dialog.
    expect(document.activeElement).not.toBe(btn);

    unmount();
    expect(document.activeElement).toBe(btn);
    btn.remove();
  });
});
