import { useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { stripUndefinedDeep } from '../../lib/firestoreSanitize'
import { readTopicsFromSessionDoc } from '../../lib/topics'
import type { Course, ItemStatus, ProgressEntry, Session, TopicType } from '../../types'

function itemTypeLabel(t: TopicType): string {
  return t === 'concept' ? 'Concept' : 'Exercise'
}
function itemTypeColors(t: TopicType): { bg: string; text: string } {
  return t === 'concept' ? { bg: '#ede9fe', text: '#5b21b6' } : { bg: '#dcfce7', text: '#166534' }
}
function statusLabel(s: ItemStatus) {
  if (s === 'completed') return 'Completed'
  if (s === 'review') return 'Submitted — awaiting mentor'
  if (s === 'in_progress') return 'In progress'
  return 'Not started'
}

export interface StudentCourseViewProps {
  course: Course
  /** Overrides the signed-in user — not used by the real student popup today, but
   *  mirrors `StudentTimetableView`'s shape for future reuse (e.g. a manager preview). */
  studentId?: string
}

/**
 * One course's modules + topics, with the student's own progress — rendered inside
 * the Dashboard's `?view=course` popup, never as its own route/page. A topic
 * expands to show a 1–5 self-rating, a notes field, and a "Mark Complete" button
 * that submits the topic for mentor review (status 'review', not 'completed'
 * directly — only a mentor's approval in MentorStudentProgress sets 'completed').
 */
export function StudentCourseView({ course, studentId }: StudentCourseViewProps) {
  const { firebaseUser } = useAuth()
  const uid = studentId ?? firebaseUser?.uid

  const [sessions, setSessions] = useState<Session[]>([])
  const [progressMap, setProgressMap] = useState<Record<string, Record<string, ProgressEntry>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!uid) return
    setLoading(true); setError('')
    void (async () => {
      try {
        const [sessionsSnap, progSnap] = await Promise.all([
          getDocs(query(collection(db, 'sessions'), where('courseId', '==', course.id))),
          getDocs(query(collection(db, 'student_lesson_progress'), where('studentId', '==', uid))),
        ])
        const sess: Session[] = []
        sessionsSnap.forEach((d) => {
          const x = d.data()
          sess.push({
            id: d.id,
            title: (x.title as string) ?? '',
            courseId: (x.courseId as string) ?? null,
            courseName: (x.courseName as string) ?? '',
            order: Number(x.order ?? 0),
            activities: readTopicsFromSessionDoc(x.activities),
          })
        })
        sess.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title))
        setSessions(sess)
        setSelectedSessionId((prev) => (prev && sess.some((s) => s.id === prev) ? prev : sess[0]?.id ?? null))

        const pm: Record<string, Record<string, ProgressEntry>> = {}
        progSnap.forEach((d) => {
          const x = d.data()
          const sid = (x.sessionId as string) ?? (x.lessonId as string)
          const entries = (x.entries as ProgressEntry[]) ?? []
          if (sid) {
            pm[sid] = {}
            entries.forEach((e) => { if (e.activityId) pm[sid]![e.activityId] = e })
          }
        })
        setProgressMap(pm)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load this course')
      } finally {
        setLoading(false)
      }
    })()
  }, [uid, course.id])

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null
  const totalItems = sessions.reduce((n, s) => n + s.activities.length, 0)
  const completedItems = sessions.reduce(
    (n, s) => n + s.activities.filter((a) => (progressMap[s.id]?.[a.id]?.status ?? 'locked') === 'completed').length,
    0,
  )

  /** Read-modify-write the session's progress doc — same `{studentId}_{sessionId}`
   *  shape and merge pattern MentorStudentProgress uses, so a mentor reviewing this
   *  later sees exactly what the student submitted. */
  async function saveEntry(sessionId: string, activityId: string, patch: Partial<ProgressEntry>) {
    if (!uid) return
    setSaving(true); setError('')
    try {
      const ref = doc(db, 'student_lesson_progress', `${uid}_${sessionId}`)
      const snap = await getDoc(ref)
      const existing: ProgressEntry[] = snap.exists() ? ((snap.data().entries as ProgressEntry[]) ?? []) : []
      const idx = existing.findIndex((e) => e.activityId === activityId)
      const prev = idx >= 0 ? existing[idx]! : null
      const entry: ProgressEntry = { ...(prev ?? { activityId, status: 'in_progress' as ItemStatus }), ...patch, activityId }
      if (idx >= 0) existing[idx] = entry; else existing.push(entry)
      await setDoc(ref, stripUndefinedDeep({ studentId: uid, sessionId, entries: existing }), { merge: true })
      setProgressMap((m) => ({ ...m, [sessionId]: { ...(m[sessionId] ?? {}), [activityId]: entry } }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function markComplete(sessionId: string, activityId: string) {
    void saveEntry(sessionId, activityId, { status: 'review', studentMarkedAt: new Date().toISOString() })
  }
  function setRating(sessionId: string, activityId: string, rating: number) {
    void saveEntry(sessionId, activityId, { rating })
  }
  function saveNotes(sessionId: string, activityId: string, notes: string) {
    void saveEntry(sessionId, activityId, { notes })
  }

  if (loading) return <p className="muted">Loading…</p>

  return (
    <div className="student-syllabus">
      {error ? <p className="error">{error}</p> : null}

      <div className="student-syllabus-top">
        <div className="student-syllabus-hero">
          <div>
            <h1 className="student-syllabus-title">{course.title}</h1>
            {sessions.length > 1 ? (
              <select value={selectedSessionId ?? ''} onChange={(e) => setSelectedSessionId(e.target.value)} style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>
                {sessions.map((s) => <option key={s.id} value={s.id}>{s.order ? `${s.order}. ` : ''}{s.title}</option>)}
              </select>
            ) : course.description ? (
              <p className="muted small" style={{ margin: '0.35rem 0 0' }}>{course.description}</p>
            ) : null}
          </div>
          <div className="student-syllabus-progress-pill">
            <span className="student-syllabus-progress-count">{completedItems}/{totalItems || '—'}</span>
            <span className="muted small">items completed</span>
          </div>
        </div>
        {totalItems > 0 ? (
          <div className="student-syllabus-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={totalItems} aria-valuenow={completedItems}>
            <span className="student-syllabus-progress-bar-fill" style={{ width: `${Math.round((completedItems / totalItems) * 100)}%` }} />
          </div>
        ) : null}
      </div>

      {sessions.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: '2.5rem' }}>
          <p style={{ fontSize: '2.5rem', margin: 0 }}>📖</p>
          <h3>No modules yet</h3>
          <p className="muted">Nothing's been added to this course's syllabus yet.</p>
        </div>
      ) : (
        <div className="student-syllabus-grid">
          <aside className="student-syllabus-modules">
            <h2 className="student-syllabus-modules-heading">Modules</h2>
            <ul className="student-syllabus-module-list">
              {sessions.map((s) => {
                const done = s.activities.filter((a) => (progressMap[s.id]?.[a.id]?.status ?? 'locked') === 'completed').length
                const active = selectedSessionId === s.id
                return (
                  <li key={s.id}>
                    <button type="button" className={`student-syllabus-module-btn${active ? ' active' : ''}`} onClick={() => setSelectedSessionId(s.id)}>
                      <span className="student-syllabus-module-name">{s.order ? `${s.order}. ` : ''}{s.title}</span>
                      <span className="student-syllabus-module-meta">{done}/{s.activities.length} done</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          <section className="student-syllabus-detail">
            {!selectedSession ? (
              <p className="muted">Select a module.</p>
            ) : (
              <>
                <div className="student-syllabus-module-header">
                  <div>
                    <h2 className="student-syllabus-module-title">{selectedSession.order ? `${selectedSession.order}. ` : ''}{selectedSession.title}</h2>
                    <span className="muted small">{selectedSession.activities.length} items</span>
                  </div>
                </div>

                <ul className="student-task-list">
                  {selectedSession.activities.map((a) => {
                    const entry = progressMap[selectedSession.id]?.[a.id]
                    const status: ItemStatus = entry?.status ?? 'locked'
                    const colors = itemTypeColors(a.type)
                    const isDone = status === 'completed'
                    const isSubmitted = status === 'review' || status === 'completed'
                    const isExpanded = expandedId === a.id
                    const rating = entry?.rating ?? 0
                    const notesValue = noteDrafts[a.id] ?? entry?.notes ?? ''

                    return (
                      <li key={a.id} className={['student-task', isExpanded ? 'expanded' : '', isDone ? 'done' : ''].filter(Boolean).join(' ')}>
                        <div className="student-task-row">
                          <button
                            type="button"
                            className="student-task-trigger"
                            onClick={() => setExpandedId((cur) => (cur === a.id ? null : a.id))}
                            aria-expanded={isExpanded}
                            aria-label={`${itemTypeLabel(a.type)}: ${a.title}. ${statusLabel(status)}. ${isExpanded ? 'Collapse' : 'Expand'} details.`}
                          >
                            <span className="student-task-badge" style={{ background: colors.bg, color: colors.text }}>{itemTypeLabel(a.type)}</span>
                            <span className="student-task-titles">
                              <span className="student-task-title">{a.title}</span>
                              {a.remark ? <span className="student-task-remark muted small">{a.remark}</span> : null}
                            </span>
                            <span className="student-task-status muted small">{statusLabel(status)}</span>
                            <span className="student-task-chevron" aria-hidden>{isExpanded ? '▾' : '▸'}</span>
                          </button>
                          <div className="student-task-actions">
                            <button
                              type="button"
                              className={`btn small student-task-complete-btn${isDone ? ' student-task-complete-btn--done' : ' primary'}`}
                              disabled={isSubmitted || saving}
                              onClick={() => markComplete(selectedSession.id, a.id)}
                            >
                              {isDone ? 'Completed' : status === 'review' ? 'Submitted' : 'Mark Complete'}
                            </button>
                          </div>
                        </div>

                        {isExpanded ? (
                          <div className="student-task-details">
                            <div className="student-task-details-row">
                              <div className="student-task-stars" aria-label="Rating">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <button
                                    key={star}
                                    type="button"
                                    className={`student-syllabus-star${star <= rating ? ' on' : ''}`}
                                    onClick={() => setRating(selectedSession.id, a.id, star)}
                                    disabled={saving}
                                    aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                                  >★</button>
                                ))}
                              </div>
                            </div>
                            <label className="student-task-notes-label">
                              <span className="muted small">Notes</span>
                              <textarea
                                className="student-task-notes"
                                rows={2}
                                value={notesValue}
                                onChange={(e) => setNoteDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                                onBlur={() => { if (noteDrafts[a.id] !== undefined) saveNotes(selectedSession.id, a.id, noteDrafts[a.id]!) }}
                                placeholder="Jot down anything about this topic…"
                              />
                            </label>
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                  {selectedSession.activities.length === 0 ? <li className="muted small" style={{ padding: '0.5rem 0' }}>No topics yet.</li> : null}
                </ul>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
