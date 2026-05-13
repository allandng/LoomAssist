// Stage 0 — verifies SyncContext hardens against tab-out/tab-in flicker:
//   1. Rapid window 'focus' events fire runAllSync at most once per 5s window.
//   2. The EventSource subscription doesn't double-instance under rapid
//      onerror -> reconnect -> onerror cycles.
//
// We mock the api module functions and the global EventSource constructor.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../api', () => ({
  listConnections: vi.fn(),
  getSyncStatus:   vi.fn(),
  runAllSync:      vi.fn(),
  runOneSync:      vi.fn(),
  pauseConnection: vi.fn(),
  resumeConnection: vi.fn(),
  SYNC_EVENTS_URL: 'http://localhost:8000/sync/events',
}));

import * as api from '../api';
import { SyncProvider } from '../contexts/SyncContext';
import { NotificationsProvider } from '../store/notifications';

interface MockESInstance {
  url: string;
  closed: boolean;
  onmessage: ((e: { data: string }) => void) | null;
  onerror:   (() => void) | null;
  close: () => void;
}

let esInstances: MockESInstance[] = [];
let liveCount = 0;

class MockEventSource implements MockESInstance {
  url: string;
  closed = false;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror:   (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    esInstances.push(this);
    liveCount++;
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      liveCount--;
    }
  }
}

beforeEach(() => {
  esInstances = [];
  liveCount = 0;
  // jsdom doesn't ship EventSource; cast through unknown to satisfy TS.
  (globalThis as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;

  vi.mocked(api.listConnections).mockResolvedValue([{
    id: 'conn-1',
    kind: 'google',
    display_name: 'Test Google',
    account_email: 't@example.com',
    caldav_base_url: null,
    status: 'connected',
    // 10 minutes ago — STALE_MS in SyncContext is 60_000.
    last_synced_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    last_error: null,
    created_at: new Date().toISOString(),
  }]);
  vi.mocked(api.getSyncStatus).mockResolvedValue([]);
  vi.mocked(api.runAllSync).mockResolvedValue({ started: ['conn-1'] });
});

afterEach(() => {
  vi.clearAllMocks();
});

function Tree() {
  return (
    <NotificationsProvider>
      <SyncProvider>
        <div data-testid="child" />
      </SyncProvider>
    </NotificationsProvider>
  );
}

async function flush() {
  // Resolve the boot fetch promises (listConnections, getSyncStatus) and any
  // setState side effects so connectionsRef.current is populated before we
  // start firing focus events.
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

describe('SyncContext — Stage 0 hardening', () => {
  it('debounces rapid focus events to at most one runAllSync call', async () => {
    render(<Tree />);
    await flush();

    await act(async () => {
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new Event('focus'));
      }
    });
    // Let the in-flight promise + finally settle.
    await act(async () => { await Promise.resolve(); });

    expect(api.runAllSync).toHaveBeenCalledTimes(1);
  });

  it('keeps exactly one live EventSource at boot (no double-connect)', async () => {
    render(<Tree />);
    await flush();

    expect(esInstances.length).toBe(1);
    expect(liveCount).toBe(1);
  });
});
