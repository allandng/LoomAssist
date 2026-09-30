import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './InboxPage.module.css';
import {
  Badge, Button, Card, EmptyState, Icons, Input, Kbd, Page, PageHeader, Segmented, Skeleton,
} from '../components/ui';
import { listCalendars } from '../api';
import type { Calendar, InboxItem } from '../types';
import { useModal } from '../contexts/ModalContext';
import { useNotifications } from '../store/notifications';
import { InboxItemRow } from '../components/inbox/InboxItemRow';
import { effectiveProposal, filterInboxItems, findScheduledEvent, useInbox, type InboxFilter } from '../components/inbox/useInbox';

const FILTER_KEY = 'loom:inbox:filter';

function readFilter(): InboxFilter {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    return v === 'scheduled' || v === 'archived' ? v : 'open';
  } catch {
    return 'open';
  }
}

const EMPTY_COPY: Record<InboxFilter, { title: string; description: string }> = {
  open:      { title: 'Nothing to schedule', description: 'Capture a thought above, or press I anywhere in the app.' },
  scheduled: { title: 'Nothing scheduled yet', description: 'Items you schedule from a proposal show up here with a link to their event.' },
  archived:  { title: 'Nothing archived', description: 'Archived items stay out of the way but are kept for reference.' },
};

export function InboxPage() {
  const { openEventEditor } = useModal();
  const { addNotification } = useNotifications();
  const inbox = useInbox({ includeArchived: true });
  const [filter, setFilter] = useState<InboxFilter>(readFilter);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { listCalendars().then(setTimelines).catch(() => {}); }, []);

  function changeFilter(next: InboxFilter) {
    setFilter(next);
    try { localStorage.setItem(FILTER_KEY, next); } catch { /* storage unavailable */ }
  }

  const counts = useMemo(() => ({
    open: filterInboxItems(inbox.items, 'open').length,
    scheduled: filterInboxItems(inbox.items, 'scheduled').length,
    archived: filterInboxItems(inbox.items, 'archived').length,
  }), [inbox.items]);

  const visible = useMemo(() => filterInboxItems(inbox.items, filter), [inbox.items, filter]);

  async function handleCapture() {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      await inbox.capture(text);
      setText('');
      if (filter !== 'open') changeFilter('open');
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
    openEventEditor(null, undefined, undefined, p.start, end, { title: item.text });
  }

  async function handleOpenEvent(item: InboxItem) {
    const ev = await findScheduledEvent(item).catch(() => null);
    if (!ev) {
      addNotification({ type: 'warning', title: 'Event not found', message: 'It may have been deleted.', autoRemoveMs: 5000 });
      return;
    }
    openEventEditor(ev);
  }

  async function handleArchive(item: InboxItem) {
    try {
      await inbox.archive(item.id);
    } catch {
      addNotification({ type: 'error', title: 'Could not archive', autoRemoveMs: 5000 });
    }
  }

  async function handleRestore(item: InboxItem) {
    try {
      await inbox.restore(item.id);
      addNotification({ type: 'success', title: 'Restored to open', message: item.text, autoRemoveMs: 3500 });
    } catch {
      addNotification({ type: 'error', title: 'Could not restore', autoRemoveMs: 5000 });
    }
  }

  return (
    <Page narrow>
      <PageHeader
        title="Inbox"
        description="Quick-capture things to schedule later."
        actions={<span className={styles.kbdHint}><Kbd>I</Kbd><span>opens quick capture anywhere</span></span>}
      />

      <Card className={styles.captureCard}>
        <form className={styles.captureForm} onSubmit={e => { e.preventDefault(); handleCapture(); }}>
          <Input
            ref={inputRef}
            autoFocus
            icon={Icons.plus}
            placeholder="Capture a thought or task"
            aria-label="Capture a thought or task"
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={saving}
          />
          <Button type="submit" variant="primary" loading={saving} disabled={!text.trim()} kbd="Enter">Capture</Button>
        </form>
      </Card>

      <div className={styles.filterRow}>
        <Segmented<InboxFilter>
          aria-label="Filter inbox"
          value={filter}
          onChange={changeFilter}
          options={[
            { value: 'open', label: counts.open ? `Open (${counts.open})` : 'Open' },
            { value: 'scheduled', label: counts.scheduled ? `Scheduled (${counts.scheduled})` : 'Scheduled' },
            { value: 'archived', label: counts.archived ? `Archived (${counts.archived})` : 'Archived' },
          ]}
        />
      </div>

      <Card flush className={styles.listCard}>
        {inbox.loading && (
          <div aria-busy="true">
            {[0, 1, 2].map(i => (
              <div key={i} className={styles.skeletonRow}>
                <div className={styles.skeletonText}>
                  <Skeleton width="70%" height={14} />
                  <Skeleton width="35%" height={11} />
                </div>
                <Skeleton width={96} height={26} radius={5} />
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

        {!inbox.loading && !inbox.error && visible.length === 0 && (
          <EmptyState
            icon={filter === 'archived' ? Icons.archive : filter === 'scheduled' ? Icons.calendar : Icons.inbox}
            title={EMPTY_COPY[filter].title}
            description={EMPTY_COPY[filter].description}
            action={filter === 'open' ? { label: 'Capture something', icon: Icons.plus, onClick: () => inputRef.current?.focus() } : undefined}
            secondary={filter !== 'open' ? { label: 'Show open items', onClick: () => changeFilter('open') } : undefined}
          />
        )}

        {!inbox.loading && visible.length > 0 && (
          <ul className={styles.items}>
            {visible.map(item => (
              <InboxItemRow
                key={item.id}
                item={item}
                proposal={inbox.proposals[item.id]}
                proposing={inbox.proposingId === item.id}
                busy={inbox.busyId === item.id}
                onPropose={handlePropose}
                onSchedule={handleSchedule}
                onEdit={handleEdit}
                onOpenEvent={handleOpenEvent}
                onArchive={handleArchive}
                onRestore={handleRestore}
              />
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}
