import { useState, useEffect } from 'react';
import { ModalShell, ModalFooter, ModalStack } from './ModalShell';
import { Button, Skeleton, Icon, Icons } from '../ui';
import { useModal } from '../../contexts/ModalContext';
import { useNotifications } from '../../store/notifications';
import { getAvailability, respondAmendment } from '../../api';
import styles from './CounterProposalModal.module.css';

interface CounterProposalModalProps {
  token: string;
  onSaved: () => void;
}

interface Slot {
  date: string;
  start: string;
  end: string;
}

function formatSlot(slot: Slot): { day: string; time: string } {
  try {
    const d = new Date(`${slot.date}T${slot.start}`);
    const day = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    return { day, time: `${slot.start} – ${slot.end}` };
  } catch {
    return { day: slot.date, time: `${slot.start} – ${slot.end}` };
  }
}

export function CounterProposalModal({ token, onSaved }: CounterProposalModalProps) {
  const { close } = useModal();
  const { addNotification } = useNotifications();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [receiverName, setReceiverName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<'accept' | 'decline' | null>(null);

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
    setSubmitting('accept');
    try {
      await respondAmendment(token, { action: 'accept' });
      addNotification({ type: 'success', title: 'Counter-proposal accepted', autoRemoveMs: 4000 });
      onSaved();
      close();
    } catch {
      addNotification({ type: 'error', title: 'Failed to accept', message: 'Could not respond to the proposal.' });
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDecline() {
    setSubmitting('decline');
    try {
      await respondAmendment(token, { action: 'decline' });
      addNotification({ type: 'info', title: 'Counter-proposal declined', autoRemoveMs: 4000 });
      close();
    } catch {
      addNotification({ type: 'error', title: 'Failed to decline', message: 'Could not respond to the proposal.' });
    } finally {
      setSubmitting(null);
    }
  }

  const formatted = slot ? formatSlot(slot) : null;

  return (
    <ModalShell
      title="Counter-proposal"
      subtitle={receiverName ? `From ${receiverName}` : undefined}
      size="sm"
      onClose={close}
    >
      <ModalStack>
        {loading ? (
          <div className={styles.slotBox}>
            <Skeleton width="60%" height={16} />
            <Skeleton width="40%" height={22} />
          </div>
        ) : formatted ? (
          <div className={styles.slotBox}>
            <span className={styles.slotIcon}><Icon d={Icons.calendar} size={16} /></span>
            <div className={styles.slotText}>
              <div className={styles.slotDay}>{formatted.day}</div>
              <div className={styles.slotTime}>{formatted.time}</div>
            </div>
          </div>
        ) : (
          <div className={styles.slotBox}>
            <span className={styles.slotIcon}><Icon d={Icons.alertCircle} size={16} /></span>
            <div className={styles.slotText}>
              <div className={styles.slotDay}>No time slot provided</div>
            </div>
          </div>
        )}
        <p className={styles.help}>
          Accept to confirm this new time on your calendar, or decline to cancel the request.
        </p>
      </ModalStack>

      <ModalFooter
        left={(
          <Button variant="danger" onClick={() => { void handleDecline(); }} disabled={loading || submitting !== null} loading={submitting === 'decline'}>
            Decline
          </Button>
        )}
      >
        <Button variant="ghost" onClick={close}>Later</Button>
        <Button variant="primary" icon={Icons.check} onClick={() => { void handleAccept(); }} disabled={loading || submitting !== null || !slot} loading={submitting === 'accept'}>
          Accept
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}
