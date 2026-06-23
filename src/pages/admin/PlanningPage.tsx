import { useEffect, useRef, useState } from 'react'
import { collection, doc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { Course, Session } from '../../types'
import { readTopicsFromSessionDoc } from '../../lib/topics'

function formatDuration(minutes: number): string {
  if (minutes <= 0) return ''
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function PlanningPage() {
  const [tab, setTab] = useState<'sessions' | 'levels'>('sessions')
  const [courses, setCourses] = useState<Course[]>([])
  const [loadingCourses, setLoadingCourses] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const snap = await getDocs(collection(db, 'courses'))
        const list: Course[] = []
        snap.forEach((d) => {
          const x = d.data()
          list.push({ id: d.id, title: (x.title as string) ?? '' })
        })
        list.sort((a, b) => a.title.localeCompare(b.title))
        setCourses(list)
      } finally {
        setLoadingCourses(false)
      }
    })()
  }, [])

  return (
    <div>
      <h1 style={{ margin: '0 0 1.25rem' }}>🗂️ Planning</h1>

      <div className="course-tabs" style={{ marginBottom: '1.5rem' }}>
        <button type="button" className={`course-tab${tab === 'sessions' ? ' active' : ''}`} onClick={() => setTab('sessions')}>
          Sessions
        </button>
        <button type="button" className={`course-tab${tab === 'levels' ? ' active' : ''}`} onClick={() => setTab('levels')}>
          Levels
        </button>
      </div>

      {tab === 'sessions' && <SessionsTab courses={courses} loadingCourses={loadingCourses} />}
      {tab === 'levels' && <LevelsTab courses={courses} loadingCourses={loadingCourses} />}
    </div>
  )
}

// ─── Sessions tab ─────────────────────────────────────────────────────────────

interface SessionsTabProps {
  courses: Course[]
  loadingCourses: boolean
}

function SessionsTab({ courses, loadingCourses }: SessionsTabProps) {
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState('')
  const loadIdRef = useRef(0)

  async function loadSessions(courseId: string) {
    const thisLoad = ++loadIdRef.current
    setLoadingSessions(true)
    setError('')
    setSessions([])
    try {
      const snap = await getDocs(query(collection(db, 'sessions'), where('courseId', '==', courseId)))
      if (thisLoad !== loadIdRef.current) return
      const list: Session[] = []
      snap.forEach((d) => {
        const x = d.data()
        list.push({
          id: d.id, title: (x.title as string) ?? '', subtitle: (x.subtitle as string) ?? '',
          courseId: (x.courseId as string) ?? null, courseName: (x.courseName as string) ?? '',
          order: Number(x.order ?? 0), activities: readTopicsFromSessionDoc(x.activities),
        })
      })
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      setSessions(list)
    } catch (e) {
      if (thisLoad !== loadIdRef.current) return
      setError(e instanceof Error ? e.message : 'Failed to load sessions')
    } finally {
      if (thisLoad === loadIdRef.current) setLoadingSessions(false)
    }
  }

  function handleCourseChange(courseId: string) {
    setSelectedCourseId(courseId)
    if (courseId) void loadSessions(courseId)
    else setSessions([])
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <p className="muted small" style={{ margin: 0 }}>Drag sessions to reorder them within a course.</p>
        {saveStatus === 'saving' && <span className="muted small">Saving…</span>}
        {saveStatus === 'saved' && <span className="muted small" style={{ color: 'var(--success, green)' }}>Saved</span>}
        {saveStatus === 'error' && <span className="muted small" style={{ color: 'var(--error, red)' }}>Save failed</span>}
      </div>
      <div style={{ marginBottom: '1.5rem' }}>
        <select value={selectedCourseId} onChange={(e) => handleCourseChange(e.target.value)} disabled={loadingCourses} style={{ minWidth: 240 }}>
          <option value="">{loadingCourses ? 'Loading courses…' : 'Select a course…'}</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {!selectedCourseId && !loadingCourses && (
        <div className="panel" style={{ textAlign: 'center', padding: '2.5rem' }}>
          <p style={{ fontSize: '2.5rem', margin: 0 }}>🗂️</p>
          <h3>Select a course to start planning</h3>
          <p className="muted">Choose a course above to see and reorder its sessions.</p>
        </div>
      )}
      {loadingSessions && <p className="muted">Loading…</p>}
      {selectedCourseId && !loadingSessions && sessions.length === 0 && !error && (
        <p className="muted">No sessions found for this course.</p>
      )}
      <DraggableSessionList sessions={sessions} setSessions={setSessions} saveStatus={saveStatus} setSaveStatus={setSaveStatus} setError={setError} />
    </div>
  )
}

// ─── Shared draggable session list ────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface DraggableSessionListProps {
  sessions: Session[]
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  saveStatus: SaveStatus
  setSaveStatus: React.Dispatch<React.SetStateAction<SaveStatus>>
  setError: React.Dispatch<React.SetStateAction<string>>
}

function DraggableSessionList({ sessions, setSessions, saveStatus, setSaveStatus, setError }: DraggableSessionListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  if (sessions.length === 0) return null

  function handleDragOver(e: React.DragEvent, index: number) { e.preventDefault(); setOverIndex(index) }

  function handleDragEnd() {
    if (dragIndex === null || overIndex === null || dragIndex === overIndex) { setDragIndex(null); setOverIndex(null); return }
    if (saveStatus === 'saving') { setDragIndex(null); setOverIndex(null); return }
    const reordered = [...sessions]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(overIndex, 0, moved)
    const withOrder = reordered.map((s, i) => ({ ...s, order: i }))
    const rollback = sessions
    setSessions(withOrder); setDragIndex(null); setOverIndex(null)
    void saveSessionOrder(withOrder, rollback, setSessions, setSaveStatus, setError)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {sessions.map((session, index) => (
        <div
          key={session.id} draggable
          onDragStart={() => setDragIndex(index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDragEnd={handleDragEnd}
          className="panel"
          style={{
            display: 'flex', alignItems: 'center', gap: '0.6rem',
            padding: '0.6rem 0.85rem', cursor: 'grab',
            opacity: dragIndex === index ? 0.4 : 1,
            outline: overIndex === index && dragIndex !== index ? '2px solid var(--primary, #6366f1)' : 'none',
            userSelect: 'none',
          }}
        >
          <span style={{ color: 'var(--muted, #9ca3af)', fontSize: '1rem' }}>⠿</span>
          <span className="muted small" style={{ minWidth: '1.4rem', textAlign: 'right' }}>{index + 1}</span>
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: '0.9rem' }}>{session.title}</strong>
            {session.subtitle && <p className="muted small" style={{ margin: '0.1rem 0 0' }}>{session.subtitle}</p>}
          </div>
          {(session.durationMinutes ?? 0) > 0 && (
            <span className="muted small" style={{ whiteSpace: 'nowrap' }}>
              {formatDuration(session.durationMinutes ?? 0)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

async function saveSessionOrder(
  ordered: Session[], rollback: Session[],
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>,
  setSaveStatus: React.Dispatch<React.SetStateAction<SaveStatus>>,
  setError: React.Dispatch<React.SetStateAction<string>>,
) {
  setSaveStatus('saving')
  try {
    const batch = writeBatch(db)
    ordered.forEach((s) => batch.update(doc(db, 'sessions', s.id), { order: s.order }))
    await batch.commit()
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 2000)
  } catch (e) {
    setSaveStatus('error')
    setError(e instanceof Error ? e.message : 'Failed to save order')
    setSessions(rollback)
  }
}

// ─── Levels tab ───────────────────────────────────────────────────────────────

const LEVELS = Array.from({ length: 11 }, (_, i) => i)

interface LevelsTabProps {
  courses: Course[]
  loadingCourses: boolean
}

function LevelsTab({ courses, loadingCourses }: LevelsTabProps) {
  const [levelCourseIds, setLevelCourseIds] = useState<Record<number, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const snap = await getDocs(collection(db, 'planning_levels'))
        const map: Record<number, string[]> = {}
        snap.forEach((d) => {
          const x = d.data()
          const level = Number(x.level)
          if (Number.isFinite(level)) map[level] = (x.courseIds as string[]) ?? []
        })
        setLevelCourseIds(map)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load levels')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function addCourse(level: number, courseId: string) {
    const current = levelCourseIds[level] ?? []
    if (current.includes(courseId)) return
    const updated = [...current, courseId]
    setLevelCourseIds((m) => ({ ...m, [level]: updated }))
    try {
      await setDoc(doc(db, 'planning_levels', `level_${level}`), { level, courseIds: updated })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setLevelCourseIds((m) => ({ ...m, [level]: current }))
    }
  }

  async function removeCourse(level: number, courseId: string) {
    const current = levelCourseIds[level] ?? []
    const updated = current.filter((id) => id !== courseId)
    setLevelCourseIds((m) => ({ ...m, [level]: updated }))
    try {
      await setDoc(doc(db, 'planning_levels', `level_${level}`), { level, courseIds: updated })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setLevelCourseIds((m) => ({ ...m, [level]: current }))
    }
  }

  if (loading) return <p className="muted">Loading…</p>

  return (
    <div>
      <p className="muted small" style={{ marginBottom: '1.5rem' }}>
        Assign subjects to difficulty levels and plan the session order within each subject. Level 0 is easiest, Level 10 is hardest.
      </p>
      {error && <p className="error">{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {LEVELS.map((level) => {
          const assignedIds = levelCourseIds[level] ?? []
          const assignedCourses = assignedIds.map((id) => courses.find((c) => c.id === id)).filter((c): c is Course => !!c)
          const available = courses.filter((c) => !assignedIds.includes(c.id))

          return (
            <LevelCard
              key={level}
              level={level}
              assignedCourses={assignedCourses}
              available={available}
              loadingCourses={loadingCourses}
              onAdd={(courseId) => void addCourse(level, courseId)}
              onRemove={(courseId) => void removeCourse(level, courseId)}
            />
          )
        })}
      </div>
    </div>
  )
}

interface LevelCardProps {
  level: number
  assignedCourses: Course[]
  available: Course[]
  loadingCourses: boolean
  onAdd: (courseId: string) => void
  onRemove: (courseId: string) => void
}

function LevelCard({ level, assignedCourses, available, loadingCourses, onAdd, onRemove }: LevelCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [subjectTotals, setSubjectTotals] = useState<Record<string, number>>({})

  function handleSubjectTotal(courseId: string, total: number) {
    setSubjectTotals((prev) => ({ ...prev, [courseId]: total }))
  }

  const levelTotal = Object.values(subjectTotals).reduce((sum, t) => sum + t, 0)

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Level header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          padding: '0.85rem 1.25rem', cursor: 'pointer',
          borderBottom: expanded && assignedCourses.length > 0 ? '1px solid var(--border, #e5e7eb)' : 'none',
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <span style={{ fontSize: '1rem', transition: 'transform 0.15s', display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', color: 'var(--muted, #9ca3af)' }}>▶</span>
        <strong style={{ minWidth: '4.5rem' }}>Level {level}</strong>
        <span className="muted small">
          {assignedCourses.length === 0 ? 'No subjects' : `${assignedCourses.length} subject${assignedCourses.length !== 1 ? 's' : ''}`}
        </span>
        {levelTotal > 0 && (
          <span style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '0.78rem', padding: '2px 8px', borderRadius: '20px', fontWeight: 600, whiteSpace: 'nowrap' }}>
            ⏱ {formatDuration(levelTotal)}
          </span>
        )}
        <div style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>
          {!loadingCourses && available.length > 0 && (
            <select value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value) }} style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem' }}>
              <option value="">+ Add subject…</option>
              {available.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Expanded subjects */}
      {expanded && (
        <div>
          {assignedCourses.length === 0 ? (
            <p className="muted small" style={{ padding: '1rem 1.25rem', margin: 0 }}>No subjects assigned to this level yet.</p>
          ) : (
            assignedCourses.map((course, idx) => (
              <SubjectRow
                key={course.id}
                course={course}
                isLast={idx === assignedCourses.length - 1}
                onRemove={() => onRemove(course.id)}
                onTotalChange={handleSubjectTotal}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

interface SubjectRowProps {
  course: Course
  isLast: boolean
  onRemove: () => void
  onTotalChange: (courseId: string, totalMinutes: number) => void
}

function SubjectRow({ course, isLast, onRemove, onTotalChange }: SubjectRowProps) {
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState('')
  const loadIdRef = useRef(0)

  useEffect(() => {
    const total = sessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0)
    onTotalChange(course.id, total)
  }, [sessions])

  async function loadSessions() {
    const thisLoad = ++loadIdRef.current
    setLoadingSessions(true)
    setError('')
    try {
      const snap = await getDocs(query(collection(db, 'sessions'), where('courseId', '==', course.id)))
      if (thisLoad !== loadIdRef.current) return
      const list: Session[] = []
      snap.forEach((d) => {
        const x = d.data()
        list.push({
          id: d.id, title: (x.title as string) ?? '', subtitle: (x.subtitle as string) ?? '',
          courseId: (x.courseId as string) ?? null, courseName: (x.courseName as string) ?? '',
          order: Number(x.order ?? 0), durationMinutes: Number(x.durationMinutes ?? 0),
          activities: readTopicsFromSessionDoc(x.activities),
        })
      })
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      setSessions(list)
    } catch (e) {
      if (thisLoad !== loadIdRef.current) return
      setError(e instanceof Error ? e.message : 'Failed to load sessions')
    } finally {
      if (thisLoad === loadIdRef.current) setLoadingSessions(false)
    }
  }

  function toggle() {
    if (!open && sessions.length === 0 && !loadingSessions) void loadSessions()
    setOpen((v) => !v)
  }

  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid var(--border, #e5e7eb)' }}>
      {/* Subject row header */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.75rem 1.25rem', cursor: 'pointer' }}
        onClick={toggle}
      >
        <span style={{ fontSize: '0.8rem', transition: 'transform 0.15s', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', color: 'var(--muted, #9ca3af)' }}>▶</span>
        <span style={{ flex: 1, fontWeight: 500 }}>{course.title}</span>
        {(() => {
          const total = sessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0)
          return total > 0 ? (
            <span className="muted small" style={{ whiteSpace: 'nowrap' }}>⏱ {formatDuration(total)}</span>
          ) : null
        })()}
        {saveStatus === 'saving' && <span className="muted small">Saving…</span>}
        {saveStatus === 'saved' && <span className="muted small" style={{ color: 'var(--success, green)' }}>Saved</span>}
        {saveStatus === 'error' && <span className="muted small" style={{ color: 'var(--error, red)' }}>Error</span>}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0.25rem', opacity: 0.45, lineHeight: 1, fontSize: '1rem' }}
          aria-label="Remove subject"
        >
          ×
        </button>
      </div>

      {/* Session list */}
      {open && (
        <div style={{ padding: '0 1.25rem 0.75rem 2.5rem' }}>
          {loadingSessions && <p className="muted small" style={{ margin: '0.5rem 0' }}>Loading sessions…</p>}
          {error && <p className="error" style={{ margin: '0.5rem 0' }}>{error}</p>}
          {!loadingSessions && sessions.length === 0 && !error && (
            <p className="muted small" style={{ margin: '0.5rem 0' }}>No sessions found for this subject.</p>
          )}
          <DraggableSessionList
            sessions={sessions}
            setSessions={setSessions}
            saveStatus={saveStatus}
            setSaveStatus={setSaveStatus}
            setError={setError}
          />
        </div>
      )}
    </div>
  )
}
