import { useId, useState } from 'react';
import styles from './courses.module.css';
import { Button, Card, CardBody, CardFooter, CardHeader, Field, Input, Select } from '../ui';
import type { Assignment } from '../../types';
import { todayYMD } from '../inbox/timeFormat';

export interface AssignmentPayload {
  title: string;
  due_date: string;
  weight_category: string | null;
  score: number | null;
  max_score: number | null;
}

interface Props {
  initial?: Assignment | null;
  /** Category names from the course's grade weights. */
  categories: string[];
  submitting?: boolean;
  onSubmit: (payload: AssignmentPayload) => void | Promise<void>;
  onCancel: () => void;
}

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

/** Add / edit an assignment: title, due date, weight category, score / max. */
export function AssignmentForm({ initial, categories, submitting, onSubmit, onCancel }: Props) {
  const editing = !!initial;
  const ids = { title: useId(), due: useId(), cat: useId(), score: useId(), max: useId() };
  const [title, setTitle] = useState(initial?.title ?? '');
  const [due, setDue] = useState(initial?.due_date?.slice(0, 10) ?? todayYMD());
  const [category, setCategory] = useState(initial?.weight_category ?? '');
  const [score, setScore] = useState(initial?.score != null ? String(initial.score) : '');
  const [maxScore, setMaxScore] = useState(initial?.max_score != null ? String(initial.max_score) : '');
  const [touched, setTouched] = useState(false);

  const options = category && !categories.includes(category) ? [...categories, category] : categories;

  const scoreN = num(score);
  const maxN = num(maxScore);
  const titleError = touched && !title.trim() ? 'A title is required.' : undefined;
  const dueError = touched && !due ? 'Pick a due date.' : undefined;
  const scoreError = scoreN != null && (!Number.isFinite(scoreN) || scoreN < 0)
    ? 'Score must be zero or more.'
    : scoreN != null && maxN != null && scoreN > maxN
      ? 'Score cannot exceed the maximum.'
      : scoreN != null && maxN == null
        ? 'Add a maximum so the score can count toward the grade.'
        : undefined;
  const maxError = maxN != null && (!Number.isFinite(maxN) || maxN <= 0) ? 'Maximum must be above zero.' : undefined;
  const blocked = !!scoreError || !!maxError;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!title.trim() || !due || blocked) return;
    onSubmit({
      title: title.trim(),
      due_date: due,
      weight_category: category || null,
      score: scoreN,
      max_score: maxN,
    });
  }

  return (
    <Card as="section" aria-label={editing ? 'Edit assignment' : 'New assignment'} elevated>
      <form onSubmit={submit} noValidate>
        <CardHeader compact title={editing ? 'Edit assignment' : 'New assignment'} />
        <CardBody className={styles.formBody}>
          <div className={styles.formGrid}>
            <Field label="Title" htmlFor={ids.title} error={titleError} className={styles.spanTwo}>
              <Input id={ids.title} value={title} onChange={e => setTitle(e.target.value)} placeholder="Problem set 3" autoFocus invalid={!!titleError} />
            </Field>
            <Field label="Due" htmlFor={ids.due} error={dueError}>
              <Input id={ids.due} type="date" value={due} onChange={e => setDue(e.target.value)} invalid={!!dueError} />
            </Field>
            <Field label="Category" htmlFor={ids.cat} hint={categories.length === 0 ? 'Add grade weights to the course to categorise work.' : undefined}>
              <Select id={ids.cat} value={category} onChange={e => setCategory(e.target.value)}>
                <option value="">Unweighted</option>
                {options.map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Score" htmlFor={ids.score} error={scoreError} hint={!scoreError ? 'Leave blank until graded.' : undefined}>
              <Input id={ids.score} type="number" inputMode="decimal" min={0} step="any" value={score} onChange={e => setScore(e.target.value)} placeholder="—" invalid={!!scoreError} />
            </Field>
            <Field label="Out of" htmlFor={ids.max} error={maxError}>
              <Input id={ids.max} type="number" inputMode="decimal" min={0} step="any" value={maxScore} onChange={e => setMaxScore(e.target.value)} placeholder="100" invalid={!!maxError} />
            </Field>
          </div>
        </CardBody>
        <CardFooter className={styles.formFooterEnd}>
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button>
          <Button type="submit" variant="primary" loading={submitting} disabled={blocked}>
            {editing ? 'Save changes' : 'Add assignment'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
