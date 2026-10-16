import { useEffect, useState, type FormEvent } from 'react'
import { addDoc, collection, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { LEVELS, levelName } from '../../lib/levels'
import { mapCourseDoc } from '../../lib/courses'
import type { Course, LevelId } from '../../types'

type LevelFilter = LevelId | 'unassigned'

/**
 * Lightweight outcomes editor over the same `courses` collection Syllabus Builder
 * uses — Planning only ever edits a course's title and core outcome here; sessions,
 * topics, and the exam tab stay in Syllabus Builder. No delete here on purpose: a
 * course reachable from Planning may already have real curriculum content attached.
 */
export function PlanningPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedLevel, setSelectedLevel] = useState<LevelFilter>(1)
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)

  const [addingCourse, setAddingCourse] = useState(false)
  const [newCourseTitle, setNewCourseTitle] = useState('')

  const visibleCourses = courses.filter((c) =>
    selectedLevel === 'unassigned' ? c.levelId === null : c.levelId === selectedLevel,
  )
  const selectedCourse = courses.find((c) => c.id === selectedCourseId) ?? null

  async function loadCourses() {
    try {
      const snap = await getDocs(collection(db, 'courses'))
      const list: Course[] = []
      snap.forEach((d) => list.push(mapCourseDoc(d)))
      list.sort((a, b) => a.title.localeCompare(b.title))
      setCourses(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load subjects')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadCourses() }, [])
  useEffect(() => { setSelectedCourseId(null) }, [selectedLevel])

  async function createCourse(e: FormEvent) {
    e.preventDefault()
    const title = newCourseTitle.trim()
    if (!title) return
    setSaving(true); setError('')
    try {
      const ref = await addDoc(collection(db, 'courses'), {
        title,
        levelId: selectedLevel === 'unassigned' ? null : selectedLevel,
        createdAt: serverTimestamp(),
      })
      setNewCourseTitle(''); setAddingCourse(false)
      await loadCourses()
      setSelectedCourseId(ref.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create subject')
    } finally {
      setSaving(false)
    }
  }

  async function saveOutcome(courseId: string, patch: { title?: string; coreOutcome?: string }) {
    setSaving(true); setError('')
    setCourses((prev) => prev.map((c) => (c.id === courseId ? { ...c, ...patch } : c)))
    try {
      await updateDoc(doc(db, 'courses', courseId), patch)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      await loadCourses()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 0.35rem' }}>🗂️ Planning</h1>
      <p className="muted planning-intro">
        Pick a level, then a subject, to set the core outcome expected there. Sessions and topics are built in the Syllabus Builder.
      </p>
      {error ? <p className="error">{error}</p> : null}

      <div className="course-tabs" style={{ marginBottom: '0.85rem' }}>
        {LEVELS.map((lvl) => (
          <button key={lvl} type="button" className={`course-tab${selectedLevel === lvl ? ' active' : ''}`} onClick={() => setSelectedLevel(lvl)}>
            {levelName(lvl)}
          </button>
        ))}
        <button type="button" className={`course-tab${selectedLevel === 'unassigned' ? ' active' : ''}`} onClick={() => setSelectedLevel('unassigned')}>
          Unassigned
        </button>
      </div>

      <div className="syllabus-columns">
        {/* SUBJECTS */}
        <div className="syllabus-col">
          <div className="syllabus-col-header">
            <h2>📚 Subjects — {selectedLevel === 'unassigned' ? 'Unassigned' : levelName(selectedLevel)}</h2>
            <button type="button" className="btn small primary" onClick={() => setAddingCourse((v) => !v)}>+ Subject</button>
          </div>
          {addingCourse && (
            <form onSubmit={(e) => void createCourse(e)} className="form syllabus-mini-form">
              <input placeholder="Subject name *" value={newCourseTitle} onChange={(e) => setNewCourseTitle(e.target.value)} required autoFocus />
              <div className="row">
                <button type="submit" className="btn small primary" disabled={saving}>Save</button>
                <button type="button" className="btn small secondary" onClick={() => setAddingCourse(false)}>Cancel</button>
              </div>
            </form>
          )}
          {loading ? (
            <p className="muted small">Loading…</p>
          ) : (
            <ul className="syllabus-list">
              {visibleCourses.map((c) => (
                <li key={c.id} className={`syllabus-item${selectedCourseId === c.id ? ' active' : ''}`}>
                  <button type="button" className="syllabus-item-btn" onClick={() => setSelectedCourseId(c.id)}>
                    <span className="syllabus-item-title">{c.title}</span>
                    <span className="muted small syllabus-item-desc">{c.coreOutcome ? c.coreOutcome.slice(0, 60) : 'No core outcome yet'}</span>
                  </button>
                </li>
              ))}
              {visibleCourses.length === 0 ? <li className="muted small" style={{ padding: '0.5rem 0' }}>No subjects at this level yet.</li> : null}
            </ul>
          )}
        </div>

        {/* OUTCOME EDITOR */}
        {selectedCourse ? (
          <div className="syllabus-col syllabus-col-wide">
            <SubjectOutcomeEditor
              key={selectedCourse.id}
              course={selectedCourse}
              saving={saving}
              onSave={(patch) => void saveOutcome(selectedCourse.id, patch)}
            />
          </div>
        ) : (
          <div className="syllabus-col syllabus-col-wide" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <p style={{ fontSize: '2.5rem', margin: 0 }}>🎯</p>
            <h3>Select a subject to set its outcome</h3>
            <p className="muted">Choose a subject on the left, or add a new one.</p>
          </div>
        )}
      </div>
    </div>
  )
}

interface SubjectOutcomeEditorProps {
  course: Course
  saving: boolean
  onSave: (patch: { title?: string; coreOutcome?: string }) => void
}

function SubjectOutcomeEditor({ course, saving, onSave }: SubjectOutcomeEditorProps) {
  const [title, setTitle] = useState(course.title)
  const [outcome, setOutcome] = useState(course.coreOutcome ?? '')

  return (
    <div>
      <div className="syllabus-col-header">
        <h2>🎯 {course.title}</h2>
        {saving ? <span className="level-save-status">Saving…</span> : null}
      </div>
      <form className="form" onSubmit={(e) => { e.preventDefault(); onSave({ title: title.trim(), coreOutcome: outcome.trim() }) }}>
        <label>Subject name
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>Core outcome
          <textarea
            placeholder="What should a student be able to do after completing this subject at this level?"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            style={{ minHeight: 120 }}
          />
        </label>
        <div className="row">
          <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
