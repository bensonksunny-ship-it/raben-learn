import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { stripUndefinedDeep } from '../../lib/firestoreSanitize'
import { readTopicsFromSessionDoc } from '../../lib/topics'
import { useAuth } from '../../context/AuthContext'
import type { AttemptRecord, Course, ItemStatus, ProgressEntry, Session, TopicType } from '../../types'

const MAX_ATTEMPTS = 5

function itemTypeLabel(t: TopicType): string {
  return t === 'concept' ? 'Concept' : 'Exercise'
}
function itemTypeColors(t: TopicType): { bg: string; text: string; border: string } {
  return t === 'concept'
    ? { bg: '#ede9fe', text: '#5b21b6', border: '#c4b5fd' }
    : { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' }
}
function statusLabel(s: ItemStatus) {
  if (s === 'completed') return 'Done'
  if (s === 'review') return 'Under review'
  if (s === 'in_progress') return 'In progress'
  return 'Not started'
}

function getEntry(
  progressMap: Record<string, Record<string, ProgressEntry>>,
  sessionId: string,
  activityId: string,
): ProgressEntry | undefined {
  return progressMap[sessionId]?.[activityId]
}

export function StudentCourseView() {
  const { courseId } = useParams<{ courseId: string }>()
  const { firebaseUser, profile } = useAuth()
  const uid = firebaseUser?.uid
  const [course, setCourse] = useState<Course | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [progressMap, setProgressMap] = useState<Record<string, Record<string, ProgressEntry>>>({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  /** Local note text before blur-save (key: `${sessionId}__${activityId}`). */
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!courseId || !uid) return
    setLoading(true)
    setError('')
    try {
      const [courseSnap, sessionsSnap, progSnap] = await Promise.all([
        getDoc(doc(db, 'courses', courseId)),
        getDocs(query(collection(db, 'sessions'), where('courseId', '==', courseId))),
        getDocs(query(collection(db, 'student_lesson_progress'), where('studentId', '==', uid))),
      ])
      if (courseSnap.exists()) {
        const x = courseSnap.data()
        setCourse({ id: courseSnap.id, title: (x.title as string) ?? '', description: (x.description as string) ?? '' })
      }
      const sess: Session[] = []
      sessionsSnap.forEach((d) => {
        const x = d.data()
        sess.push({
          id: d.id,
          title: (x.title as string) ?? '',
          subtitle: (x.subtitle as string) ?? '',
          courseId: (x.courseId as string) ?? null,
          courseName: (x.courseName as string) ?? '',
          order: Number(x.order ?? 0),
          activities: readTopicsFromSessionDoc(x.activities),
        })
      })
      sess.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title))
      setSessions(sess)
      if (sess.length > 0) {
        setSelectedSessionId((prev) => (prev && sess.some((s) => s.id === prev) ? prev : sess[0]!.id))
      }

      const pm: Record<string, Record<string, ProgressEntry>> = {}
      progSnap.forEach((d) => {
        const x = d.data()
        const sid = (x.sessionId as string) ?? (x.lessonId as string)
        const entries = (x.entries as ProgressEntry[]) ?? []
        if (sid) {
          pm[sid] = {}
          entries.forEach((e) => {
            const aid = (e.activityId as string) ?? (e as unknown as { itemId?: string }).itemId
            if (aid) pm[sid]![aid] = { ...(e as ProgressEntry), activityId: aid }
          })
        }
      })
      setProgressMap(pm)
      setNoteDrafts({})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [courseId, uid])

  useEffect(() => {
    if (courseId && uid) void load()
  }, [courseId, uid, load])

  const getActivityStatus = useCallback(
    (sessionId: string, activityId: string): ItemStatus => {
      return progressMap[sessionId]?.[activityId]?.status ?? 'locked'
    },
    [progressMap],
  )

  function getIsDue(sessionId: string, activityId: string): boolean {
    return Boolean(progressMap[sessionId]?.[activityId]?.due)
  }
  function getAttemptsUsed(sessionId: string, activityId: string): number {
    return Number(progressMap[sessionId]?.[activityId]?.attemptsUsed ?? 0)
  }

  const flat = useMemo(() => sessions.flatMap((s) => s.activities.map((a) => ({ session: s, activity: a }))), [sessions])

  const unlockedSet = useMemo(() => {
    const unlocked = new Set<string>()
    if (flat.length === 0) return unlocked
    unlocked.add(`${flat[0]!.session.id}__${flat[0]!.activity.id}`)
    for (let i = 1; i < flat.length; i++) {
      const prev = flat[i - 1]!
      const prevStatus = getActivityStatus(prev.session.id, prev.activity.id)
      if (prevStatus === 'review' || prevStatus === 'completed') {
        const cur = flat[i]!
        unlocked.add(`${cur.session.id}__${cur.activity.id}`)
      } else {
        break
      }
    }
    return unlocked
  }, [flat, getActivityStatus])

  async function persistEntries(sessionId: string, mut: (entries: ProgressEntry[]) => ProgressEntry[]) {
    if (!uid) return
    const ref = doc(db, 'student_lesson_progress', `${uid}_${sessionId}`)
    const snap = await getDoc(ref)
    const existing: ProgressEntry[] = snap.exists() ? ((snap.data().entries as ProgressEntry[]) ?? []) : []
    const next = mut(existing)
    const payload = stripUndefinedDeep({ studentId: uid, sessionId, entries: next })
    await setDoc(ref, payload, { merge: true })
    setProgressMap((m) => {
      const sessionMap: Record<string, ProgressEntry> = { ...(m[sessionId] ?? {}) }
      next.forEach((e) => {
        sessionMap[e.activityId] = e
      })
      return { ...m, [sessionId]: sessionMap }
    })
  }

  async function addAttempt(sessionId: string, activityId: string) {
    if (!uid || saving) return
    const used = getAttemptsUsed(sessionId, activityId)
    if (used >= MAX_ATTEMPTS) return
    setSaving(true)
    try {
      await persistEntries(sessionId, (existing) => {
        const idx = existing.findIndex((e) => e.activityId === activityId)
        const prev = idx >= 0 ? existing[idx]! : undefined
        const history: AttemptRecord[] = [...(prev?.attemptHistory ?? [])]
        history.push({ at: new Date().toISOString(), status: 'attempted' })
        const nextAttempts = used + 1
        const entry: ProgressEntry = {
          activityId,
          status: (prev?.status === 'completed' ? 'completed' : 'in_progress') as ItemStatus,
          due: prev?.due ?? false,
          attemptsUsed: nextAttempts,
          studentMarkedAt: prev?.studentMarkedAt ?? null,
          mentorApprovedAt: prev?.mentorApprovedAt ?? null,
          rating: prev?.rating,
          notes: prev?.notes,
          attemptHistory: history,
        }
        if (idx >= 0) {
          const copy = [...existing]
          copy[idx] = entry
          return copy
        }
        return [...existing, entry]
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  async function markForReview(sessionId: string, activityId: string) {
    if (!uid || saving) return
    setSaving(true)
    try {
      await persistEntries(sessionId, (existing) => {
        const idx = existing.findIndex((e) => e.activityId === activityId)
        const prev = idx >= 0 ? existing[idx]! : undefined
        const prevAttempts = Number(prev?.attemptsUsed ?? 0)
        const nextAttempts = prevAttempts === 0 ? 1 : prevAttempts
        const history = [...(prev?.attemptHistory ?? [])]
        if (prevAttempts === 0) history.push({ at: new Date().toISOString(), status: 'attempted' })
        const entry: ProgressEntry = {
          activityId,
          status: 'review',
          due: prev?.due ?? false,
          attemptsUsed: Math.min(nextAttempts, MAX_ATTEMPTS),
          studentMarkedAt: new Date().toISOString(),
          mentorApprovedAt: null,
          rating: prev?.rating,
          notes: prev?.notes,
          attemptHistory: history,
        }
        if (idx >= 0) {
          const copy = [...existing]
          copy[idx] = entry
          return copy
        }
        return [...existing, entry]
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  async function flushNotes(sessionId: string, activityId: string, notes: string) {
    if (!uid || saving) return
    setSaving(true)
    try {
      await persistEntries(sessionId, (existing) => {
        const idx = existing.findIndex((e) => e.activityId === activityId)
        if (idx < 0) {
          return [
            ...existing,
            {
              activityId,
              status: 'in_progress' as ItemStatus,
              notes,
              attemptsUsed: 0,
              attemptHistory: [],
            },
          ]
        }
        const copy = [...existing]
        copy[idx] = { ...copy[idx]!, notes }
        return copy
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  function noteKey(sessionId: string, activityId: string) {
    return `${sessionId}__${activityId}`
  }

  async function updateRating(sessionId: string, activityId: string, rating: number) {
    if (!uid || saving) return
    const r = Math.max(1, Math.min(5, Math.round(rating)))
    setSaving(true)
    try {
      await persistEntries(sessionId, (existing) => {
        const idx = existing.findIndex((e) => e.activityId === activityId)
        if (idx < 0) {
          return [
            ...existing,
            {
              activityId,
              status: 'in_progress' as ItemStatus,
              rating: r,
              attemptsUsed: 0,
              attemptHistory: [],
            },
          ]
        }
        const copy = [...existing]
        copy[idx] = { ...copy[idx]!, rating: r }
        return copy
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const totalItems = flat.length
  const completedItems = flat.reduce(
    (s, x) => s + (getActivityStatus(x.session.id, x.activity.id) === 'completed' ? 1 : 0),
    0,
  )

  const sessionDoneCount = useCallback(
    (s: Session) =>
      s.activities.reduce((n, a) => n + (getActivityStatus(s.id, a.id) === 'completed' ? 1 : 0), 0),
    [getActivityStatus],
  )

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null

  if (loading) {
    return (
      <div className="shell">
        <p className="muted">Loading…</p>
      </div>
    )
  }
  if (!course) {
    return (
      <div className="shell">
        <p className="error">Course not found.</p>
      </div>
    )
  }

  const studentName = profile?.name ?? 'Student'

  return (
    <div className="student-syllabus">
      <div className="student-syllabus-top">
        <Link to="/student" className="btn ghost small">
          ← My Courses
        </Link>
        <div className="student-syllabus-hero">
          <div>
            <h1 className="student-syllabus-title">{studentName}</h1>
            {course.description ? <p className="muted small" style={{ margin: '0.25rem 0 0' }}>{course.description}</p> : null}
            <p className="muted small" style={{ margin: '0.35rem 0 0' }}>
              Course: <strong style={{ color: 'var(--text)' }}>{course.title}</strong>
            </p>
          </div>
          <div className="student-syllabus-progress-pill">
            <span className="student-syllabus-progress-count">
              {completedItems}/{totalItems || '—'}
            </span>
            <span className="muted small">items completed</span>
          </div>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>

      <div className="student-syllabus-grid">
        <aside className="student-syllabus-modules">
          <h2 className="student-syllabus-modules-heading">Modules</h2>
          <ul className="student-syllabus-module-list">
            {sessions.map((s) => {
              const done = sessionDoneCount(s)
              const total = s.activities.length
              const active = selectedSessionId === s.id
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`student-syllabus-module-btn${active ? ' active' : ''}`}
                    onClick={() => setSelectedSessionId(s.id)}
                  >
                    <span className="student-syllabus-module-name">{s.order ? `${s.order}. ` : ''}{s.title}</span>
                    <span className="student-syllabus-module-meta">
                      {done}/{total} done
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {sessions.length === 0 ? <p className="muted small">No modules yet.</p> : null}
        </aside>

        <section className="student-syllabus-detail">
          {!selectedSession ? (
            <p className="muted">Select a module.</p>
          ) : (
            <>
              <div className="student-syllabus-module-header">
                <div>
                  <h2 className="student-syllabus-module-title">
                    {selectedSession.order ? `${selectedSession.order}. ` : ''}
                    {selectedSession.title}
                  </h2>
                  <span className="muted small">{selectedSession.activities.length} items</span>
                </div>
              </div>

              <div className="student-syllabus-items">
                {selectedSession.activities.map((a) => {
                  const status = getActivityStatus(selectedSession.id, a.id)
                  const isUnlocked = unlockedSet.has(`${selectedSession.id}__${a.id}`)
                  const colors = itemTypeColors(a.type)
                  const attemptsUsed = getAttemptsUsed(selectedSession.id, a.id)
                  const entry = getEntry(progressMap, selectedSession.id, a.id)
                  const rating = entry?.rating ?? 0
                  const nk = noteKey(selectedSession.id, a.id)
                  const notes = nk in noteDrafts ? noteDrafts[nk]! : (entry?.notes ?? '')
                  const history = entry?.attemptHistory ?? []
                  const canAddAttempt = isUnlocked && status !== 'completed' && attemptsUsed < MAX_ATTEMPTS
                  const canMark =
                    isUnlocked && status !== 'review' && status !== 'completed' && attemptsUsed < MAX_ATTEMPTS
                  const due = getIsDue(selectedSession.id, a.id)

                  return (
                    <article key={a.id} className="student-syllabus-item" style={{ opacity: isUnlocked ? 1 : 0.5 }}>
                      <div className="student-syllabus-item-head">
                        <span className="activity-type-badge" style={{ background: colors.bg, color: colors.text }}>
                          {itemTypeLabel(a.type)}
                        </span>
                        <h3 className="student-syllabus-item-title">{a.title}</h3>
                        {due ? (
                          <span className="tag" style={{ background: '#fff0f0', borderColor: '#ffc7c7', color: '#b91c1c' }}>
                            DUE
                          </span>
                        ) : null}
                      </div>
                      {a.remark ? <p className="muted small" style={{ margin: '0 0 0.5rem' }}>{a.remark}</p> : null}

                      <div className="student-syllabus-item-meta row" style={{ alignItems: 'center', marginBottom: '0.5rem' }}>
                        <div className="student-syllabus-stars" aria-label="Rating">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              className={`student-syllabus-star${star <= rating ? ' on' : ''}`}
                              disabled={!isUnlocked || saving}
                              onClick={() => void updateRating(selectedSession.id, a.id, star)}
                              title={`${star} star${star > 1 ? 's' : ''}`}
                            >
                              ★
                            </button>
                          ))}
                        </div>
                        <span className="muted small">
                          {attemptsUsed}/{MAX_ATTEMPTS} attempts
                        </span>
                        <span className="muted small" style={{ marginLeft: 'auto' }}>
                          {statusLabel(status)}
                        </span>
                      </div>

                      <div className="student-syllabus-attempts">
                        <div className="student-syllabus-attempts-label">Attempt History</div>
                        {history.length === 0 ? (
                          <p className="muted small" style={{ margin: 0 }}>
                            No attempts yet.
                          </p>
                        ) : (
                          <table className="student-syllabus-table">
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>Date</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {history.map((h, i) => (
                                <tr key={`${h.at}-${i}`}>
                                  <td>{i + 1}</td>
                                  <td>{new Date(h.at).toLocaleString()}</td>
                                  <td>{h.status ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>

                      <label className="student-syllabus-notes-label">
                        Notes (optional)
                        <textarea
                          className="student-syllabus-notes"
                          rows={2}
                          value={notes}
                          disabled={!isUnlocked || saving}
                          placeholder="Private notes…"
                          onChange={(e) => {
                            const v = e.target.value
                            setNoteDrafts((d) => ({ ...d, [nk]: v }))
                          }}
                          onBlur={() => {
                            const v = nk in noteDrafts ? noteDrafts[nk]! : (entry?.notes ?? '')
                            if (v === (entry?.notes ?? '')) return
                            void flushNotes(selectedSession.id, a.id, v)
                          }}
                        />
                      </label>

                      <div className="student-syllabus-item-actions">
                        <button
                          type="button"
                          className="btn small ghost"
                          disabled={!canAddAttempt || saving}
                          onClick={() => void addAttempt(selectedSession.id, a.id)}
                        >
                          + Add Attempt
                        </button>
                        <button
                          type="button"
                          className="btn small primary"
                          disabled={!canMark || saving}
                          onClick={() => void markForReview(selectedSession.id, a.id)}
                        >
                          Mark Done
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
