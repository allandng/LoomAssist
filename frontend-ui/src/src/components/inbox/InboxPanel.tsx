import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import styles from './InboxPanel.module.css';
import { Badge, Button, EmptyState, IconButton, Icons, Input, Skeleton } from '../ui';
import { useModal } from '../../contexts/ModalContext';
import { useNotifications } from '../../store/notifications';
import { pushEscapeHandler } from '../../lib/escapeStack';
import type { Calendar, InboxItem } from '../../types';
import { InboxItemRow } from './InboxItemRow';
import { effectiveProposal, findScheduledEvent, useInbox } from './useInbox';

interface Props {
  onClose: () => void;
  timelines: Calendar[];
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Quick-capture panel (the "I" overlay). A real dialog: labelled, modal,
 * Escape via the shared escape stack, a first/last focus trap, and focus
 * restored to the invoker on close. Anchored to the right edge under the top bar.
 */
export function InboxPanel({ onClose, timelines }: Props) {
  const navigate = useNavigate();
  const { openEventEditor } = useModal();
  const { addNotification } = useNotifications();
  const inbox = useInbox();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [invoker] = useState<HTMLElement | null>(() => document.activeElement as HTMLElement | null);

  // Escape closes; focus lands on the input; focus returns to the invoker.
  useEffect(() => {
    const pop = pushEscapeHandler(onClose);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      pop();
      window.clearTimeout(t);
      if (invoker && document.contains(invoker)) invoker.focus();
    };
  }, [onClose, invoker]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, []);

  async function handleCapture() {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      await inbox.capture(text);
      setText('');
      inputRef.current?.focus();
    } catch {
      addNotification({ type: 'error', title: 'Could not capture', message: 'The inbox did not accept the item. Try again.', autoRemoveMs: 6000 });
    } finally {
      setSaving(false);
    }
  }

  async function handlePropose(item: InboxItem) {
    try {
      const res = await inbox.propose(item.id);
      if (res && !res.proposed_start) {
        addNotification({ type: 'warning', title: 'No slot found', message: res.rationale || 'Nothing free in the next 7 days.', autoRemoveMs: 6000 });
      }
    } catch {
      addNotification({ type: 'error', title: 'Could not propose a time', message: 'The local AI did not respond.', autoRemoveMs: 6000 });
    }
  }

  async function handleSchedule(item: InboxItem) {
    const calId = timelines[0]?.id;
    if (calId == null) {
      addNotification({ type: 'warning', title: 'No timeline yet', message: 'Create a timeline before scheduling inbox items.', autoRemoveMs: 6000 });
      return;
    }
    try {
      await inbox.schedule(item, calId);
      addNotification({ type: 'success', title: 'Scheduled', message: item.text, autoRemoveMs: 4000 });
    } catch {
      addNotification({ type: 'error', title: 'Could not schedule', message: 'The event was not created.', autoRemoveMs: 6000 });
    }
  }

  function handleEdit(item: InboxItem) {
    const p = effectiveProposal(item, inbox.proposals[item.id]);
    if (!p.start) return;
    const end = new Date(new Date(p.start).getTime() + p.duration * 60_000).toISOString();
    onClose();
    openEventEditor(null, undefined, undefined, p.start, end, { title: item.text });
  }

  async function handleOpenEvent(item: InboxItem) {
    const ev = await findScheduledEvent(item).catch(() => null);
    if (!ev) {
      addNotification({ type: 'warning', title: 'Event not found', message: 'It may have been deleted.', autoRemoveMs: 5000 });
      return;
    }
    onClose();
    openEventEditor(ev);
  }

  async function handleArchive(item: InboxItem) {
    try {
      await inbox.archive(item.id);
    } catch {
      addNotification({ type: 'error', title: 'Could not archive', autoRemoveMs: 5000 });
    }
  }

  const openItems = inbox.items.filter(i => !i.archived);

  const panel = (
    <div className={styles.scrim} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <h2 id={titleId} className={styles.title}>Inbox</h2>
            {openItems.length > 0 && <Badge tone="accent" size="sm">{openItems.length}</Badge>}
          </div>
          <IconButton icon={Icons.x} label="Close" size="sm" onClick={onClose} />
        </header>

        <form
          className={styles.capture}
          onSubmit={e => { e.preventDefault(); handleCapture(); }}
        >
          <Input
            ref={inputRef}
            icon={Icons.plus}
            placeholder="Capture a thought or task"
            aria-label="Capture a thought or task"
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={saving}
          />
          <Button type="submit" variant="primary" loading={saving} disabled={!text.trim()}>Capture</Button>
        </form>

        <div className={styles.list}>
          {inbox.loading && (
            <div className={styles.skeletons} aria-busy="true">
              {[0, 1, 2].map(i => (
                <div key={i} className={styles.skeletonRow}>
                  <Skeleton width="80%" height={13} />
                  <Skeleton width="40%" height={11} />
                </div>
              ))}
            </div>
          )}

          {!inbox.loading && inbox.error && (
            <div className={styles.errorRow}>
              <Badge tone="error" dot>{inbox.error}</Badge>
              <Button size="sm" variant="subtle" onClick={() => inbox.reload()}>Retry</Button>
            </div>
          )}

          {!inbox.loading && !inbox.error && openItems.length === 0 && (
            <EmptyState
              compact
              icon={Icons.inbox}
              title="Nothing captured yet"
              description="Type something and press Enter."
            />
          )}

          {openItems.length > 0 && (
            <ul className={styles.items}>
              {openItems.map(item => (
                <InboxItemRow
                  key={item.id}
                  item={item}
                  compact
                  proposal={inbox.proposals[item.id]}
                  proposing={inbox.proposingId === item.id}
                  busy={inbox.busyId === item.id}
                  onPropose={handlePropose}
                  onSchedule={handleSchedule}
                  onEdit={handleEdit}
                  onOpenEvent={handleOpenEvent}
                  onArchive={handleArchive}
                />
              ))}
            </ul>
          )}
        </div>

        <footer className={styles.footer}>
          <Button variant="subtle" size="sm" iconRight={Icons.arrowRight} onClick={() => { onClose(); navigate('/inbox'); }}>
            Open inbox page
          </Button>
        </footer>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
