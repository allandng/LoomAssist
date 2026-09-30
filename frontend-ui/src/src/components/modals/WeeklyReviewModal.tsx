import { useState, type ReactNode } from 'react';
import { ModalShell, ModalFooter } from './ModalShell';
import { Button, Skeleton, Icons } from '../ui';
import { useModal } from '../../contexts/ModalContext';
import { useNotifications } from '../../store/notifications';
import { getWeeklyReview } from '../../api';
import styles from './WeeklyReviewModal.module.css';

interface WeeklyReviewModalProps {
  summary: string;
  weekStart: string; // ISO datetime of the Monday being reviewed
}

/**
 * Tiny markdown-ish renderer for the LLM summary: `## headings`, `- bullets`,
 * `**bold**` and paragraphs. Anything else is shown as plain text.
 */
function renderProse(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = text.split(/\r?\n/);
  let para: string[] = [];
  let list: string[] = [];
  let key = 0;

  const inline = (s: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**')
        ? <strong key={i}>{part.slice(2, -2)}</strong>
        : part,
    );

  const flushPara = () => {
    if (para.length) { out.push(<p key={key++} className={styles.p}>{inline(para.join(' '))}</p>); para = []; }
  };
  const flushList = () => {
    if (list.length) {
      out.push(<ul key={key++} className={styles.ul}>{list.map((li, i) => <li key={i}>{inline(li)}</li>)}</ul>);
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flushPara(); flushList(); out.push(<h3 key={key++} className={styles.h}>{inline(h[2])}</h3>); continue; }
    const li = line.match(/^[-*•]\s+(.*)$/);
    if (li) { flushPara(); list.push(li[1]); continue; }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out;
}

export function WeeklyReviewModal({ summary: initialSummary, weekStart }: WeeklyReviewModalProps) {
  const { close } = useModal();
  const { addNotification } = useNotifications();
  const [summary, setSummary] = useState(initialSummary);
  const [loading, setLoading] = useState(false);

  const start = new Date(weekStart);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const weekLabel = isNaN(start.getTime())
    ? ''
    : `${start.toLocaleDateString([], { month: 'long', day: 'numeric' })} – ${end.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}`;

  async function handleRegenerate() {
    setLoading(true);
    try {
      const result = await getWeeklyReview(weekStart);
      setSummary(result.summary);
    } catch {
      addNotification({ type: 'error', title: 'Could not regenerate the review', autoRemoveMs: 4000 });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell title="Weekly review" subtitle={weekLabel ? `Week of ${weekLabel}` : undefined} size="md" onClose={close}>
      <article className={styles.prose} aria-busy={loading}>
        {loading ? (
          <div className={styles.skeletons}>
            <Skeleton width="45%" height={16} />
            <Skeleton width="100%" />
            <Skeleton width="92%" />
            <Skeleton width="70%" />
            <Skeleton width="100%" />
            <Skeleton width="60%" />
          </div>
        ) : summary.trim() ? renderProse(summary) : (
          <p className={styles.empty}>No summary yet — generate one for this week.</p>
        )}
      </article>
      <ModalFooter left={<Button variant="ghost" icon={Icons.refresh} onClick={() => { void handleRegenerate(); }} loading={loading}>Generate again</Button>}>
        <Button variant="primary" onClick={close}>Done</Button>
      </ModalFooter>
    </ModalShell>
  );
}
