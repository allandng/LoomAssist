import { useEffect, useState } from 'react';
import { Card, CardHeader, CardBody, Row, Segmented, Switch, Input } from '../ui';
import { loadSleepWindowPrefs, saveSleepWindowPrefs } from '../../lib/sleepWindow';
import styles from './settings.module.css';

type ThemeMode = 'dark' | 'light' | 'high-contrast';

function readBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  return v === 'true';
}

function useLocalToggle(key: string, fallback: boolean): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => readBool(key, fallback));
  function set(next: boolean) {
    setValue(next);
    localStorage.setItem(key, next ? 'true' : 'false');
  }
  return [value, set];
}

/** Settings → Appearance: theme, type, calendar rendering and the sleep window. */
export function AppearanceSection() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const v = localStorage.getItem('loom-theme');
    return v === 'light' || v === 'high-contrast' ? v : 'dark';
  });
  useEffect(() => {
    document.body.classList.toggle('light-mode',    theme === 'light');
    document.body.classList.toggle('high-contrast', theme === 'high-contrast');
    localStorage.setItem('loom-theme', theme);
  }, [theme]);

  const [dyslexicFont, setDyslexicFont] = useLocalToggle('loom_font_dyslexic', false);
  useEffect(() => {
    document.body.classList.toggle('font-dyslexic', dyslexicFont);
  }, [dyslexicFont]);

  const [dimPast, setDimPast]         = useLocalToggle('loom_dim_past', true);
  const [weekendWash, setWeekendWash] = useLocalToggle('loom_weekend_wash', true);
  useEffect(() => {
    document.body.classList.toggle('loom-no-weekend-wash', !weekendWash);
  }, [weekendWash]);
  const [dragShader, setDragShader]   = useLocalToggle('loom_drag_shader_enabled', true);
  const [wheelNav, setWheelNav]       = useLocalToggle('loom_wheel_nav', true);

  const [sleep, setSleep] = useState(() => loadSleepWindowPrefs());
  function updateSleep(next: Partial<typeof sleep>) {
    const merged = { ...sleep, ...next };
    setSleep(merged);
    saveSleepWindowPrefs(merged);
  }

  return (
    <Card as="section" id="appearance" aria-labelledby="settings-appearance-title">
      <CardHeader title={<span id="settings-appearance-title">Appearance</span>} description="Theme, type and how the calendar grid is drawn on this device." />
      <CardBody>
        <Row label="Theme" description="Dark is the default. High contrast meets WCAG AAA for body text.">
          <Segmented<ThemeMode>
            size="sm"
            aria-label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'high-contrast', label: 'High contrast' },
            ]}
          />
        </Row>
        <Row label="Dyslexia-friendly font" description="Set body text in OpenDyslexic.">
          <Switch checked={dyslexicFont} onChange={setDyslexicFont} label={<span className={styles.dim}>{dyslexicFont ? 'On' : 'Off'}</span>} />
        </Row>
        <Row label="Dim past events" description="Reduce the brightness of events that have already ended.">
          <Switch checked={dimPast} onChange={setDimPast} label={<span className={styles.dim}>{dimPast ? 'On' : 'Off'}</span>} />
        </Row>
        <Row label="Weekend wash" description="Tint Saturday and Sunday columns in the calendar grid.">
          <Switch checked={weekendWash} onChange={setWeekendWash} label={<span className={styles.dim}>{weekendWash ? 'On' : 'Off'}</span>} />
        </Row>
        <Row label="Conflict preview while dragging" description="Shade free and conflicting time as you move an event.">
          <Switch checked={dragShader} onChange={setDragShader} label={<span className={styles.dim}>{dragShader ? 'On' : 'Off'}</span>} />
        </Row>
        <Row label="Scroll to navigate" description="Plain scrolling in Month and Agenda views moves between periods.">
          <Switch checked={wheelNav} onChange={setWheelNav} label={<span className={styles.dim}>{wheelNav ? 'On' : 'Off'}</span>} />
        </Row>
        <Row label="Sleep window" description="Warn when an event ends after your wind-down time." divider={false}>
          <div className={styles.inline}>
            <Input
              type="time"
              size="sm"
              step={60}
              aria-label="Wind-down time"
              className={styles.ctlTime}
              value={sleep.time}
              disabled={!sleep.enabled}
              onChange={e => updateSleep({ time: e.target.value })}
            />
            <Switch checked={sleep.enabled} onChange={enabled => updateSleep({ enabled })} label={<span className={styles.dim}>{sleep.enabled ? 'On' : 'Off'}</span>} />
          </div>
        </Row>
      </CardBody>
    </Card>
  );
}
