import { useId, useMemo, useState } from 'react';
import styles from './courses.module.css';
import { Badge, Button, Card, CardBody, CardFooter, CardHeader, Field, IconButton, Icons, Input, Select } from '../ui';
import type { Calendar, Course, GradeWeight } from '../../types';
import { TIMELINE_PALETTE, DEFAULT_TIMELINE_COLOR } from '../../lib/colors';
import { PALETTE_NAMES, parseWeights, serializeWeights, weightsTotal } from './courseUtils';

export type CoursePayload = Omit<Course, 'id'>;

interface Props {
  /** Existing course to edit; omit to create. */
  initial?: Course | null;
  timelines: Calendar[];
  submitting?: boolean;
  onSubmit: (payload: CoursePayload) => void | Promise<void>;
  onCancel: () => void;
  /** Shown only when editing. */
  onDelete?: () => void;
}

interface WeightRow { key: number; name: string; weight: string }

let rowKey = 0;
const nextKey = () => ++rowKey;

function toRows(weights: GradeWeight[]): WeightRow[] {
  return weights.map(w => ({ key: nextKey(), name: w.name, weight: String(w.weight) }));
}

/** Create / edit a course: identity, timeline, colour and the grade-weight table. */
export function CourseForm({ initial, timelines, submitting, onSubmit, onCancel, onDelete }: Props) {
  const editing = !!initial;
  const ids = { name: useId(), code: useId(), instructor: useId(), timeline: useId() };
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [instructor, setInstructor] = useState(initial?.instructor ?? '');
  const [timelineId, setTimelineId] = useState<string>(initial?.timeline_id != null ? String(initial.timeline_id) : '');
  const [color, setColor] = useState(initial?.color ?? DEFAULT_TIMELINE_COLOR);
  const [rows, setRows] = useState<WeightRow[]>(() => toRows(parseWeights(initial?.grade_weights)));
  const [touched, setTouched] = useState(false);

  const parsedWeights = useMemo<GradeWeight[]>(
    () => rows.map(r => ({ name: r.name.trim(), weight: Number(r.weight) })),
    [rows],
  );
  const total = weightsTotal(parsedWeights.filter(w => Number.isFinite(w.weight)));
  const weightErrors = rows.some(r => (r.name.trim() === '') !== (r.weight.trim() === '') || (r.weight.trim() !== '' && (!Number.isFinite(Number(r.weight)) || Number(r.weight) < 0)));
  const nameError = touched && !name.trim() ? 'A course name is required.' : undefined;

  const totalBadge = rows.length === 0
    ? null
    : total === 100
      ? <Badge tone="success" icon={Icons.check}>Total 100%</Badge>
      : total > 100
        ? <Badge tone="error" icon={Icons.warning}>Total {total}% — over by {Math.round((total - 100) * 100) / 100}%</Badge>
        : <Badge tone="warning">Total {total}% — {Math.round((100 - total) * 100) / 100}% unassigned</Badge>;

  function updateRow(key: number, patch: Partial<WeightRow>) {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!name.trim() || weightErrors) return;
    const weights = parsedWeights.filter(w => w.name && Number.isFinite(w.weight));
    onSubmit({
      name: name.trim(),
      code: code.trim() || null,
      instructor: instructor.trim() || null,
      syllabus_path: initial?.syllabus_path ?? null,
      timeline_id: timelineId ? Number(timelineId) : null,
      grade_weights: serializeWeights(weights),
      color,
    });
  }

  return (
    <Card as="section" aria-label={editing ? 'Edit course' : 'New course'}>
      <form onSubmit={submit} noValidate>
        <CardHeader
          title={editing ? 'Edit course' : 'New course'}
          description={editing ? 'Changes apply to grades and the course list right away.' : 'A course groups assignments, grades and a syllabus.'}
        />
        <CardBody className={styles.formBody}>
          <div className={styles.formGrid}>
            <Field label="Name" htmlFor={ids.name} error={nameError} className={styles.spanTwo}>
              <Input id={ids.name} value={name} onChange={e => setName(e.target.value)} placeholder="Data Structures" autoFocus invalid={!!nameError} />
            </Field>
            <Field label="Code" htmlFor={ids.code} hint="Optional, shown as a badge.">
              <Input id={ids.code} value={code} onChange={e => setCode(e.target.value)} placeholder="CS 107" />
            </Field>
            <Field label="Instructor" htmlFor={ids.instructor}>
              <Input id={ids.instructor} value={instructor} onChange={e => setInstructor(e.target.value)} placeholder="Dr. Rivera" />
            </Field>
            <Field label="Timeline" htmlFor={ids.timeline} hint="Events on this timeline show under Syllabus.">
              <Select id={ids.timeline} value={timelineId} onChange={e => setTimelineId(e.target.value)}>
                <option value="">None</option>
                {timelines.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="Colour">
              <div className={styles.swatches} role="radiogroup" aria-label="Course colour">
                {TIMELINE_PALETTE.map((hex, i) => {
                  const active = hex.toLowerCase() === color.toLowerCase();
                  return (
                    <button
                      key={hex}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={PALETTE_NAMES[i] ?? hex}
                      title={PALETTE_NAMES[i] ?? hex}
                      className={[styles.swatch, active ? styles.swatchActive : ''].join(' ')}
                      style={{ '--swatch': hex } as React.CSSProperties}
                      onClick={() => setColor(hex)}
                    />
                  );
                })}
              </div>
            </Field>
          </div>

          <div className={styles.weightsHead}>
            <div>
              <div className={styles.weightsTitle}>Grade weights</div>
              <div className={styles.weightsHint}>How much each category counts toward the final grade.</div>
            </div>
            {totalBadge}
          </div>

          {rows.length === 0 ? (
            <p className={styles.weightsEmpty}>No categories yet. Without weights, the grade is a plain average of scored work.</p>
          ) : (
            <ul className={styles.weightRows}>
              {rows.map(r => {
                const nameMissing = r.name.trim() === '' && r.weight.trim() !== '';
                const weightBad = r.weight.trim() !== '' && (!Number.isFinite(Number(r.weight)) || Number(r.weight) < 0);
                const weightMissing = r.weight.trim() === '' && r.name.trim() !== '';
                return (
                  <li key={r.key} className={styles.weightRow}>
                    <Input
                      size="sm"
                      aria-label="Category name"
                      placeholder="Midterm"
                      value={r.name}
                      invalid={nameMissing}
                      onChange={e => updateRow(r.key, { name: e.target.value })}
                    />
                    <div className={styles.weightInput}>
                      <Input
                        size="sm"
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        inputMode="decimal"
                        aria-label="Weight percent"
                        placeholder="30"
                        value={r.weight}
                        invalid={weightBad || weightMissing}
                        onChange={e => updateRow(r.key, { weight: e.target.value })}
                      />
                      <span className={styles.weightUnit} aria-hidden="true">%</span>
                    </div>
                    <IconButton size="sm" icon={Icons.x} label="Remove category" onClick={() => setRows(prev => prev.filter(x => x.key !== r.key))} />
                  </li>
                );
              })}
            </ul>
          )}
          <div>
            <Button size="sm" variant="subtle" icon={Icons.plus} onClick={() => setRows(prev => [...prev, { key: nextKey(), name: '', weight: '' }])}>
              Add category
            </Button>
          </div>
        </CardBody>
        <CardFooter className={styles.formFooter}>
          {editing && onDelete ? (
            <Button variant="danger" icon={Icons.trash} onClick={onDelete} disabled={submitting}>Delete course</Button>
          ) : <span />}
          <div className={styles.formFooterRight}>
            <Button variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button>
            <Button type="submit" variant="primary" loading={submitting} disabled={weightErrors}>
              {editing ? 'Save changes' : 'Create course'}
            </Button>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}
