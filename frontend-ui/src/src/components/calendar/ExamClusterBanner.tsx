// TODO: when the P0 home page ships, this banner moves to the home page
// exam-cluster widget. Tracked in LoomAssist_FutureFeatures.md.
import styles from './ExamClusterBanner.module.css';
import { Icon, Icons } from '../shared/Icon';
import type { WellnessWarning } from '../../types';

const MAX_VISIBLE_TITLES = 3;
const DISMISS_PREFIX = 'loom_exam_cluster_dismissed:';

interface ClusterContext {
  event_ids?: number[];
  titles?: string[];
  window_start?: string;
  window_end?: string;
}

export function clusterDismissKey(eventIds: number[]): string {
  return eventIds.slice().sort((a, b) => a - b).join(',');
}

export function isClusterDismissed(eventIds: number[]): boolean {
  if (!eventIds.length) return false;
  return sessionStorage.getItem(DISMISS_PREFIX + clusterDismissKey(eventIds)) === '1';
}

export function markClusterDismissed(eventIds: number[]): void {
  if (!eventIds.length) return;
  sessionStorage.setItem(DISMISS_PREFIX + clusterDismissKey(eventIds), '1');
}

export function getClusterEventIds(warning: WellnessWarning): number[] {
  const ctx = warning.context as ClusterContext | undefined;
  return Array.isArray(ctx?.event_ids) ? ctx.event_ids : [];
}

function formatRange(startISO: string, endISO: string): string {
  const start = new Date(`${startISO}T00:00`);
  const end = new Date(`${endISO}T00:00`);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return startISO === endISO ? fmt(start) : `${fmt(start)}–${fmt(end)}`;
}

interface ExamClusterBannerProps {
  warning: WellnessWarning;
  onDismiss: () => void;
}

export function ExamClusterBanner({ warning, onDismiss }: ExamClusterBannerProps) {
  const ctx = (warning.context ?? {}) as ClusterContext;
  const titles = Array.isArray(ctx.titles) ? ctx.titles : [];
  const visible = titles.slice(0, MAX_VISIBLE_TITLES);
  const overflow = titles.length - visible.length;
  const titlesText = visible.join(', ') + (overflow > 0 ? `, +${overflow} more` : '');

  const span = ctx.window_start && ctx.window_end
    ? Math.round((new Date(`${ctx.window_end}T00:00`).getTime() - new Date(`${ctx.window_start}T00:00`).getTime()) / 86_400_000) + 1
    : null;

  const headline = titles.length > 0 && span !== null
    ? `${titles.length} exams in ${span} days`
    : warning.message;

  const dates = ctx.window_start && ctx.window_end ? formatRange(ctx.window_start, ctx.window_end) : '';

  return (
    <div className={styles.banner} role="status">
      <div className={styles.body}>
        <div className={styles.headline}>{headline}</div>
        {titlesText && (
          <div className={styles.detail}>
            <span className={styles.titles}>{titlesText}</span>
            {dates && <span className={styles.dates}> ({dates})</span>}
          </div>
        )}
      </div>
      <button
        type="button"
        className={styles.dismiss}
        onClick={onDismiss}
        aria-label="Dismiss exam cluster warning"
      >
        <Icon d={Icons.x} size={12} />
      </button>
    </div>
  );
}
