import { useMemo, useState } from 'react';
import styles from './courses.module.css';
import { Badge, Button, Card, EmptyState, Icon, IconButton, Icons, Skeleton, Toolbar, ToolbarSpacer, confirm } from '../ui';
import type { Assignment, Course } from '../../types';
import { AssignmentForm, type AssignmentPayload } from './AssignmentForm';
import { dueInfo, isGraded, parseWeights, scoreLabel, scorePercent, sortByDue } from './courseUtils';

interface Props {
  course: Course;
  assignments: Assignment[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onCreate: (payload: AssignmentPayload) => Promise<void>;
  onUpdate: (assignment: Assignment, payload: AssignmentPayload) => Promise<void>;
  onDelete: (assignment: Assignment) => Promise<void>;
  onScanSyllabus: () => void;
}

type FormState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; assignment: Assignment };

export function AssignmentsTab({ course, assignments, loading, error, onReload, onCreate, onUpdate, onDelete, onScanSyllabus }: Props) {
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const categories = useMemo(() => parseWeights(course.grade_weights).map(w => w.name), [course.grade_weights]);
  const rows = useMemo(() => sortByDue(assignments), [assignments]);
  const openCount = rows.filter(a => !isGraded(a)).length;

  async function handleSubmit(payload: AssignmentPayload) {
    setSubmitting(true);
    try {
      if (form.mode === 'edit') await onUpdate(form.assignment, payload);
      else await onCreate(payload);
      setForm({ mode: 'closed' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(a: Assignment) {
    const ok = await confirm({
      title: `Delete "${a.title}"?`,
      description: 'The assignment and its score are removed from this course. This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setDeletingId(a.id);
    try { await onDelete(a); } finally { setDeletingId(null); }
  }

  return (
    <div className={styles.tabStack}>
      <Toolbar>
        <span className={styles.toolbarText}>
          {loading ? 'Loading…' : rows.length === 0 ? 'No assignments' : `${rows.length} assignment${rows.length === 1 ? '' : 's'} · ${openCount} open`}
        </span>
        <ToolbarSpacer />
        <Button variant="ghost" icon={Icons.upload} onClick={onScanSyllabus}>Scan syllabus</Button>
        <Button variant="primary" icon={Icons.plus} onClick={() => setForm({ mode: 'create' })} disabled={form.mode !== 'closed'}>
          Add assignment
        </Button>
      </Toolbar>

      {form.mode !== 'closed' && (
        <AssignmentForm
          key={form.mode === 'edit' ? form.assignment.id : 'new'}
          initial={form.mode === 'edit' ? form.assignment : null}
          categories={categories}
          submitting={submitting}
          onSubmit={handleSubmit}
          onCancel={() => setForm({ mode: 'closed' })}
        />
      )}

      <Card flush>
        {loading && (
          <div aria-busy="true">
            {[0, 1, 2].map(i => (
              <div key={i} className={styles.skeletonRow}>
                <Skeleton width="45%" height={14} />
                <Skeleton width={88} height={17} radius={999} />
                <Skeleton width={64} height={17} radius={999} />
                <Skeleton width={56} height={14} />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className={styles.errorRow}>
            <Badge tone="error" dot>{error}</Badge>
            <Button size="sm" variant="subtle" onClick={onReload}>Retry</Button>
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <EmptyState
            icon={Icons.tasks}
            title="No assignments yet"
            description="Add one by hand, or scan the syllabus to import every due date at once."
            action={{ label: 'Add assignment', icon: Icons.plus, onClick: () => setForm({ mode: 'create' }) }}
            secondary={{ label: 'Scan syllabus', onClick: onScanSyllabus }}
          />
        )}

        {!loading && !error && rows.length > 0 && (
          <div role="table" aria-label="Assignments" className={styles.table}>
            <div role="row" className={[styles.tr, styles.thead].join(' ')}>
              <span role="columnheader" className={styles.th}>Assignment</span>
              <span role="columnheader" className={styles.th}>Due</span>
              <span role="columnheader" className={styles.th}>Category</span>
              <span role="columnheader" className={[styles.th, styles.numeric].join(' ')}>Score</span>
              <span role="columnheader" className={styles.th}><span className="sr-only">Actions</span></span>
            </div>
            {rows.map(a => {
              const graded = isGraded(a);
              const due = dueInfo(a.due_date, graded);
              const pct = scorePercent(a);
              return (
                <div role="row" key={a.id} className={[styles.tr, graded ? styles.trGraded : '', due.overdue ? styles.trOverdue : ''].join(' ')}>
                  <span role="cell" className={styles.tdTitle}>
                    <span className={[styles.statusDot, graded ? styles.statusDone : due.overdue ? styles.statusOverdue : ''].join(' ')} aria-hidden="true">
                      {graded && <Icon d={Icons.check} size={10} strokeWidth={3} />}
                    </span>
                    <span className={styles.titleText}>{a.title}</span>
                    {a.event_id != null && <Icon d={Icons.calendar} size={12} className={styles.linkedIcon} aria-label="On the calendar" />}
                  </span>
                  <span role="cell">
                    <Badge tone={due.tone} size="sm" outline={due.tone === 'neutral'} title={a.due_date}>{due.label}</Badge>
                  </span>
                  <span role="cell">
                    {a.weight_category
                      ? <Badge tone="neutral" size="sm">{a.weight_category}</Badge>
                      : <span className={styles.dim}>Unweighted</span>}
                  </span>
                  <span role="cell" className={[styles.numeric, styles.mono].join(' ')}>
                    {scoreLabel(a)}
                    {pct != null && <span className={styles.pct}>{pct}%</span>}
                  </span>
                  <span role="cell" className={styles.rowActions}>
                    <IconButton size="sm" icon={Icons.pencil} label="Edit assignment" onClick={() => setForm({ mode: 'edit', assignment: a })} />
                    <IconButton size="sm" icon={Icons.trash} label="Delete assignment" disabled={deletingId === a.id} onClick={() => handleDelete(a)} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
