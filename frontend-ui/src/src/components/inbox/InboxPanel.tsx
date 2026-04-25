import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Icon, Icons } from '../shared/Icon';
import { useModal } from '../../contexts/ModalContext';
import {
  listInbox, createInboxItem, proposeInboxItem,
  scheduleInboxItem, deleteInboxItem,
} from '../../api';
import type { InboxItem } from '../../types';

interface Props {
  onClose: () => void;
  timelines: import('../../types').Calendar[];
}

function formatProposed(start: string | null, duration: number | null): string {
  if (!start) return '';
  const s = new Date(start);
  const e = new Date(s.getTime() + (duration ?? 60) * 60_000);
  return `${s.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} – ${e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function InboxPanel({ onClose, timelines }: Props) {
  const { openEventEditor } = useModal();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [proposing, setProposing] = useState<number | null>(null);
  const [proposals, setProposals] = useState<Record<number, { proposed_start: string | null; proposed_duration: number | null; rationale: string }>>({});

  const load = useCallback(() => {
    listInbox().then(setItems).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    const text = inputText.trim();
    if (!text) return;
    await createInboxItem(text);
    setInputText('');
    load();
  }

  async function handlePropose(id: number) {
    setProposing(id);
    try {
      const res = await proposeInboxItem(id);
      setProposals(prev => ({ ...prev, [id]: res }));
      load();
    } finally {
      setProposing(null);
    }
  }

  async function handleAccept(item: InboxItem) {
    const proposal = proposals[item.id];
    const start = proposal?.proposed_start ?? item.proposed_start;
    const dur   = proposal?.proposed_duration ?? item.proposed_duration ?? 60;
    if (!start) return;
    const end = new Date(new Date(start).getTime() + dur * 60_000).toISOString();
    // Open editor pre-filled with the proposed time; user can adjust title before saving
    openEventEditor(null, undefined, undefined, start, end);
  }

  async function handleSchedule(item: InboxItem) {
    const proposal = proposals[item.id];
    const start = proposal?.proposed_start ?? item.proposed_start;
    const dur   = proposal?.proposed_duration ?? item.proposed_duration ?? 60;
    if (!start) return handleAccept(item);
    const end   = new Date(new Date(start).getTime() + dur * 60_000).toISOString();
    const calId = timelines[0]?.id ?? 1;
    await scheduleInboxItem(item.id, start, end, calId);
    load();
  }

  async function handleDelete(id: number) {
    await deleteInboxItem(id);
    load();
  }

  const panel = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        display: 'flex', justifyContent: 'flex-end',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 340, height: '100%',
        background: 'var(--bg-panel)',
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-main)' }}>Inbox</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <Icon d={Icons.x} size={16} />
          </button>
        </div>

        {/* Input */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <input
            className="loom-field"
            style={{ flex: 1, fontSize: 13 }}
            placeholder="Capture a thought or task…"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            autoFocus
          />
          <button className="loom-btn-primary" style={{ padding: '0 12px', fontSize: 13 }} onClick={handleAdd}>
            Add
          </button>
        </div>

        {/* Items */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {items.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Inbox is empty. Press <kbd style={{ background: 'var(--bg-elevated)', borderRadius: 4, padding: '1px 5px' }}>I</kbd> to open.
            </div>
          )}
          {items.map(item => {
            const proposal = proposals[item.id];
            const proposedStart = proposal?.proposed_start ?? item.proposed_start;
            const proposedDur   = proposal?.proposed_duration ?? item.proposed_duration;
            return (
              <div key={item.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-main)', flex: 1 }}>{item.text}</span>
                  <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, flexShrink: 0 }}>
                    <Icon d={Icons.x} size={13} />
                  </button>
                </div>

                {proposedStart ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {formatProposed(proposedStart, proposedDur)}
                    {proposal?.rationale && <span style={{ marginLeft: 4, color: 'var(--text-dim)' }}>— {proposal.rationale}</span>}
                  </div>
                ) : null}

                <div style={{ display: 'flex', gap: 6 }}>
                  {!proposedStart && (
                    <button
                      className="loom-btn-ghost"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => handlePropose(item.id)}
                      disabled={proposing === item.id}
                    >
                      {proposing === item.id ? 'Proposing…' : 'Propose time'}
                    </button>
                  )}
                  {proposedStart && (
                    <>
                      <button className="loom-btn-primary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleSchedule(item)}>
                        Accept
                      </button>
                      <button className="loom-btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleAccept(item)}>
                        Edit
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
