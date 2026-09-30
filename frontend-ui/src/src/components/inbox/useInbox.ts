import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listInbox, listInboxAll, createInboxItem, proposeInboxItem,
  scheduleInboxItem, deleteInboxItem, patchInboxItem, listEvents,
} from '../../api';
import type { Event, InboxItem } from '../../types';

/** Resolve the calendar event an inbox item was scheduled into (null if gone). */
export async function findScheduledEvent(item: InboxItem): Promise<Event | null> {
  if (item.scheduled_event_id == null) return null;
  const events = await listEvents();
  return events.find(e => e.id === item.scheduled_event_id) ?? null;
}

/** Window event fired after every inbox mutation; the sidebar badge listens. */
export const INBOX_CHANGED_EVENT = 'loom-inbox-changed';

export function notifyInboxChanged(): void {
  window.dispatchEvent(new CustomEvent(INBOX_CHANGED_EVENT));
}

export interface InboxProposal {
  proposed_start: string | null;
  proposed_duration: number | null;
  rationale: string;
}

export type InboxFilter = 'open' | 'scheduled' | 'archived';

export function filterInboxItems(items: InboxItem[], filter: InboxFilter): InboxItem[] {
  switch (filter) {
    case 'open':      return items.filter(i => !i.archived && i.scheduled_event_id == null);
    case 'scheduled': return items.filter(i => i.scheduled_event_id != null);
    case 'archived':  return items.filter(i => i.archived && i.scheduled_event_id == null);
  }
}

/** Effective proposal for an item: the live AI response wins over the stored one. */
export function effectiveProposal(item: InboxItem, live?: InboxProposal): { start: string | null; duration: number; rationale: string } {
  return {
    start: live?.proposed_start ?? item.proposed_start,
    duration: live?.proposed_duration ?? item.proposed_duration ?? 60,
    rationale: live?.rationale ?? '',
  };
}

interface Options {
  /** Fetch archived + scheduled rows too (the page); the panel only needs open ones. */
  includeArchived?: boolean;
}

/**
 * Inbox data + actions shared by the Inbox page and the quick-capture panel.
 * Every mutation dispatches `loom-inbox-changed`; every instance reloads on it,
 * so the page, the panel and the sidebar badge stay in sync.
 */
export function useInbox({ includeArchived = false }: Options = {}) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Record<number, InboxProposal>>({});
  const [proposingId, setProposingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Fetch + set state only inside promise callbacks, so effects never set
  // state synchronously (react-hooks/set-state-in-effect).
  const fetchItems = useCallback(() =>
    (includeArchived ? listInboxAll() : listInbox())
      .then(rows => { if (!alive.current) return; setItems(rows); setError(null); })
      .catch(() => { if (alive.current) setError('Could not load the inbox. Is the backend running?'); })
      .finally(() => { if (alive.current) setLoading(false); }),
  [includeArchived]);

  /** Explicit reload (Retry button): shows the loading state again. */
  const reload = useCallback(() => { setLoading(true); return fetchItems(); }, [fetchItems]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  useEffect(() => {
    const onChanged = () => { fetchItems(); };
    window.addEventListener(INBOX_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(INBOX_CHANGED_EVENT, onChanged);
  }, [fetchItems]);

  const capture = useCallback(async (text: string): Promise<InboxItem | null> => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const item = await createInboxItem(trimmed);
    notifyInboxChanged();
    return item;
  }, []);

  const propose = useCallback(async (id: number): Promise<InboxProposal | null> => {
    setProposingId(id);
    try {
      const res = await proposeInboxItem(id);
      if (alive.current) setProposals(prev => ({ ...prev, [id]: res }));
      notifyInboxChanged();
      return res;
    } finally {
      if (alive.current) setProposingId(null);
    }
  }, []);

  const schedule = useCallback(async (item: InboxItem, calendarId: number): Promise<InboxItem | null> => {
    const p = effectiveProposal(item, proposals[item.id]);
    if (!p.start) return null;
    const end = new Date(new Date(p.start).getTime() + p.duration * 60_000).toISOString();
    setBusyId(item.id);
    try {
      const updated = await scheduleInboxItem(item.id, p.start, end, calendarId);
      notifyInboxChanged();
      return updated;
    } finally {
      if (alive.current) setBusyId(null);
    }
  }, [proposals]);

  const archive = useCallback(async (id: number): Promise<void> => {
    setBusyId(id);
    try {
      await deleteInboxItem(id);
      notifyInboxChanged();
    } finally {
      if (alive.current) setBusyId(null);
    }
  }, []);

  const restore = useCallback(async (id: number): Promise<void> => {
    setBusyId(id);
    try {
      await patchInboxItem(id, { archived: false });
      notifyInboxChanged();
    } finally {
      if (alive.current) setBusyId(null);
    }
  }, []);

  const editText = useCallback(async (id: number, text: string): Promise<InboxItem | null> => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    setBusyId(id);
    try {
      const updated = await patchInboxItem(id, { text: trimmed });
      notifyInboxChanged();
      return updated;
    } finally {
      if (alive.current) setBusyId(null);
    }
  }, []);

  return { items, loading, error, proposals, proposingId, busyId, reload, capture, propose, schedule, archive, restore, editText };
}
