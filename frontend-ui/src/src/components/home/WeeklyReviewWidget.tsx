import { useEffect, useState } from 'react';
import styles from './WeeklyReviewWidget.module.css';
import { getCachedWeeklyReview, generateWeeklyReview } from '../../api';
import { lastMonday, renderDescription, relativeTime } from '../../lib/eventUtils';
import { useNotifications } from '../../store/notifications';

export function WeeklyReviewWidget() {
  const { addNotification } = useNotifications();
  const [text, setText]               = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);
  const [tried, setTried]             = useState(false);

  const weekStart = lastMonday().toISOString();

  useEffect(() => {
    let alive = true;
    getCachedWeeklyReview(weekStart)
      .then(row => {
        if (!alive) return;
        if (row) { setText(row.markdown); setGeneratedAt(row.generated_at); }
        setTried(true);
      })
      .catch(() => { if (alive) setTried(true); });
    return () => { alive = false; };
  }, [weekStart]);

  async function generate() {
    setLoading(true);
    try {
      const row = await generateWeeklyReview(weekStart);
      setText(row.markdown);
      setGeneratedAt(row.generated_at);
    } catch {
      addNotification({ type: 'error', title: 'Review failed', message: 'Is Ollama running?' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.widget}>
      <h2 className={styles.heading}>Last Week in Review</h2>
      {text ? (
        <>
          <div
            className={styles.body}
            dangerouslySetInnerHTML={{ __html: renderDescription(text) }}
          />
          {generatedAt && (
            <div className={styles.meta}>Generated {relativeTime(new Date(generatedAt))}</div>
          )}
        </>
      ) : (
        <div className={styles.emptyRow}>
          <p className={styles.empty}>{tried ? 'No review yet for last week.' : 'Loading…'}</p>
          {tried && (
            <button className="loom-btn-primary" onClick={generate} disabled={loading}>
              {loading ? 'Generating…' : 'Generate now'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
