import { useMemo } from 'react';
import styles from './journal.module.css';
import type { JournalEntry } from '../../types';
import { moodMeta } from './moods';
import { parseLocalDate, todayYMD } from '../inbox/timeFormat';

interface Props {
  entries: JournalEntry[];
  /** Number of trailing days to draw (default 30). */
  days?: number;
}

const W = 600;
const H = 56;
const PAD_Y = 6;

/**
 * Last-N-days mood strip. One column per day; bar height = mood level, colour
 * = mood tone. Days with several entries use the latest one. Pure SVG, tokens
 * only, so it follows light / dark / high-contrast automatically.
 */
export function MoodTimeline({ entries, days = 30 }: Props) {
  const today = todayYMD();

  const columns = useMemo(() => {
    const byDate = new Map<string, JournalEntry>();
    for (const e of entries) {
      const prev = byDate.get(e.date);
      if (!prev || e.created_at > prev.created_at) byDate.set(e.date, e);
    }
    const base = parseLocalDate(today)!;
    const out: { ymd: string; entry: JournalEntry | null }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
      const p = (n: number) => String(n).padStart(2, '0');
      const ymd = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      out.push({ ymd, entry: byDate.get(ymd) ?? null });
    }
    return out;
  }, [entries, days, today]);

  const slot = W / days;
  const barW = Math.max(4, slot * 0.6);
  const usable = H - PAD_Y * 2;
  const logged = columns.filter(c => c.entry).length;

  return (
    <figure className={styles.timeline}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.timelineSvg}
        role="img"
        aria-label={`Mood over the last ${days} days: ${logged} day${logged === 1 ? '' : 's'} logged`}
        preserveAspectRatio="none"
      >
        <line x1="0" x2={W} y1={H - PAD_Y} y2={H - PAD_Y} className={styles.timelineBase} />
        {columns.map((c, i) => {
          const x = i * slot + (slot - barW) / 2;
          const meta = c.entry ? moodMeta(c.entry.mood) : null;
          const level = meta?.level ?? 0;
          const h = c.entry ? (level === 0 ? usable * 0.15 : (usable * level) / 3) : 3;
          const y = H - PAD_Y - h;
          const cls = meta ? styles[`bar_${meta.value}`] : c.entry ? styles.bar_none : styles.bar_empty;
          const label = c.entry
            ? `${c.ymd}: ${meta?.label ?? 'no mood'}`
            : `${c.ymd}: no entry`;
          return (
            <rect key={c.ymd} x={x} y={y} width={barW} height={h} rx={2} className={[styles.bar, cls].join(' ')}>
              <title>{label}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className={styles.timelineCaption}>
        <span>{days} days ago</span>
        <span>Today</span>
      </figcaption>
    </figure>
  );
}
