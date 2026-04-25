import { useState, useEffect, useCallback } from 'react';
import {
  listCourses, createCourse, deleteCourse,
  listAssignments, createAssignment, updateAssignment, deleteAssignment,
  getCourseGrade,
} from '../api';
import type { Course, Assignment, GradeWeight } from '../types';
import { Icon, Icons } from '../components/shared/Icon';

export function CoursesPage() {
  const [courses, setCourses]           = useState<Course[]>([]);
  const [selectedId, setSelectedId]     = useState<number | null>(null);
  const [assignments, setAssignments]   = useState<Assignment[]>([]);
  const [grade, setGrade]               = useState<{ grade: number | null; breakdown: Record<string, number | null> } | null>(null);
  const [adding, setAdding]             = useState(false);
  const [newName, setNewName]           = useState('');
  const [newCode, setNewCode]           = useState('');

  const loadCourses = useCallback(() => { listCourses().then(setCourses).catch(() => {}); }, []);
  useEffect(() => { loadCourses(); }, [loadCourses]);

  const selected = courses.find(c => c.id === selectedId) ?? null;

  async function loadCourseDetail(id: number) {
    const [asgns, g] = await Promise.all([listAssignments(id), getCourseGrade(id)]);
    setAssignments(asgns);
    setGrade(g);
  }

  async function handleSelectCourse(id: number) {
    setSelectedId(id);
    await loadCourseDetail(id);
  }

  async function handleAddCourse() {
    if (!newName.trim()) return;
    await createCourse({ name: newName.trim(), code: newCode.trim() || null, instructor: null, syllabus_path: null, timeline_id: null, grade_weights: '[]', color: '#6366f1' });
    setNewName(''); setNewCode(''); setAdding(false);
    loadCourses();
  }

  async function handleDeleteCourse(id: number) {
    await deleteCourse(id);
    if (selectedId === id) { setSelectedId(null); setAssignments([]); setGrade(null); }
    loadCourses();
  }

  async function handleScoreChange(a: Assignment, score: string) {
    await updateAssignment(a.id, { score: score === '' ? null : Number(score) });
    if (selectedId) loadCourseDetail(selectedId);
  }

  async function handleDeleteAssignment(id: number) {
    await deleteAssignment(id);
    if (selectedId) loadCourseDetail(selectedId);
  }

  async function handleAddAssignment(courseId: number) {
    const title    = window.prompt('Assignment title:');
    if (!title?.trim()) return;
    const due_date = window.prompt('Due date (YYYY-MM-DD):') ?? '';
    await createAssignment({ course_id: courseId, title: title.trim(), due_date, weight_category: null, score: null, max_score: null, event_id: null });
    loadCourseDetail(courseId);
  }

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-main)' }}>
      {/* Course list */}
      <div style={{ width: 240, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <div style={{ padding: '16px 16px 8px', fontWeight: 700, fontSize: 14, color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Courses
          <button onClick={() => setAdding(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)' }}>
            <Icon d={Icons.plus} size={16} />
          </button>
        </div>

        {adding && (
          <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input className="loom-field" placeholder="Course name" value={newName} onChange={e => setNewName(e.target.value)} style={{ fontSize: 12 }} autoFocus />
            <input className="loom-field" placeholder="Code (e.g. CS107)" value={newCode} onChange={e => setNewCode(e.target.value)} style={{ fontSize: 12 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="loom-btn-primary" style={{ fontSize: 11, flex: 1 }} onClick={handleAddCourse}>Add</button>
              <button className="loom-btn-ghost" style={{ fontSize: 11 }} onClick={() => setAdding(false)}>✕</button>
            </div>
          </div>
        )}

        {courses.map(c => (
          <div
            key={c.id}
            onClick={() => handleSelectCourse(c.id)}
            style={{
              padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: c.id === selectedId ? 'var(--accent-soft)' : 'transparent',
              borderLeft: c.id === selectedId ? '3px solid var(--accent)' : '3px solid transparent',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-main)' }}>{c.name}</div>
              {c.code && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.code}</div>}
            </div>
            <button onClick={e => { e.stopPropagation(); handleDeleteCourse(c.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <Icon d={Icons.x} size={12} />
            </button>
          </div>
        ))}

        {courses.length === 0 && !adding && (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No courses yet</div>
        )}
      </div>

      {/* Detail */}
      {selected ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 20, color: 'var(--text-main)' }}>
            {selected.name}{selected.code ? ` — ${selected.code}` : ''}
          </h2>
          {selected.instructor && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Instructor: {selected.instructor}</div>}

          {/* Grade summary */}
          {grade && (
            <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 8 }}>
                Current Grade: <span style={{ color: grade.grade !== null && grade.grade >= 70 ? 'var(--success)' : 'var(--error)' }}>{grade.grade !== null ? `${grade.grade}%` : 'N/A'}</span>
              </div>
              {Object.entries(grade.breakdown).map(([cat, pct]) => (
                <div key={cat} style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>
                  {cat}: {pct !== null ? `${pct}%` : '—'}
                </div>
              ))}
              {(() => {
                const weights: GradeWeight[] = (() => { try { return JSON.parse(selected.grade_weights); } catch { return []; } })();
                return weights.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
                    Weights: {weights.map(w => `${w.name} ${w.weight}%`).join(' · ')}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Assignments */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>Assignments</span>
            <button className="loom-btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleAddAssignment(selected.id)}>
              + Add
            </button>
          </div>
          {assignments.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No assignments yet.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {assignments.map(a => (
              <div key={a.id} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-main)' }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Due: {a.due_date}{a.weight_category ? ` · ${a.weight_category}` : ''}</div>
                </div>
                <input
                  type="number" placeholder="Score"
                  defaultValue={a.score ?? ''}
                  onBlur={e => handleScoreChange(a, e.target.value)}
                  style={{ width: 70, fontSize: 12, padding: '2px 6px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-main)' }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/ {a.max_score ?? '?'}</span>
                <button onClick={() => handleDeleteAssignment(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                  <Icon d={Icons.x} size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
          Select a course
        </div>
      )}
    </div>
  );
}

export function CoursesSidebarContent() { return null; }
