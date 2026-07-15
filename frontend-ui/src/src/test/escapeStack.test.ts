import { describe, it, expect, vi } from 'vitest';
import { pushEscapeHandler, escapeStackDepth } from '../lib/escapeStack';

function pressEscape() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('escapeStack', () => {
  it('dispatches Escape only to the top-most handler', () => {
    const bottom = vi.fn();
    const top = vi.fn();
    const offBottom = pushEscapeHandler(bottom);
    const offTop = pushEscapeHandler(top);

    pressEscape();
    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).not.toHaveBeenCalled();

    offTop();
    pressEscape();
    expect(bottom).toHaveBeenCalledTimes(1);

    offBottom();
  });

  it('falls through to the next handler when the top returns false', () => {
    const bottom = vi.fn();
    const top = vi.fn(() => false as const);
    const offBottom = pushEscapeHandler(bottom);
    const offTop = pushEscapeHandler(top);

    pressEscape();
    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).toHaveBeenCalledTimes(1);

    offTop();
    offBottom();
  });

  it('unsubscribing removes exactly one handler and restores depth', () => {
    const start = escapeStackDepth();
    const off = pushEscapeHandler(() => {});
    expect(escapeStackDepth()).toBe(start + 1);
    off();
    expect(escapeStackDepth()).toBe(start);
  });
});
