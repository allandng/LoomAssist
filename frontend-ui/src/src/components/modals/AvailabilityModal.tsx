import { useState, useEffect, useCallback, useRef } from 'react';
import styles from './AvailabilityModal.module.css';
import { ModalShell, ModalFooter, FieldLabel } from './ModalShell';
import { Chip } from '../shared/Chip';
import { Icon, Icons } from '../shared/Icon';
import { useModal } from '../../contexts/ModalContext';
import { useNotifications } from '../../store/notifications';
import {
  createAvailability, getAvailability, listEvents,
} from '../../api';
import type { AvailabilityRequest } from '../../types';

interface SlotWindow { date: string; start: string; end: string }

function monthDays(year: number, month: number): (number | null)[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function AvailabilityModal() {
  const { close } = useModal();
  const { addNotification, updateNotification } = useNotifications();

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [slots, setSlots] = useState<SlotWindow[]>([]);
  const [duration, setDuration] = useState(60);
  const [senderName, setSenderName] = useState(() => localStorage.getItem('loom-sender-name') ?? 'Allan');
  const [conflictDates, setConflictDates] = useState<Set<string>>(new Set());

  // After sending
  const [shareLink, setShareLink] = useState('');
  const [_token, setToken] = useState('');
  const [pollStatus, setPollStatus] = useState<AvailabilityRequest['status'] | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cells = monthDays(viewYear, viewMonth);
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  function toDateStr(year: number, month: number, day: number): string {
    return `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  const toggleDate = useCallback((day: number) => {
    const ds = toDateStr(viewYear, viewMonth, day);
    if (ds < todayStr) return; // past date
    setSelectedDates(prev => {
      const next = new Set(prev);
      if (next.has(ds)) {
        next.delete(ds);
        setSlots(s => s.filter(sl => sl.date !== ds));
      } else {
        next.add(ds);
        setSlots(s => [...s, { date: ds, start: '09:00', end: '17:00' }]);
      }
      return next;
    });
  }, [viewYear, viewMonth, todayStr]);

  // Check conflicts against existing events
  useEffect(() => {
    if (slots.length === 0) { setConflictDates(new Set()); return; }
    listEvents().then(events => {
      const conflicts = new Set<string>();
      for (const slot of slots) {
        const slotStart = new Date(`${slot.date}T${slot.start}`).getTime();
        const slotEnd   = new Date(`${slot.date}T${slot.end}`).getTime();
        for (const ev of events) {
          const evStart = new Date(ev.start_time).getTime();
          const evEnd   = new Date(ev.end_time).getTime();
          if (slotStart < evEnd && slotEnd > evStart) {
            conflicts.add(slot.date);
          }
        }
      }
      setConflictDates(conflicts);
    }).catch(() => {});
  }, [slots]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPolling = useCallback((t: string, notifId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const req = await getAvailability(t);
        setPollCount(c => c + 1);
        if (req.status !== 'pending') {
          stopPolling();
          setPollStatus(req.status);
          updateNotification(notifId, {
            type: req.status === 'confirmed' ? 'success' : req.status === 'amended' ? 'warning' : 'info',
            title: req.status === 'confirmed' ? 'Meeting confirmed!' : req.status === 'amended' ? 'Counter-proposal received' : 'Availability declined',
            message: req.status === 'confirmed' ? `With ${req.receiver_name}` : req.amendment_slot ?? '',
            progress: undefined,
          });
        }
      } catch (e: unknown) {
        if (e instanceof Error && 'status' in e && (e as { status: number }).status === 410) {
          stopPolling();
          updateNotification(notifId, { type: 'info', title: 'Link expired', progress: undefined });
        }
      }
    }, 10_000);
  }, [stopPolling, updateNotification]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleSend = useCallback(async () => {
    if (slots.length === 0) return;
    localStorage.setItem('loom-sender-name', senderName);

    const notifId = addNotification({ type: 'progress', title: 'Availability sent', message: 'Polling for replies…', progress: 0 });

    try {
      const result = await createAvailability({ sender_name: senderName, duration_minutes: duration, slots });
      setShareLink(result.share_url);
      setToken(result.token);
      setPollStatus('pending');
      updateNotification(notifId, { title: 'Availability sent', message: `Polling… 0 replies`, progress: 30 });
      startPolling(result.token, notifId);
    } catch {
      updateNotification(notifId, { type: 'error', title: 'Failed to send', progress: undefined });
    }
  }, [slots, senderName, duration, addNotification, updateNotification, startPolling]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(shareLink).then(() =>
      addNotification({ type: 'success', title: 'Link copied!', autoRemoveMs: 2000 })
    );
  }, [shareLink, addNotification]);

  return (
    <ModalShell title="Send availability" width={620} onClose={close}>
      <div className={styles.grid}>
        {/* Left: mini calendar */}
        <div>
          <FieldLabel>Pick dates</FieldLabel>
          <div className={styles.miniCal}>
            <div className={styles.calNav}>
              <button className={styles.calNavBtn} onClick={() => { const d = new Date(viewYear, viewMonth - 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); }}>
                <Icon d={Icons.chevronLeft} size={14} />
              </button>
              <span className={styles.calTitle}>{monthLabel}</span>
              <button className={styles.calNavBtn} onClick={() => { const d = new Date(viewYear, viewMonth + 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); }}>
                <Icon d={Icons.chevronRight} size={14} />
              </button>
            </div>
            <div className={styles.calGrid}>
              {['S','M','T','W','T','F','S'].map((d, i) => (
                <div key={i} className={styles.calDow}>{d}</div>
              ))}
              {cells.map((day, i) => {
                if (!day) return <div key={i} />;
                const ds = toDateStr(viewYear, viewMonth, day);
                const sel = selectedDates.has(ds);
                const past = ds < todayStr;
                const isToday = ds === todayStr;
                return (
                  <button
                    key={i}
                    className={`${styles.calDay} ${sel ? styles.calDaySel : ''} ${past ? styles.calDayPast : ''} ${isToday && !sel ? styles.calDayToday : ''}`}
                    onClick={() => toggleDate(day)}
                    disabled={past}
                  >{day}</button>
                );
              })}
            </div>
          </div>
          <div className={styles.selHint}>{selectedDates.size} date{selectedDates.size !== 1 ? 's' : ''} selected · click to toggle</div>
        </div>

        {/* Right: slots + controls */}
        <div>
          <FieldLabel>Time windows</FieldLabel>
          <div className={styles.slotList}>
            {slots.map((sl, i) => {
              const conflict = conflictDates.has(sl.date);
              return (
                <div key={sl.date} className={styles.slotRow}>
                  <Chip color={conflict ? 'var(--warning)' : undefined}>{sl.date}</Chip>
                  <input
                    className={styles.timeInput}
                    type="time"
                    value={sl.start}
                    onChange={e => setSlots(prev => prev.map((s, j) => j === i ? { ...s, start: e.target.value } : s))}
                  />
                  <span className={styles.arrow}>→</span>
                  <input
                    className={styles.timeInput}
                    type="time"
                    value={sl.end}
                    onChange={e => setSlots(prev => prev.map((s, j) => j === i ? { ...s, end: e.target.value } : s))}
                  />
                  <button className={styles.removeSlot} onClick={() => { setSlots(prev => prev.filter((_, j) => j !== i)); setSelectedDates(prev => { const n = new Set(prev); n.delete(sl.date); return n; }); }}>
                    <Icon d={Icons.x} size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {conflictDates.size > 0 && (
            <div className={styles.conflictWarn}>
              {[...conflictDates].join(', ')} overlap existing events.
            </div>
          )}

          <div className={styles.row2}>
            <div>
              <FieldLabel>Duration</FieldLabel>
              <select className="loom-field" value={duration} onChange={e => setDuration(Number(e.target.value))}>
                {[15, 30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m} min</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Your name</FieldLabel>
              <input className="loom-field" value={senderName} onChange={e => setSenderName(e.target.value)} />
            </div>
          </div>

          {shareLink && (
            <>
              <FieldLabel>Share link</FieldLabel>
              <div className={styles.shareLinkBox}>
                <code className={styles.shareCode}>{shareLink}</code>
                <button className={styles.copyBtn} onClick={handleCopy}>Copy</button>
              </div>
              <div className={styles.pollStatus}>
                <span className={`${styles.pollDot} ${pollStatus === 'pending' ? styles.pollDotPulse : ''}`} />
                {pollStatus === 'pending' ? `Polling for replies… ${pollCount} checked` :
                 pollStatus === 'confirmed' ? '✓ Confirmed!' :
                 pollStatus === 'amended' ? '↩ Counter-proposal received' :
                 pollStatus === 'declined' ? '✗ Declined' : ''}
              </div>
            </>
          )}
        </div>
      </div>

      <ModalFooter>
        <div style={{ flex: 1 }} />
        <button className="loom-btn-ghost" onClick={close}>Cancel</button>
        <button className="loom-btn-primary" onClick={handleSend} disabled={slots.length === 0}>
          <Icon d={Icons.mail} size={12} stroke="white" /> Send link
        </button>
      </ModalFooter>
    </ModalShell>
  );
}
