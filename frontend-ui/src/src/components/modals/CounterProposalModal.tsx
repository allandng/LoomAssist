import { useState, useEffect } from 'react';
import { ModalShell, ModalFooter } from './ModalShell';
import { useModal } from '../../contexts/ModalContext';
import { useNotifications } from '../../store/notifications';
import { getAvailability, respondAmendment } from '../../api';

interface CounterProposalModalProps {
  token: string;
  onSaved: () => void;
}

interface Slot {
  date: string;
  start: string;
  end: string;
}

function formatSlot(slot: Slot): string {
  try {
    const d = new Date(`${slot.date}T${slot.start}`);
    const dayLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return `${dayLabel}, ${slot.start}–${slot.end}`;
  } catch {
    return `${slot.date} ${slot.start}–${slot.end}`;
  }
}

export function CounterProposalModal({ token }: CounterProposalModalProps) {
  const { close } = useModal();
  const { addNotification } = useNotifications();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [receiverName, setReceiverName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getAvailability(token)
      .then(req => {
        setReceiverName(req.receiver_name ?? '');
        try {
          const parsed = JSON.parse(req.amendment_slot ?? '{}') as Slot;
          setSlot(parsed.date ? parsed : null);
        } catch {
          setSlot(null);
        }
      })
      .catch(() => {
        addNotification({ type: 'error', title: 'Could not load proposal' });
        close();
      })
      .finally(() => setLoading(false));
  }, [token, close, addNotification]);

  async function handleAccept() {
    setSubmitting(true);
    try {
      await respondAmendment(token, { action: 'accept' });
      addNotification({ type: 'success', title: 'Counter-proposal accepted', autoRemoveMs: 4000 });
      close();
    } catch {
      addNotification({ type: 'error', title: 'Failed to accept', message: 'Could not respond to proposal.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecline() {
    setSubmitting(true);
    try {
      await respondAmendment(token, { action: 'decline' });
      addNotification({ type: 'info', title: 'Counter-proposal declined', autoRemoveMs: 4000 });
      close();
    } catch {
      addNotification({ type: 'error', title: 'Failed to decline', message: 'Could not respond to proposal.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Counter-proposal received" width={400} onClose={close}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {loading && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Loading…</p>
        )}
        {!loading && (
          <>
            {receiverName && (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                From: <strong style={{ color: 'var(--text-main)' }}>{receiverName}</strong>
              </p>
            )}
            <div style={{
              padding: '14px 16px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-strong)',
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-main)',
              textAlign: 'center',
            }}>
              {slot ? formatSlot(slot) : 'No time slot provided'}
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              Accept to confirm this new time, or decline to cancel the request.
            </p>
          </>
        )}
      </div>
      <ModalFooter>
        <button
          className="loom-btn-ghost"
          onClick={handleDecline}
          disabled={loading || submitting}
          style={{ color: 'var(--error)' }}
        >
          {submitting ? '…' : 'Decline'}
        </button>
        <button
          className="loom-btn-primary"
          onClick={handleAccept}
          disabled={loading || submitting || !slot}
        >
          {submitting ? '…' : 'Accept'}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}
