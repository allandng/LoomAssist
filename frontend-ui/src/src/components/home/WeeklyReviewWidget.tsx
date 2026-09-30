import { useEffect, useMemo, useState } from 'react';
import styles from './WeeklyReviewWidget.module.css';
import { getCachedWeeklyReview, generateWeeklyReview } from '../../api';
import { lastMonday, renderDescription } from '../../lib/eventUtils';
import { relativeTime } from '../../lib/time';
import { useNotifications } from '../../store/notifications';
import { useModal } from '../../contexts/ModalContext';
import { Card, CardHeader, CardBody, CardFooter, Button, Badge, EmptyState, Skeleton, Icons } from '../ui';
import { addDays } from '../tasks/taskUtils';

export function WeeklyReviewWidget() {
  const { addNotification } = useNotifications();
  const { openWeeklyReview } = useModal();
  const [text, setText]               = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [generating, setGenerating]   = useState(false);
  const [error, setError]             = useState(false);

  const weekStart = useMemo(() => lastMonday(), []);
  const weekStartISO = weekStart.toISOString();
  const rangeLabel = `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;

  useEffect(() => {
    let alive = true;
    getCachedWeeklyReview(weekStartISO)
      .then(row => {
        if (!alive) return;
        if (row) { setText(row.markdown); setGeneratedAt(row.generated_at); }
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [weekStartISO]);

  async function generate() {
    setGenerating(true);
    try {
      const row = await generateWeeklyReview(weekStartISO);
      setText(row.markdown);
      setGeneratedAt(row.generated_at);
      setError(false);
    } catch {
      addNotification({ type: 'error', title: 'Review failed', message: 'Is Ollama running?' });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Weekly review"
        description={`Last week · ${rangeLabel}`}
        actions={
          text ? (
            <Button size="sm" variant="subtle" iconRight={Icons.arrowRight} onClick={() => openWeeklyReview(text, weekStartISO)}>
              Open
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        {error && (
          <div className={styles.errorRow} role="alert">
            <Badge tone="error" icon={Icons.alertCircle}>Couldn't load the review</Badge>
          </div>
        )}
        {loading ? (
          <div className={styles.skeleton} aria-hidden="true">
            <Skeleton width="95%" height={12} />
            <Skeleton width="88%" height={12} />
            <Skeleton width="70%" height={12} />
          </div>
        ) : text ? (
          <>
            <div className={styles.excerpt} dangerouslySetInnerHTML={{ __html: renderDescription(text) }} />
            {generatedAt && <div className={styles.meta}>Generated {relativeTime(generatedAt)}</div>}
          </>
        ) : (
          <>
            <EmptyState
              compact
              icon={Icons.sparkles}
              title="No review yet"
              description="Summarize last week's events and tasks with the local model."
            />
            <div className={styles.center}>
              <Button variant="primary" size="sm" icon={Icons.sparkles} loading={generating} onClick={generate}>
                Generate review
              </Button>
            </div>
          </>
        )}
      </CardBody>
      {text && (
        <CardFooter>
          <Button size="sm" variant="ghost" icon={Icons.refresh} loading={generating} onClick={generate}>
            Regenerate
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
