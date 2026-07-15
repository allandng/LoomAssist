import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  NotificationsProvider,
  useNotifications,
  buildMutationToast,
} from '../store/notifications';

function wrapper({ children }: { children: ReactNode }) {
  return <NotificationsProvider>{children}</NotificationsProvider>;
}

function setup() {
  return renderHook(() => useNotifications(), { wrapper });
}

describe('notifications store — severity gating', () => {
  beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it('ambient notifications do not increment the unread badge', () => {
    const { result } = setup();
    act(() => { result.current.addNotification({ type: 'info', title: 'Sync', severity: 'ambient' }); });
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.unreadCount).toBe(0);
  });

  it('standard notifications increment the badge until read', () => {
    const { result } = setup();
    act(() => { result.current.addNotification({ type: 'info', title: 'Hello' }); });
    expect(result.current.unreadCount).toBe(1);
    act(() => { result.current.markAllRead(); });
    expect(result.current.unreadCount).toBe(0);
  });

  it('ambient notifications auto-remove after their default TTL', () => {
    vi.useFakeTimers();
    const { result } = setup();
    act(() => { result.current.addNotification({ type: 'info', title: 'noise', severity: 'ambient' }); });
    expect(result.current.notifications).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(result.current.notifications).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe('notifications store — important persistence', () => {
  beforeEach(() => { localStorage.clear(); });

  it('persists important notifications to localStorage', () => {
    const { result } = setup();
    act(() => {
      result.current.addNotification({ type: 'info', title: 'Weekly review ready', severity: 'important' });
    });
    const raw = localStorage.getItem('loom_notifs_important');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)[0].title).toBe('Weekly review ready');
  });

  it('rehydrates persisted important notifications on a fresh provider', () => {
    // First provider posts an important notification.
    const first = setup();
    act(() => {
      first.result.current.addNotification({ type: 'info', title: 'Persisted', severity: 'important' });
    });
    first.unmount();
    // Fresh provider (simulated restart) reads it back.
    const second = setup();
    expect(second.result.current.notifications.map(n => n.title)).toContain('Persisted');
  });

  it('does not persist standard/ambient notifications', () => {
    const { result } = setup();
    act(() => {
      result.current.addNotification({ type: 'info', title: 'std' });
      result.current.addNotification({ type: 'info', title: 'amb', severity: 'ambient' });
    });
    expect(localStorage.getItem('loom_notifs_important')).toBeNull();
  });
});

describe('notifications store — collapse without loss', () => {
  beforeEach(() => { localStorage.clear(); });

  it('folds >=3 same-key notifications into a summary that keeps its children', () => {
    const { result } = setup();
    act(() => {
      result.current.addNotification({ type: 'info', title: 'a', collapseKey: 'Google' });
      result.current.addNotification({ type: 'info', title: 'b', collapseKey: 'Google' });
      result.current.addNotification({ type: 'info', title: 'c', collapseKey: 'Google' });
    });
    const summary = result.current.notifications.find(n => n.collapsedChildren);
    expect(summary).toBeTruthy();
    expect(summary!.collapsedCount).toBe(3);
    expect(summary!.collapsedChildren).toHaveLength(3);
    expect(summary!.collapsedChildren!.map(c => c.title).sort()).toEqual(['a', 'b', 'c']);
  });

  it('a 4th same-key notification merges into the existing summary', () => {
    const { result } = setup();
    act(() => {
      result.current.addNotification({ type: 'info', title: 'a', collapseKey: 'K' });
      result.current.addNotification({ type: 'info', title: 'b', collapseKey: 'K' });
      result.current.addNotification({ type: 'info', title: 'c', collapseKey: 'K' });
      result.current.addNotification({ type: 'info', title: 'd', collapseKey: 'K' });
    });
    const summaries = result.current.notifications.filter(n => n.collapsedChildren);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].collapsedCount).toBe(4);
  });

  it('dismissChild removes one child and keeps the rest', () => {
    const { result } = setup();
    act(() => {
      result.current.addNotification({ type: 'info', title: 'a', collapseKey: 'K' });
      result.current.addNotification({ type: 'info', title: 'b', collapseKey: 'K' });
      result.current.addNotification({ type: 'info', title: 'c', collapseKey: 'K' });
    });
    const summary = result.current.notifications.find(n => n.collapsedChildren)!;
    const childId = summary.collapsedChildren![0].id;
    act(() => { result.current.dismissChild(summary.id, childId); });
    const after = result.current.notifications.find(n => n.collapsedChildren)!;
    expect(after.collapsedChildren).toHaveLength(2);
  });

  it('dismissing a summary removes the whole group in one step', () => {
    const { result } = setup();
    act(() => {
      result.current.addNotification({ type: 'info', title: 'a', collapseKey: 'K' });
      result.current.addNotification({ type: 'info', title: 'b', collapseKey: 'K' });
      result.current.addNotification({ type: 'info', title: 'c', collapseKey: 'K' });
    });
    const summary = result.current.notifications.find(n => n.collapsedChildren)!;
    act(() => { result.current.dismissNotification(summary.id); });
    expect(result.current.notifications).toHaveLength(0);
  });
});

describe('buildMutationToast', () => {
  it('produces a past-tense Undo toast wired to the undo callback', () => {
    const undo = vi.fn();
    const toast = buildMutationToast({ verb: 'Deleted', object: 'CS107 Lecture', undo });
    expect(toast.title).toBe('Deleted "CS107 Lecture"');
    expect(toast.actionLabel).toBe('Undo');
    expect(toast.actionable).toBe(true);
    expect(toast.autoRemoveMs).toBe(7000);
    toast.actionFn?.();
    expect(undo).toHaveBeenCalledOnce();
  });
});
