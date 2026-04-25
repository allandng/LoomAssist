import { useState, useEffect, useCallback } from 'react';
import { listInbox, deleteInboxItem } from '../api';
import type { InboxItem } from '../types';
import { Icon, Icons } from '../components/shared/Icon';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString([], {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    listInbox()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: number) {
    await deleteInboxItem(id);
    load();
  }

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-main)', marginBottom: 24 }}>Inbox</h1>

      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>}

      {!loading && items.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', marginTop: 60 }}>
          Nothing here. Press <kbd style={{ background: 'var(--bg-elevated)', borderRadius: 4, padding: '1px 6px' }}>I</kbd> anywhere to open the quick-capture panel.
        </div>
      )}

      {items.map(item => (
        <div
          key={item.id}
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '14px 16px',
            marginBottom: 10,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-main)' }}>{item.text}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Captured {formatDate(item.created_at)}
              {item.proposed_start && (
                <span style={{ marginLeft: 8, color: 'var(--accent)' }}>
                  · Proposed: {formatDate(item.proposed_start)}
                </span>
              )}
              {item.scheduled_event_id && (
                <span style={{ marginLeft: 8, color: 'var(--success)' }}>· Scheduled</span>
              )}
            </div>
          </div>
          <button
            onClick={() => handleDelete(item.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, flexShrink: 0 }}
            aria-label="Archive item"
          >
            <Icon d={Icons.x} size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function InboxSidebarContent() { return null; }
