import { useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, IconButton, Badge, Field, Input, Select, Switch,
  EmptyState, Icons, confirm, Skeleton,
} from '../ui';
import {
  pairStart, pairComplete, listPeers, deletePeer, getDiscoveredPeers, syncNow,
  listSubscriptions, createSubscription, updateSubscription, deleteSubscription, refreshSubscription,
  listCalendars,
} from '../../api';
import type { Subscription, Calendar, Peer, DiscoveredPeer, PairStartResult } from '../../types';
import { useNotifications } from '../../store/notifications';
import { CloudSyncSection } from './CloudSyncSection';
import { errMessage, relativeTime } from './util';
import styles from './settings.module.css';

/** Settings → Sync: nearby devices, the encrypted cloud vault and read-only iCal feeds. */
export function SyncSection() {
  return (
    <div className={styles.stackLg} id="sync">
      <LanSyncCard />
      <Card as="section" id="cloud-sync" aria-labelledby="settings-cloud-title">
        <CardHeader
          title={<span id="settings-cloud-title">Encrypted cloud vault</span>}
          description="Sync events and tasks between your own devices through an end-to-end encrypted vault (AES-256-GCM). The server only ever stores ciphertext; the password never leaves this device."
        />
        <CardBody><CloudSyncSection /></CardBody>
      </Card>
      <SubscriptionsCard />
    </div>
  );
}

/* ── Nearby devices (LAN) ──────────────────────────────────────────────── */

function LanSyncCard() {
  const { addNotification } = useNotifications();
  const [peers, setPeers]           = useState<Peer[] | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredPeer[]>([]);
  const [pairInfo, setPairInfo]     = useState<PairStartResult | null>(null);
  const [pairCode, setPairCode]     = useState('');
  const [pairName, setPairName]     = useState('');
  const [busy, setBusy]             = useState(false);
  const [syncingId, setSyncingId]   = useState<number | null>(null);

  const load = useCallback(() => {
    listPeers().then(setPeers).catch(() => setPeers([]));
    getDiscoveredPeers().then(r => setDiscovered(r.peers)).catch(() => setDiscovered([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function startPairing() {
    setBusy(true);
    try {
      setPairInfo(await pairStart());
    } catch (e) {
      addNotification({ type: 'error', title: 'Pairing failed', message: errMessage(e, 'Could not start pairing.') });
    } finally {
      setBusy(false);
    }
  }

  async function completePairing() {
    if (!pairInfo || !pairCode.trim() || !pairName.trim()) return;
    setBusy(true);
    try {
      await pairComplete(pairCode.trim(), pairName.trim(), pairInfo.cert_fingerprint);
      addNotification({ type: 'success', title: 'Device paired', autoRemoveMs: 4000 });
      setPairInfo(null); setPairCode(''); setPairName('');
      load();
    } catch (e) {
      addNotification({ type: 'error', title: 'Pairing failed', message: errMessage(e, 'The code is invalid or has expired.') });
    } finally {
      setBusy(false);
    }
  }

  async function handleSync(peer: Peer) {
    setSyncingId(peer.id);
    try {
      await syncNow(peer.id);
      addNotification({ type: 'success', title: `Synced with ${peer.name}`, autoRemoveMs: 3000 });
      load();
    } catch (e) {
      addNotification({ type: 'error', title: 'Sync failed', message: errMessage(e, `${peer.name} may be offline.`) });
    } finally {
      setSyncingId(null);
    }
  }

  async function handleRemove(peer: Peer) {
    const ok = await confirm({
      title: `Remove "${peer.name}"?`,
      description: 'This device will stop syncing with it. Events already synced stay where they are; you can pair again at any time.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deletePeer(peer.id);
      load();
    } catch (e) {
      addNotification({ type: 'error', title: 'Could not remove device', message: errMessage(e) });
    }
  }

  const empty = peers !== null && peers.length === 0 && discovered.length === 0 && !pairInfo;

  return (
    <Card as="section" id="lan-sync" flush aria-labelledby="settings-lan-title">
      <CardHeader
        title={<span id="settings-lan-title">Nearby devices</span>}
        description="Sync directly with another device running LoomAssist on the same network. Nothing leaves your network."
        actions={!pairInfo && <Button size="sm" variant="secondary" icon={Icons.plus} loading={busy} onClick={startPairing}>Pair a device</Button>}
      />
      <CardBody>
        {peers === null && (
          <div className={styles.listPad} aria-busy="true">
            <div className={styles.stack}><Skeleton width="55%" /><Skeleton width="35%" /></div>
          </div>
        )}

        {empty && (
          <EmptyState
            compact
            icon={Icons.wifi}
            title="No paired devices"
            description="Start pairing here, then enter the code shown on the other device."
            action={{ label: 'Pair a device', onClick: startPairing, icon: Icons.plus }}
          />
        )}

        {peers && peers.length > 0 && (
          <div className={styles.list}>
            {peers.map(p => (
              <div key={p.id} className={styles.listRow}>
                <div className={styles.listMain}>
                  <span className={styles.listTitle}>{p.name}</span>
                  <span className={styles.listSub}>Last seen {relativeTime(p.last_seen, 'never')}</span>
                </div>
                <div className={styles.listCtl}>
                  <Button size="sm" variant="secondary" icon={Icons.sync} loading={syncingId === p.id} onClick={() => handleSync(p)}>Sync now</Button>
                  <IconButton size="sm" icon={Icons.trash} label={`Remove ${p.name}`} onClick={() => handleRemove(p)} />
                </div>
              </div>
            ))}
          </div>
        )}

        {discovered.length > 0 && (
          <div className={styles.list}>
            <div className={styles.kbGroup}>Nearby</div>
            {discovered.map((d, i) => (
              <div key={`${d.host}:${d.port}-${i}`} className={styles.listRow}>
                <div className={styles.listMain}>
                  <span className={styles.listTitle}>{d.name}</span>
                  <span className={styles.listSub}>{d.host}:{d.port}</span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setPairInfo({ host: d.host, port: d.port, cert_fingerprint: d.fingerprint, code: '', expires: '' })}
                >
                  Pair
                </Button>
              </div>
            ))}
          </div>
        )}

        {pairInfo && (
          <form className={styles.pairPanel} onSubmit={e => { e.preventDefault(); completePairing(); }}>
            {pairInfo.code ? (
              <div className={styles.stack}>
                <span className={styles.muted}>Show this code on the other device</span>
                <span className={styles.pairCode} aria-label={`Pairing code ${pairInfo.code.split('').join(' ')}`}>{pairInfo.code}</span>
                {pairInfo.expires && <span className={styles.dim}>Expires {new Date(pairInfo.expires).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
              </div>
            ) : (
              <span className={styles.muted}>Pairing with {pairInfo.host}. Enter the code shown on that device.</span>
            )}
            <div className={styles.formGrid}>
              <Field label="Name for the other device" htmlFor="pair-name">
                <Input id="pair-name" value={pairName} onChange={e => setPairName(e.target.value)} placeholder="Laptop" disabled={busy} />
              </Field>
              <Field label="Code from the other device" htmlFor="pair-code">
                <Input id="pair-code" value={pairCode} onChange={e => setPairCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" disabled={busy} />
              </Field>
            </div>
            <div className={styles.actions}>
              <Button type="submit" variant="primary" loading={busy} disabled={!pairCode.trim() || !pairName.trim()}>Confirm pairing</Button>
              <Button type="button" variant="ghost" onClick={() => setPairInfo(null)}>Cancel</Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

/* ── iCal subscriptions ────────────────────────────────────────────────── */

const DEFAULT_REFRESH = 360;

function subStatus(sub: Subscription): { label: string; tone: 'neutral' | 'success' | 'error' } {
  if (!sub.enabled) return { label: 'Paused', tone: 'neutral' };
  if (sub.last_error) return { label: 'Error', tone: 'error' };
  if (sub.last_synced) return { label: `Synced ${relativeTime(sub.last_synced)}`, tone: 'success' };
  return { label: 'Not synced yet', tone: 'neutral' };
}

function SubscriptionsCard() {
  const { addNotification } = useNotifications();
  const [subs, setSubs]           = useState<Subscription[] | null>(null);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const [adding, setAdding]       = useState(false);
  const [name, setName]           = useState('');
  const [url, setUrl]             = useState('');
  const [tlId, setTlId]           = useState<number | null>(null);
  const [minutes, setMinutes]     = useState(DEFAULT_REFRESH);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [rowBusy, setRowBusy]     = useState<number | null>(null);

  const load = useCallback(() => {
    listSubscriptions().then(setSubs).catch(() => setSubs([]));
  }, []);
  useEffect(() => {
    load();
    listCalendars().then(cs => { setTimelines(cs); setTlId(prev => prev ?? cs[0]?.id ?? null); }).catch(() => {});
  }, [load]);

  const timelineName = (id: number) => timelines.find(t => t.id === id)?.name ?? `Timeline ${id}`;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || !tlId) return;
    setBusy(true); setError(null);
    try {
      await createSubscription({
        name: name.trim() || url.trim(),
        url: url.trim(),
        timeline_id: tlId,
        refresh_minutes: Math.max(5, minutes || DEFAULT_REFRESH),
        enabled: true,
      });
      setName(''); setUrl(''); setMinutes(DEFAULT_REFRESH); setAdding(false);
      addNotification({ type: 'success', title: 'Subscribed', autoRemoveMs: 3000 });
      load();
    } catch (err) {
      setError(errMessage(err, 'Could not add this feed. Check the URL.'));
    } finally {
      setBusy(false);
    }
  }

  async function patch(sub: Subscription, changes: Partial<Pick<Subscription, 'enabled' | 'refresh_minutes' | 'name'>>) {
    setRowBusy(sub.id);
    try {
      await updateSubscription(sub.id, {
        name: sub.name, url: sub.url, timeline_id: sub.timeline_id,
        refresh_minutes: sub.refresh_minutes, enabled: sub.enabled,
        ...changes,
      });
      load();
    } catch (err) {
      addNotification({ type: 'error', title: 'Could not update subscription', message: errMessage(err) });
    } finally {
      setRowBusy(null);
    }
  }

  async function handleRefresh(sub: Subscription) {
    setRowBusy(sub.id);
    try {
      await refreshSubscription(sub.id);
      addNotification({ type: 'success', title: `Refreshed ${sub.name}`, autoRemoveMs: 3000 });
      load();
    } catch (err) {
      addNotification({ type: 'error', title: 'Refresh failed', message: errMessage(err) });
    } finally {
      setRowBusy(null);
    }
  }

  async function handleDelete(sub: Subscription) {
    const ok = await confirm({
      title: `Remove "${sub.name}"?`,
      description: 'Stops following this feed. Events it already added stay in your timeline.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteSubscription(sub.id);
      load();
    } catch (err) {
      addNotification({ type: 'error', title: 'Could not remove subscription', message: errMessage(err) });
    }
  }

  return (
    <Card as="section" id="subscriptions" flush aria-labelledby="settings-subs-title">
      <CardHeader
        title={<span id="settings-subs-title">Calendar subscriptions</span>}
        description="Follow public .ics feeds read-only. Events land in the timeline you choose and refresh on a schedule."
        actions={<Button size="sm" variant={adding ? 'ghost' : 'secondary'} icon={adding ? undefined : Icons.plus} onClick={() => { setAdding(a => !a); setError(null); }}>{adding ? 'Cancel' : 'Add subscription'}</Button>}
      />
      <CardBody>
        {adding && (
          <form className={styles.form} onSubmit={handleAdd}>
            <div className={styles.formGrid}>
              <Field label="Feed URL" htmlFor="sub-url" className={styles.formWide}>
                <Input id="sub-url" type="url" placeholder="https://example.com/calendar.ics" value={url} onChange={e => setUrl(e.target.value)} disabled={busy} required />
              </Field>
              <Field label="Name" htmlFor="sub-name" hint="Defaults to the URL.">
                <Input id="sub-name" value={name} onChange={e => setName(e.target.value)} disabled={busy} placeholder="Team holidays" />
              </Field>
              <Field label="Timeline" htmlFor="sub-tl">
                <Select id="sub-tl" value={tlId ?? ''} onChange={e => setTlId(Number(e.target.value))} disabled={busy || timelines.length === 0}>
                  {timelines.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <Field label="Refresh every (minutes)" htmlFor="sub-min">
                <Input id="sub-min" type="number" min={5} step={5} value={minutes} onChange={e => setMinutes(Number(e.target.value))} disabled={busy} />
              </Field>
            </div>
            {error && (
              <div className={`${styles.alert} ${styles.alertError}`} role="alert">
                <span className={styles.alertText}>{error}</span>
              </div>
            )}
            <div className={styles.actions}>
              <Button type="submit" variant="primary" loading={busy} disabled={!url.trim() || !tlId}>Subscribe</Button>
            </div>
          </form>
        )}

        {subs === null && (
          <div className={styles.listPad} aria-busy="true">
            <div className={styles.stack}><Skeleton width="50%" /><Skeleton width="70%" /></div>
          </div>
        )}

        {subs && subs.length === 0 && !adding && (
          <EmptyState
            compact
            icon={Icons.link}
            title="No subscriptions"
            description="Paste the URL of a public .ics calendar to follow it here."
            action={{ label: 'Add subscription', onClick: () => setAdding(true), icon: Icons.plus }}
          />
        )}

        {subs && subs.length > 0 && (
          <div className={styles.list}>
            {subs.map(sub => {
              const st = subStatus(sub);
              const rowIsBusy = rowBusy === sub.id;
              return (
                <div key={sub.id} className={styles.listRow}>
                  <div className={styles.listMain}>
                    <span className={styles.listTitle}>{sub.name}</span>
                    <span className={styles.listSub} title={sub.url}>{timelineName(sub.timeline_id)} · {sub.url}</span>
                    {sub.last_error && <span className={`${styles.listSub} ${styles.listSubError}`} title={sub.last_error}>{sub.last_error}</span>}
                  </div>
                  <Badge tone={st.tone} dot size="sm">{st.label}</Badge>
                  <div className={styles.listCtl}>
                    <RefreshMinutes key={sub.refresh_minutes} value={sub.refresh_minutes} disabled={rowIsBusy} onCommit={m => patch(sub, { refresh_minutes: m })} />
                    <Switch size="sm" checked={sub.enabled} disabled={rowIsBusy} onChange={enabled => patch(sub, { enabled })} label={<span className={styles.dim}>{sub.enabled ? 'On' : 'Off'}</span>} />
                    <IconButton size="sm" icon={Icons.refresh} label={`Refresh ${sub.name} now`} disabled={rowIsBusy || !sub.enabled} onClick={() => handleRefresh(sub)} />
                    <IconButton size="sm" icon={Icons.trash} label={`Remove ${sub.name}`} disabled={rowIsBusy} onClick={() => handleDelete(sub)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** Inline "refresh every N min" editor — commits on blur / Enter. Re-keyed by the parent on value change. */
function RefreshMinutes({ value, disabled, onCommit }: { value: number; disabled?: boolean; onCommit: (minutes: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  function commit() {
    const n = Math.max(5, Number(draft) || value);
    setDraft(String(n));
    if (n !== value) onCommit(n);
  }
  return (
    <div className={styles.inline}>
      <span className={styles.dim}>Every</span>
      <Input
        size="sm"
        type="number"
        min={5}
        step={5}
        className={styles.ctlInputSm}
        aria-label="Refresh interval in minutes"
        value={draft}
        disabled={disabled}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      />
      <span className={styles.dim}>min</span>
    </div>
  );
}
