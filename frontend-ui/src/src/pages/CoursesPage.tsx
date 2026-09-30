import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './CoursesPage.module.css';
import {
  Badge, Button, EmptyState, IconButton, Icons, Page, Skeleton, Tabs, TLDot, confirm,
} from '../components/ui';
import {
  listCourses, createCourse, updateCourse, deleteCourse,
  listAssignments, createAssignment, updateAssignment, deleteAssignment,
  getCourseGrade, listCalendars, listEvents,
} from '../api';
import type { Assignment, Calendar, Course, Event } from '../types';
import { useModal } from '../contexts/ModalContext';
import { useNotifications } from '../store/notifications';
import { CourseForm, type CoursePayload } from '../components/courses/CourseForm';
import { AssignmentsTab } from '../components/courses/AssignmentsTab';
import { GradesTab, type GradeResult } from '../components/courses/GradesTab';
import { SyllabusTab } from '../components/courses/SyllabusTab';
import type { AssignmentPayload } from '../components/courses/AssignmentForm';
import { openAssignmentCount, overdueCount } from '../components/courses/courseUtils';

type Tab = 'assignments' | 'grades' | 'syllabus';
type Mode = { kind: 'view' } | { kind: 'create' } | { kind: 'edit' };

const PANEL_KEY = 'loom:panel:courses';
const SELECTED_KEY = 'loom:courses:selected';

function readBool(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function readNumber(key: string): number | null {
  try { const v = localStorage.getItem(key); return v ? Number(v) : null; } catch { return null; }
}

export function CoursesPage() {
  const { openSyllabus, modal } = useModal();
  const { addNotification } = useNotifications();

  const [courses, setCourses] = useState<Course[] | null>(null);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);
  const [timelines, setTimelines] = useState<Calendar[]>([]);
  const [events, setEvents] = useState<Event[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);

  // The user's preferred course; the effective selection is derived below so
  // it stays valid without an effect that writes state.
  const [selectedPref, setSelectedPref] = useState<number | null>(readNumber(SELECTED_KEY));
  const [tab, setTab] = useState<Tab>('assignments');
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [collapsed, setCollapsed] = useState(() => readBool(PANEL_KEY));
  const [saving, setSaving] = useState(false);

  // Grade for exactly one course; "loading" = no result for the selected one yet.
  const [gradeState, setGradeState] = useState<{ courseId: number; grade: GradeResult | null; error: string | null } | null>(null);
  const [assumedPct, setAssumedPct] = useState(80);

  /* ── Loading (state is set only inside promise callbacks) ─────────────── */
  const loadCourses = useCallback(() =>
    listCourses()
      .then(rows => { setCourses(rows); setCoursesError(null); })
      .catch(() => { setCourses(prev => prev ?? []); setCoursesError('Could not load courses. Is the backend running?'); }),
  []);

  const loadAssignments = useCallback(() =>
    listAssignments()
      .then(rows => { setAssignments(rows); setAssignmentsError(null); })
      .catch(() => { setAssignments(prev => prev ?? []); setAssignmentsError('Could not load assignments.'); }),
  []);

  const loadEvents = useCallback(() =>
    listEvents()
      .then(rows => { setEvents(rows); setEventsError(null); })
      .catch(() => { setEvents(prev => prev ?? []); setEventsError('Could not load events.'); }),
  []);

  const fetchGrade = useCallback((courseId: number) =>
    getCourseGrade(courseId)
      .then(g => { setGradeState({ courseId, grade: g, error: null }); })
      .catch(() => { setGradeState({ courseId, grade: null, error: 'Could not compute the grade.' }); }),
  []);

  useEffect(() => {
    loadCourses();
    loadAssignments();
    listCalendars().then(setTimelines).catch(() => {});
  }, [loadCourses, loadAssignments]);

  /* ── Derived ─────────────────────────────────────────────────────────── */
  const selectedId = useMemo<number | null>(() => {
    if (!courses) return selectedPref;
    if (selectedPref != null && courses.some(c => c.id === selectedPref)) return selectedPref;
    return courses[0]?.id ?? null;
  }, [courses, selectedPref]);

  const selected = useMemo(() => courses?.find(c => c.id === selectedId) ?? null, [courses, selectedId]);
  const grade = gradeState && gradeState.courseId === selectedId ? gradeState.grade : null;
  const gradeError = gradeState && gradeState.courseId === selectedId ? gradeState.error : null;
  const gradeLoading = selectedId != null && (gradeState === null || gradeState.courseId !== selectedId);

  // Lazy: events are only needed by the Syllabus tab.
  useEffect(() => {
    if (tab === 'syllabus' && events === null && !eventsError) loadEvents();
  }, [tab, events, eventsError, loadEvents]);

  useEffect(() => {
    try {
      if (selectedId == null) localStorage.removeItem(SELECTED_KEY);
      else localStorage.setItem(SELECTED_KEY, String(selectedId));
    } catch { /* storage unavailable */ }
  }, [selectedId]);

  useEffect(() => {
    if (selectedId != null) fetchGrade(selectedId);
  }, [selectedId, fetchGrade]);

  // The syllabus scanner is a global modal; refresh when it closes.
  const prevModal = useRef(modal.name);
  useEffect(() => {
    if (prevModal.current === 'syllabus' && modal.name !== 'syllabus') {
      loadCourses();
      loadAssignments();
      loadEvents();
      if (selectedId != null) fetchGrade(selectedId);
    }
    prevModal.current = modal.name;
  }, [modal.name, loadCourses, loadAssignments, loadEvents, fetchGrade, selectedId]);
  const courseAssignments = useMemo(
    () => (assignments ?? []).filter(a => a.course_id === selectedId),
    [assignments, selectedId],
  );

  /* ── Actions ─────────────────────────────────────────────────────────── */
  function toggleCollapsed() {
    setCollapsed(v => {
      const next = !v;
      try { localStorage.setItem(PANEL_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ }
      return next;
    });
  }

  function selectCourse(id: number) {
    setSelectedPref(id);
    setMode({ kind: 'view' });
    setAssumedPct(80);
  }

  async function handleCreateCourse(payload: CoursePayload) {
    setSaving(true);
    try {
      const created = await createCourse(payload);
      await loadCourses();
      setSelectedPref(created.id);
      setMode({ kind: 'view' });
      setTab('assignments');
      addNotification({ type: 'success', title: 'Course created', message: created.name, autoRemoveMs: 3500 });
    } catch {
      addNotification({ type: 'error', title: 'Could not create the course', autoRemoveMs: 6000 });
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateCourse(payload: CoursePayload) {
    if (!selected) return;
    setSaving(true);
    try {
      await updateCourse(selected.id, payload);
      await loadCourses();
      await fetchGrade(selected.id);
      setMode({ kind: 'view' });
      addNotification({ type: 'success', title: 'Course updated', autoRemoveMs: 3000 });
    } catch {
      addNotification({ type: 'error', title: 'Could not save the course', autoRemoveMs: 6000 });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCourse() {
    if (!selected) return;
    const ok = await confirm({
      title: `Delete "${selected.name}"?`,
      description: 'Its assignments and grades will no longer be shown. Events on the linked timeline are kept.',
      destructive: true,
      confirmLabel: 'Delete course',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await deleteCourse(selected.id);
      setMode({ kind: 'view' });
      await loadCourses();
      addNotification({ type: 'success', title: 'Course deleted', message: selected.name, autoRemoveMs: 3500 });
    } catch {
      addNotification({ type: 'error', title: 'Could not delete the course', autoRemoveMs: 6000 });
    } finally {
      setSaving(false);
    }
  }

  async function refreshAfterAssignmentChange() {
    await loadAssignments();
    if (selectedId != null) await fetchGrade(selectedId);
  }

  async function handleCreateAssignment(payload: AssignmentPayload) {
    if (!selected) return;
    try {
      await createAssignment({ course_id: selected.id, ...payload, event_id: null });
      await refreshAfterAssignmentChange();
      addNotification({ type: 'success', title: 'Assignment added', message: payload.title, autoRemoveMs: 3000 });
    } catch {
      addNotification({ type: 'error', title: 'Could not add the assignment', autoRemoveMs: 6000 });
      throw new Error('create failed');
    }
  }

  async function handleUpdateAssignment(a: Assignment, payload: AssignmentPayload) {
    try {
      await updateAssignment(a.id, payload);
      await refreshAfterAssignmentChange();
      addNotification({ type: 'success', title: 'Assignment updated', autoRemoveMs: 3000 });
    } catch {
      addNotification({ type: 'error', title: 'Could not save the assignment', autoRemoveMs: 6000 });
      throw new Error('update failed');
    }
  }

  async function handleDeleteAssignment(a: Assignment) {
    try {
      await deleteAssignment(a.id);
      await refreshAfterAssignmentChange();
      addNotification({ type: 'success', title: 'Assignment deleted', message: a.title, autoRemoveMs: 3000 });
    } catch {
      addNotification({ type: 'error', title: 'Could not delete the assignment', autoRemoveMs: 6000 });
    }
  }

  /* ── Render ──────────────────────────────────────────────────────────── */
  const loadingCourses = courses === null;
  const list = courses ?? [];

  return (
    <Page bare className={styles.page}>
      <aside className={[styles.panel, collapsed ? styles.panelCollapsed : ''].join(' ')} aria-label="Courses">
        <div className={styles.panelHead}>
          {!collapsed && (
            <div className={styles.panelTitleRow}>
              <h2 className={styles.panelTitle}>Courses</h2>
              {list.length > 0 && <Badge size="sm" tone="neutral">{list.length}</Badge>}
            </div>
          )}
          <div className={styles.panelActions}>
            {!collapsed && (
              <IconButton icon={Icons.plus} label="Add course" size="sm" onClick={() => setMode({ kind: 'create' })} active={mode.kind === 'create'} />
            )}
            <IconButton
              icon={collapsed ? Icons.chevronsRight : Icons.chevronsLeft}
              label={collapsed ? 'Expand course list' : 'Collapse course list'}
              size="sm"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
            />
          </div>
        </div>

        <div className={styles.panelBody}>
          {loadingCourses && (
            <div aria-busy="true" className={styles.panelSkeletons}>
              {[0, 1, 2].map(i => (
                <div key={i} className={styles.panelSkeletonRow}>
                  <Skeleton width={8} height={8} radius={4} />
                  {!collapsed && <Skeleton width="70%" height={13} />}
                </div>
              ))}
            </div>
          )}

          {!loadingCourses && coursesError && !collapsed && (
            <div className={styles.panelError}>
              <Badge tone="error" dot>{coursesError}</Badge>
              <Button size="sm" variant="subtle" onClick={loadCourses}>Retry</Button>
            </div>
          )}

          {!loadingCourses && !coursesError && list.length === 0 && !collapsed && (
            <EmptyState
              compact
              icon={Icons.graduation}
              title="No courses yet"
              description="Add a course or scan a syllabus."
              action={{ label: 'Add course', icon: Icons.plus, onClick: () => setMode({ kind: 'create' }) }}
              secondary={{ label: 'Scan syllabus', onClick: openSyllabus }}
            />
          )}

          {list.length > 0 && (
            <ul className={styles.courseList} role="list">
              {list.map(c => {
                const open = assignments ? openAssignmentCount(assignments, c.id) : 0;
                const overdue = assignments ? overdueCount(assignments, c.id) : 0;
                const active = c.id === selectedId && mode.kind !== 'create';
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={[styles.courseRow, active ? styles.courseRowActive : ''].join(' ')}
                      onClick={() => selectCourse(c.id)}
                      aria-current={active ? 'true' : undefined}
                      title={collapsed ? c.name : undefined}
                    >
                      <TLDot color={c.color} size={collapsed ? 12 : 8} />
                      {!collapsed && (
                        <>
                          <span className={styles.courseText}>
                            <span className={styles.courseName}>{c.name}</span>
                            {c.code && <span className={styles.courseCode}>{c.code}</span>}
                          </span>
                          {overdue > 0 ? (
                            <Badge size="sm" tone="error">{overdue} overdue</Badge>
                          ) : open > 0 ? (
                            <Badge size="sm" tone="neutral">{open} due</Badge>
                          ) : null}
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <main className={styles.detail}>
        <div className={styles.detailInner}>
          {mode.kind === 'create' ? (
            <CourseForm
              key="create"
              timelines={timelines}
              submitting={saving}
              onSubmit={handleCreateCourse}
              onCancel={() => setMode({ kind: 'view' })}
            />
          ) : loadingCourses ? (
            <div className={styles.detailSkeleton} aria-busy="true">
              <div className={styles.detailSkeletonHead}>
                <Skeleton width={14} height={14} radius={7} />
                <Skeleton width={220} height={24} />
              </div>
              <Skeleton width={160} height={13} />
              <Skeleton width="100%" height={36} />
              <Skeleton width="100%" height={160} radius={12} />
            </div>
          ) : !selected ? (
            <EmptyState
              icon={Icons.graduation}
              title={list.length === 0 ? 'No courses yet' : 'Pick a course'}
              description={list.length === 0
                ? 'Add a course by hand, or scan a syllabus to set one up with its due dates.'
                : 'Choose a course on the left to see its assignments, grades and syllabus.'}
              action={{ label: 'Add course', icon: Icons.plus, onClick: () => setMode({ kind: 'create' }) }}
              secondary={{ label: 'Scan syllabus', onClick: openSyllabus }}
            />
          ) : mode.kind === 'edit' ? (
            <CourseForm
              key={`edit-${selected.id}`}
              initial={selected}
              timelines={timelines}
              submitting={saving}
              onSubmit={handleUpdateCourse}
              onCancel={() => setMode({ kind: 'view' })}
              onDelete={handleDeleteCourse}
            />
          ) : (
            <>
              <header className={styles.detailHead}>
                <div className={styles.detailTitleBlock}>
                  <div className={styles.detailTitleRow}>
                    <span className={styles.swatch} style={{ background: selected.color }} aria-hidden="true" />
                    <h1 className={styles.detailTitle}>{selected.name}</h1>
                    {selected.code && <Badge tone="accent">{selected.code}</Badge>}
                  </div>
                  <p className={styles.detailMeta}>
                    {selected.instructor ? selected.instructor : <span className={styles.detailMetaDim}>No instructor listed</span>}
                  </p>
                </div>
                <div className={styles.detailActions}>
                  <Button variant="ghost" icon={Icons.pencil} onClick={() => setMode({ kind: 'edit' })}>Edit</Button>
                </div>
              </header>

              <Tabs<Tab>
                aria-label="Course sections"
                value={tab}
                onChange={setTab}
                items={[
                  { value: 'assignments', label: 'Assignments', icon: Icons.tasks, count: courseAssignments.length },
                  { value: 'grades', label: 'Grades', icon: Icons.chart },
                  { value: 'syllabus', label: 'Syllabus', icon: Icons.doc },
                ]}
              />

              <div className={styles.tabPanel} role="tabpanel">
                {tab === 'assignments' && (
                  <AssignmentsTab
                    course={selected}
                    assignments={courseAssignments}
                    loading={assignments === null}
                    error={assignmentsError}
                    onReload={loadAssignments}
                    onCreate={handleCreateAssignment}
                    onUpdate={handleUpdateAssignment}
                    onDelete={handleDeleteAssignment}
                    onScanSyllabus={openSyllabus}
                  />
                )}
                {tab === 'grades' && (
                  <GradesTab
                    course={selected}
                    assignments={courseAssignments}
                    grade={grade}
                    loading={gradeLoading || assignments === null}
                    error={gradeError}
                    onReload={() => { setGradeState(null); fetchGrade(selected.id); }}
                    assumedPct={assumedPct}
                    onAssumedPct={setAssumedPct}
                    onEditWeights={() => setMode({ kind: 'edit' })}
                  />
                )}
                {tab === 'syllabus' && (
                  <SyllabusTab
                    course={selected}
                    timelines={timelines}
                    events={events}
                    eventsError={eventsError}
                    onReloadEvents={loadEvents}
                    onScan={openSyllabus}
                    onEdit={() => setMode({ kind: 'edit' })}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </Page>
  );
}
