import { useState } from 'react';
import { Card, CardHeader, CardBody, Row, Button, Badge, Icons } from '../ui';
import { reindexSearch } from '../../api';
import { useNotifications } from '../../store/notifications';
import { DurationStatsPanel } from '../shared/DurationStatsPanel';
import { APP_VERSION, REPO_URL, ISSUES_URL, LICENSE } from '../../lib/version';
import { errMessage, modKey, openExternal, platformLabel } from './util';
import styles from './settings.module.css';

/** Settings → Advanced + About. */
export function AboutSection() {
  const { addNotification } = useNotifications();
  const [reindexing, setReindexing] = useState(false);

  async function handleReindex() {
    setReindexing(true);
    try {
      const res = await reindexSearch();
      addNotification({ type: 'success', title: 'Search index rebuilt', message: `${res.reindexed} events indexed.`, autoRemoveMs: 4000 });
    } catch (e) {
      addNotification({ type: 'error', title: 'Re-index failed', message: errMessage(e, 'Could not index events. Is the local model running?') });
    } finally {
      setReindexing(false);
    }
  }

  return (
    <div className={styles.stackLg} id="advanced">
      <Card as="section" aria-labelledby="settings-advanced-title">
        <CardHeader title={<span id="settings-advanced-title">Advanced</span>} description="Maintenance tasks you rarely need." />
        <CardBody>
          <Row label="Semantic search index" description="Rebuild the on-device embeddings after enabling semantic search or upgrading the local model.">
            <Button variant="secondary" icon={Icons.refresh} loading={reindexing} onClick={handleReindex}>Re-index</Button>
          </Row>
          <Row label="Print current view" description="Prints the calendar as shown. App chrome is hidden automatically." divider={false}>
            <Button variant="secondary" kbd={`${modKey()}P`} onClick={() => window.print()}>Print</Button>
          </Row>
        </CardBody>
      </Card>

      <Card as="section" aria-labelledby="settings-time-title">
        <CardHeader title={<span id="settings-time-title">Time accuracy</span>} description="How your planned durations compare with clocked-in reality." />
        <CardBody>
          <DurationStatsPanel />
        </CardBody>
      </Card>

      <Card as="section" id="about" aria-labelledby="settings-about-title">
        <CardHeader title={<span id="settings-about-title">About LoomAssist</span>} description="A local-first planner. Your data and AI inference stay on this device." />
        <CardBody>
          <Row label="Version"><Badge tone="neutral"><span className={styles.mono}>{APP_VERSION}</span></Badge></Row>
          <Row label="Platform"><span className={styles.value}>{platformLabel()}</span></Row>
          <Row label="License"><span className={styles.value}>{LICENSE}</span></Row>
          <Row label="Source code" description="Browse the code, changelog and docs.">
            <Button variant="subtle" size="sm" iconRight={Icons.externalLink} onClick={() => openExternal(REPO_URL)}>GitHub</Button>
          </Row>
          <Row label="Report a problem" description="Attach an exported log if you can." divider={false}>
            <Button variant="subtle" size="sm" iconRight={Icons.externalLink} onClick={() => openExternal(ISSUES_URL)}>Open an issue</Button>
          </Row>
        </CardBody>
      </Card>
    </div>
  );
}
