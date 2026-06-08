import { useEffect, useRef, useState } from 'react'
import { collection, doc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { Course, Session } from '../../types'
import { readTopicsFromSessionDoc } from '../../lib/topics'

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
        <button
          type="button"
          className={`course-tab${tab === 'sessions' ? ' active' : ''}`}
          onClick={() => setTab('sessions')}
        >
          Sessions
        </button>
        <button
          type="button"
          className={`course-tab${tab === 'levels' ? ' active' : ''}`}
          onClick={() => setTab('levels')}
        >
          Levels
        </button>
      </div>

      {tab === 'sessions' && (
        <SessionsTab courses={courses} loadingCourses={loadingCourses} />
      )}
      {tab === 'levels' && (
        <LevelsTab courses={courses} loadingCourses={loadingCourses} />
      )}
    </div>
  )
}

// ─── Sessions tab ────────────────────────────────────────────────────────────

interface SessionsTabProps {
  courses: Course[]
  loadingCourses: boolean
}

function SessionsTab({ courses, loadingCourses }: SessionsTabProps) {
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
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
          id: d.id,
          title: (x.title as string) ?? '',
          subtitle: (x.subtitle as string) ?? '',
          courseId: (x.courseId as string) ?? null,
          courseName: (x.courseName as string) ?? '',
          order: Number(x.order ?? 0),
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
        <select
          value={selectedCourseId}
          onChange={(e) => handleCourseChange(e.target.value)}
          disabled={loadingCourses}
          style={{ minWidth: 240 }}
        >
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

      <SessionList
        sessions={sessions}
        setSessions={setSessions}
        saveStatus={saveStatus}
        setSaveStatus={setSaveStatus}
        setError={setError}
      />
    </div>
  )
}

interface SessionListProps {
  sessions: Session[]
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  setSaveStatus: React.Dispatch<React.SetStateAction<'idle' | 'saving' | 'saved' | 'error'>>
  setError: React.Dispatch<React.SetStateAction<string>>
}

function SessionList({ sessions, setSessions, saveStatus, setSaveStatus, setError }: SessionListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  if (sessions.length === 0) return null

  function handleDragStart(index: number) { setDragIndex(index) }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    setOverIndex(index)
  }

  function handleDragEnd() {
    if (dragIndex === null || overIndex === null || dragIndex === overIndex) {
      setDragIndex(null); setOverIndex(null); return
    }
    if (saveStatus === 'saving') { setDragIndex(null); setOverIndex(null); return }

    const reordered = [...sessions]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(overIndex, 0, moved)
    const withOrder = reordered.map((s, i) => ({ ...s, order: i }))
    const rollback = sessions

    setSessions(withOrder)
    setDragIndex(null)
    setOverIndex(null)
    void saveOrder(withOrder, rollback, setSessions, setSaveStatus, setError)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {sessions.map((session, index) => (
        <div
          key={session.id}
          draggable
          onDragStart={() => handleDragStart(index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDragEnd={handleDragEnd}
          className="panel"
          style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.75rem 1rem', cursor: 'grab',
            opacity: dragIndex === index ? 0.4 : 1,
            outline: overIndex === index && dragIndex !== index ? '2px solid var(--primary, #6366f1)' : 'none',
            userSelect: 'none',
          }}
        >
          <span style={{ color: 'var(--muted, #9ca3af)', fontSize: '1.1rem' }}>⠿</span>
          <span className="muted small" style={{ minWidth: '1.5rem', textAlign: 'right' }}>{index + 1}</span>
          <div style={{ flex: 1 }}>
            <strong>{session.title}</strong>
            {session.subtitle && <p className="muted small" style={{ margin: '0.1rem 0 0' }}>{session.subtitle}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

async function saveOrder(
  ordered: Session[],
  rollback: Session[],
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>,
  setSaveStatus: React.Dispatch<React.SetStateAction<'idle' | 'saving' | 'saved' | 'error'>>,
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

// ─── Levels tab ──────────────────────────────────────────────────────────────

const LEVELS = Array.from({ length: 11 }, (_, i) => i) // 0..10

interface LevelData {
  courseIds: string[]
}

interface LevelsTabProps {
  courses: Course[]
  loadingCourses: boolean
}

function LevelsTab({ courses, loadingCourses }: LevelsTabProps) {
  const [levelMap, setLevelMap] = useState<Record<number, LevelData>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const snap = await getDocs(collection(db, 'planning_levels'))
        const map: Record<number, LevelData> = {}
        snap.forEach((d) => {
          const x = d.data()
          const level = Number(x.level)
          if (Number.isFinite(level)) map[level] = { courseIds: (x.courseIds as string[]) ?? [] }
        })
        setLevelMap(map)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load levels')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function addCourse(level: number, courseId: string) {
    const current = levelMap[level]?.courseIds ?? []
    if (current.includes(courseId)) return
    const updated = [...current, courseId]
    setLevelMap((m) => ({ ...m, [level]: { courseIds: updated } }))
    try {
      await setDoc(doc(db, 'planning_levels', `level_${level}`), { level, courseIds: updated })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setLevelMap((m) => ({ ...m, [level]: { courseIds: current } }))
    }
  }

  async function removeCourse(level: number, courseId: string) {
    const current = levelMap[level]?.courseIds ?? []
    const updated = current.filter((id) => id !== courseId)
    setLevelMap((m) => ({ ...m, [level]: { courseIds: updated } }))
    try {
      await setDoc(doc(db, 'planning_levels', `level_${level}`), { level, courseIds: updated })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setLevelMap((m) => ({ ...m, [level]: { courseIds: current } }))
    }
  }

  if (loading) return <p className="muted">Loading…</p>

  return (
    <div>
      <p className="muted small" style={{ marginBottom: '1.5rem' }}>Assign courses to difficulty levels. Level 0 is the easiest, Level 10 is the hardest.</p>
      {error && <p className="error">{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {LEVELS.map((level) => {
          const assignedIds = levelMap[level]?.courseIds ?? []
          const assignedCourses = assignedIds
            .map((id) => courses.find((c) => c.id === id))
            .filter((c): c is Course => !!c)
          const available = courses.filter((c) => !assignedIds.includes(c.id))

          return (
            <div key={level} className="panel" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: assignedCourses.length > 0 ? '0.75rem' : 0, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, minWidth: '4.5rem' }}>Level {level}</span>
                {assignedCourses.length === 0 && (
                  <span className="muted small">No subjects assigned</span>
                )}
                {assignedCourses.map((c) => (
                  <span
                    key={c.id}
                    className="tag"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    {c.title}
                    <button
                      type="button"
                      onClick={() => void removeCourse(level, c.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0.1rem', lineHeight: 1, opacity: 0.6 }}
                      aria-label={`Remove ${c.title}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {available.length > 0 && !loadingCourses && (
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) void addCourse(level, e.target.value) }}
                    style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem' }}
                  >
                    <option value="">+ Add subject…</option>
                    {available.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
