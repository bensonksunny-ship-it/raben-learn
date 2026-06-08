import { useEffect, useState } from 'react'
import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { Course, Session } from '../../types'
import { readTopicsFromSessionDoc } from '../../lib/topics'

export function PlanningPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')

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
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load courses')
      } finally {
        setLoadingCourses(false)
      }
    })()
  }, [])

  async function loadSessions(courseId: string) {
    setLoadingSessions(true)
    setError('')
    setSessions([])
    try {
      const snap = await getDocs(query(collection(db, 'sessions'), where('courseId', '==', courseId)))
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
      setError(e instanceof Error ? e.message : 'Failed to load sessions')
    } finally {
      setLoadingSessions(false)
    }
  }

  function handleCourseChange(courseId: string) {
    setSelectedCourseId(courseId)
    if (courseId) void loadSessions(courseId)
    else setSessions([])
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>🗂️ Planning</h1>
          <p className="muted small" style={{ margin: '0.2rem 0 0' }}>Drag sessions to reorder them within a course.</p>
        </div>
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
          <option value="">
            {loadingCourses ? 'Loading courses…' : 'Select a course…'}
          </option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
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
        setSaveStatus={setSaveStatus}
        setError={setError}
      />
    </div>
  )
}

interface SessionListProps {
  sessions: Session[]
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setSaveStatus: React.Dispatch<React.SetStateAction<'idle' | 'saving' | 'saved' | 'error'>>
  setError: React.Dispatch<React.SetStateAction<string>>
}

function SessionList({ sessions, setSessions, setSaveStatus, setError }: SessionListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  if (sessions.length === 0) return null

  function handleDragStart(index: number) {
    setDragIndex(index)
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    setOverIndex(index)
  }

  function handleDragEnd() {
    if (dragIndex === null || overIndex === null || dragIndex === overIndex) {
      setDragIndex(null)
      setOverIndex(null)
      return
    }

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
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            cursor: 'grab',
            opacity: dragIndex === index ? 0.4 : 1,
            outline: overIndex === index && dragIndex !== index ? '2px solid var(--primary, #6366f1)' : 'none',
            userSelect: 'none',
          }}
        >
          <span style={{ color: 'var(--muted, #9ca3af)', fontSize: '1.1rem', cursor: 'grab' }}>⠿</span>
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
    await Promise.all(
      ordered.map((s) => updateDoc(doc(db, 'sessions', s.id), { order: s.order }))
    )
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 2000)
  } catch (e) {
    setSaveStatus('error')
    setError(e instanceof Error ? e.message : 'Failed to save order')
    setSessions(rollback)
  }
}
