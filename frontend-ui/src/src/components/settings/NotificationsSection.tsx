import { useState } from 'react';
import { Card, CardHeader, CardBody, Row, Switch, Badge, Button } from '../ui';
import styles from './settings.module.css';

function useLocalToggle(key: string, fallback: boolean): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'true';
  });
  function set(next: boolean) {
    setValue(next);
    localStorage.setItem(key, next ? 'true' : 'false');
  }
  return [value, set];
}

type Permission = 'granted' | 'denied' | 'default' | 'unsupported';

function readPermission(): Permission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** Settings → Notifications: reminders, system permission, spoken briefing, crash logs. */
export function NotificationsSection() {
  const [reminders, setReminders]   = useLocalToggle('loom_reminders_enabled', true);
  const [speak, setSpeak]           = useLocalToggle('loom_speak_briefing', false);
  const [crash, setCrash]           = useLocalToggle('loom_crash_reports_enabled', true);
  const [permission, setPermission] = useState<Permission>(readPermission);
  const [asking, setAsking]         = useState(false);

  async function requestPermission() {
    if (typeof Notification === 'undefined') return;
    setAsking(true);
    try {
      const p = await Notification.requestPermission();
      setPermission(p);
    } finally {
      setAsking(false);
    }
  }

  const permBadge = (() => {
    switch (permission) {
      case 'granted':     return <Badge tone="success" dot>Allowed</Badge>;
      case 'denied':      return <Badge tone="error" dot>Blocked in system settings</Badge>;
      case 'unsupported': return <Badge tone="neutral">Not available</Badge>;
      default:            return <Badge tone="neutral" dot>Not asked yet</Badge>;
    }
  })();

  return (
    <Card as="section" id="notifications" aria-labelledby="settings-notifications-title">
      <CardHeader title={<span id="settings-notifications-title">Notifications</span>} description="Reminders and alerts on this device. Nothing here is sent anywhere." />
      <CardBody>
        <Row label="Event reminders" description="Notify before events that have a reminder set, in the app and through the system.">
          <Switch checked={reminders} onChange={setReminders} label={<span className={styles.dim}>{reminders ? 'On' : 'Off'}</span>} />
        </Row>
        <Row label="System notifications" description="Let LoomAssist post native notifications through your operating system.">
          <div className={styles.inline}>
            {permBadge}
            {permission === 'default' && (
              <Button size="sm" variant="secondary" loading={asking} onClick={requestPermission}>Allow</Button>
            )}
          </div>
        </Row>
        <Row label="Speak today's agenda at startup" description="Reads the morning briefing aloud using your system's text-to-speech voice.">
          <Switch checked={speak} onChange={setSpeak} label={<span className={styles.dim}>{speak ? 'On' : 'Off'}</span>} />
        </Row>
        <Row label="Crash reports" description="Keep a local log when the app crashes so you can export it later. Stored only on this device." divider={false}>
          <Switch checked={crash} onChange={setCrash} label={<span className={styles.dim}>{crash ? 'On' : 'Off'}</span>} />
        </Row>
      </CardBody>
    </Card>
  );
}
