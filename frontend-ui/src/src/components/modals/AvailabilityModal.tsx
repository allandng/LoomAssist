import { useState, useEffect, useCallback, useRef, useId } from 'react';
import styles from './AvailabilityModal.module.css';
import { ModalShell, ModalFooter, ModalNotice } from './ModalShell';
import { Button, IconButton, Field, Input, Select, Badge, Card, Icon, Icons } from '../ui';
import { useModal } from '../../contexts/ModalContext';
import { useNotifications } from '../../store/notifications';
import { createAvailability, getAvailability, listEvents } from '../../api';
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

function formatSlotDate(ds: string): string {
  const d = new Date(`${ds}T00:00`);
  return isNaN(d.getTime()) ? ds : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

const STATUS_BADGE: Record<AvailabilityRequest['status'], { tone: 'info' | 'success' | 'warning' | 'neutral'; label: string }> = {
  pending:   { tone: 'info',    label: 'Waiting for a reply' },
  confirmed: { tone: 'success', label: 'Confirmed' },
  amended:   { tone: 'warning', label: 'Counter-proposal received' },
  declined:  { tone: 'neutral', label: 'Declined' },
};

export function AvailabilityModal() {
  const { close, openAvailabilityResponse } = useModal();
  const { addNotification, updateNotification } = useNotifications();
  const ids = useId();

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [slots, setSlots] = useState<SlotWindow[]>([]);
  const [duration, setDuration] = useState(60);
  const [senderName, setSenderName] = useState(() => localStorage.getItem('loom-sender-name') ?? '');
  const [rawConflictDates, setConflictDates] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  // After sending
  const [shareLink, setShareLink] = useState('');
  const [pollStatus, setPollStatus] = useState<AvailabilityRequest['status'] | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cells = monthDays(viewYear, viewMonth);
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  function toDateStr(year: number, month: number, day: number): string {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
        setSlots(s => [...s, { date: ds, start: '09:00', end: '17:00' }].sort((a, b) => a.date.localeCompare(b.date)));
      }
      return next;
    });
  }, [viewYear, viewMonth, todayStr]);

  function removeSlot(date: string) {
    setSlots(prev => prev.filter(s => s.date !== date));
    setSelectedDates(prev => { const n = new Set(prev); n.delete(date); return n; });
  }

  // Check conflicts against existing events. Stale entries for removed slots
  // are filtered at render time (see `conflictDates` usage) rather than by a
  // synchronous setState here.
  useEffect(() => {
    if (slots.length === 0) return;
    let cancelled = false;
    listEvents().then(events => {
      if (cancelled) return;
      const conflicts = new Set<string>();
      for (const slot of slots) {
        const slotStart = new Date(`${slot.date}T${slot.start}`).getTime();
        const slotEnd   = new Date(`${slot.date}T${slot.end}`).getTime();
        for (const ev of events) {
          const evStart = new Date(ev.start_time).getTime();
          const evEnd   = new Date(ev.end_time).getTime();
          if (slotStart < evEnd && slotEnd > evStart) conflicts.add(slot.date);
        }
      }
      setConflictDates(conflicts);
    }).catch(() => {});
    return () => { cancelled = true; };
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
          let amendSlotLabel = req.amendment_slot ?? '';
          if (req.status === 'amended' && req.amendment_slot) {
            try {
              const s = JSON.parse(req.amendment_slot) as { date?: string; start?: string; end?: string };
              if (s.date && s.start) amendSlotLabel = `${s.date} ${s.start}–${s.end ?? ''}`;
            } catch { /* keep raw string */ }
          }
          updateNotification(notifId, {
            type: req.status === 'confirmed' ? 'success' : req.status === 'amended' ? 'warning' : 'info',
            title: req.status === 'confirmed' ? 'Meeting confirmed' : req.status === 'amended' ? 'Counter-proposal received' : 'Availability declined',
            message: req.status === 'confirmed' ? `With ${req.receiver_name}` : amendSlotLabel,
            progress: undefined,
            ...(req.status === 'amended' ? {
              actionable: true,
              actionLabel: 'View proposal',
              actionFn: () => openAvailabilityResponse(t),
            } : {}),
          });
        }
      } catch (e: unknown) {
        if (e instanceof Error && 'status' in e && (e as { status: number }).status === 410) {
          stopPolling();
          setPollStatus(null);
          updateNotification(notifId, { type: 'info', title: 'Link expired', progress: undefined });
        }
      }
    }, 10_000);
  }, [stopPolling, updateNotification, openAvailabilityResponse]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleSend = useCallback(async () => {
    if (slots.length === 0 || sending) return;
    localStorage.setItem('loom-sender-name', senderName);
    setSending(true);
    const notifId = addNotification({ type: 'progress', title: 'Availability sent', message: 'Polling for replies…', progress: 0 });
    try {
      const result = await createAvailability({ sender_name: senderName, duration_minutes: duration, slots });
      setShareLink(result.share_url);
      setPollStatus('pending');
      updateNotification(notifId, { title: 'Availability sent', message: 'Polling… 0 replies', progress: 30 });
      startPolling(result.token, notifId);
    } catch {
      updateNotification(notifId, { type: 'error', title: 'Failed to send', progress: undefined });
    } finally {
      setSending(false);
    }
  }, [slots, sending, senderName, duration, addNotification, updateNotification, startPolling]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(shareLink).then(
      () => addNotification({ type: 'success', title: 'Link copied', autoRemoveMs: 2000 }),
      () => addNotification({ type: 'error', title: 'Could not copy the link' }),
    );
  }, [shareLink, addNotification]);

  const sent = !!shareLink;
  // Only dates that still have a slot count as conflicting.
  const conflictDates = new Set([...rawConflictDates].filter(d => slots.some(s => s.date === d)));

  return (
    <ModalShell
      title="Send availability"
      subtitle="Pick the days and windows you’re free; the recipient books one slot."
      size="lg"
      onClose={close}
      confirmOnClose={slots.length > 0 && !sent}
    >
      <div className={styles.grid}>
        {/* Left: mini calendar */}
        <div className={styles.col}>
          <div className={styles.colTitle}>Dates</div>
          <div className={styles.miniCal}>
            <div className={styles.calNav}>
              <IconButton
                icon={Icons.chevronLeft}
                label="Previous month"
                size="sm"
                onClick={() => { const d = new Date(viewYear, viewMonth - 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); }}
              />
              <span className={styles.calTitle}>{monthLabel}</span>
              <IconButton
                icon={Icons.chevronRight}
                label="Next month"
                size="sm"
                onClick={() => { const d = new Date(viewYear, viewMonth + 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); }}
              />
            </div>
            <div className={styles.calGrid} role="grid" aria-label={monthLabel}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <div key={i} className={styles.calDow} aria-hidden="true">{d}</div>
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
                    type="button"
                    className={[styles.calDay, sel ? styles.calDaySel : '', isToday ? styles.calDayToday : ''].join(' ')}
                    onClick={() => toggleDate(day)}
                    disabled={past || sent}
                    aria-pressed={sel}
                    aria-label={formatSlotDate(ds)}
                  >{day}</button>
                );
              })}
            </div>
          </div>
          <div className={styles.hint}>{selectedDates.size} date{selectedDates.size !== 1 ? 's' : ''} selected · click a day to toggle</div>
        </div>

        {/* Right: slots + controls */}
        <div className={styles.col}>
          <div className={styles.colTitle}>Time windows</div>
          {slots.length === 0 ? (
            <div className={styles.emptySlots}>
              <Icon d={Icons.calendar} size={16} />
              <span>Pick one or more dates to add a window.</span>
            </div>
          ) : (
            <div className={styles.slotList}>
              {slots.map(sl => {
                const conflict = conflictDates.has(sl.date);
                return (
                  <Card key={sl.date} className={styles.slotCard}>
                    <div className={styles.slotHead}>
                      <span className={styles.slotDate}>{formatSlotDate(sl.date)}</span>
                      {conflict && <Badge tone="warning" size="sm" dot>Overlaps an event</Badge>}
                      <IconButton icon={Icons.x} label={`Remove ${formatSlotDate(sl.date)}`} size="sm" onClick={() => removeSlot(sl.date)} disabled={sent} />
                    </div>
                    <div className={styles.slotTimes}>
                      <Input
                        size="sm"
                        type="time"
                        value={sl.start}
                        aria-label={`Start on ${formatSlotDate(sl.date)}`}
                        disabled={sent}
                        onChange={e => setSlots(prev => prev.map(s => s.date === sl.date ? { ...s, start: e.target.value } : s))}
                      />
                      <span className={styles.dash} aria-hidden="true">–</span>
                      <Input
                        size="sm"
                        type="time"
                        value={sl.end}
                        aria-label={`End on ${formatSlotDate(sl.date)}`}
                        disabled={sent}
                        onChange={e => setSlots(prev => prev.map(s => s.date === sl.date ? { ...s, end: e.target.value } : s))}
                      />
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          <div className={styles.row2}>
            <Field label="Meeting length" htmlFor={`${ids}-dur`}>
              <Select id={`${ids}-dur`} value={duration} onChange={e => setDuration(Number(e.target.value))} disabled={sent}>
                {[15, 30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m} min</option>)}
              </Select>
            </Field>
            <Field label="Your name" htmlFor={`${ids}-name`}>
              <Input id={`${ids}-name`} value={senderName} onChange={e => setSenderName(e.target.value)} placeholder="Shown to the recipient" disabled={sent} />
            </Field>
          </div>

          {sent && (
            <div className={styles.shareBlock}>
              <Field label="Share link">
                <div className={styles.shareRow}>
                  <code className={styles.shareCode} title={shareLink}>{shareLink}</code>
                  <Button variant="secondary" size="sm" icon={Icons.copy} onClick={handleCopy}>Copy</Button>
                </div>
              </Field>
              <div className={styles.status}>
                {pollStatus && <Badge tone={STATUS_BADGE[pollStatus].tone} dot>{STATUS_BADGE[pollStatus].label}</Badge>}
                {pollStatus === 'pending' && <span className={styles.hint}>Checked {pollCount} time{pollCount !== 1 ? 's' : ''} — the link stays open while this app runs.</span>}
                {pollStatus === 'amended' && (
                  <Button variant="subtle" size="sm" onClick={() => openAvailabilityResponse(shareLink.split('/').pop() ?? '')}>View proposal</Button>
                )}
              </div>
            </div>
          )}

          {!sent && conflictDates.size > 0 && (
            <ModalNotice tone="warning" icon={<Icon d={Icons.warning} size={13} />}>
              {conflictDates.size} window{conflictDates.size !== 1 ? 's' : ''} overlap existing events. You can still send them.
            </ModalNotice>
          )}
        </div>
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={close}>{sent ? 'Close' : 'Cancel'}</Button>
        {!sent && (
          <Button variant="primary" icon={Icons.send} onClick={() => { void handleSend(); }} disabled={slots.length === 0} loading={sending}>
            Send link
          </Button>
        )}
      </ModalFooter>
    </ModalShell>
  );
}
