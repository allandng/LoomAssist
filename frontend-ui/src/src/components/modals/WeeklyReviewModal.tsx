import { useState } from 'react';
import { ModalShell, ModalFooter } from './ModalShell';
import { useModal } from '../../contexts/ModalContext';
import { getWeeklyReview } from '../../api';
import styles from './WeeklyReviewModal.module.css';

interface WeeklyReviewModalProps {
  summary: string;
  weekStart: string; // ISO datetime of the Monday being reviewed
}

export function WeeklyReviewModal({ summary: initialSummary, weekStart }: WeeklyReviewModalProps) {
  const { close } = useModal();
  const [summary, setSummary] = useState(initialSummary);
  const [loading, setLoading] = useState(false);

  const weekLabel = new Date(weekStart).toLocaleDateString([], {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  async function handleRegenerate() {
    setLoading(true);
    try {
      const result = await getWeeklyReview(weekStart);
      setSummary(result.summary);
    } catch {
      // keep existing summary on failure
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell title={`Weekly Review — Week of ${weekLabel}`} onClose={close}>
      <div className={styles.body}>
        <blockquote className={styles.quote}>
          {loading ? <span className={styles.generating}>Generating…</span> : summary}
        </blockquote>
      </div>
      <ModalFooter>
        <button className="loom-btn-ghost" onClick={handleRegenerate} disabled={loading}>
          Generate again
        </button>
        <div style={{ flex: 1 }} />
        <button className="loom-btn-primary" onClick={close}>Close</button>
      </ModalFooter>
    </ModalShell>
  );
}
