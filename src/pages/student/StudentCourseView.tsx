import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { stripUndefinedDeep } from '../../lib/firestoreSanitize'
import { readTopicsFromSessionDoc } from '../../lib/topics'
import { useAuth } from '../../context/AuthContext'
import type { Course, ItemStatus, ProgressEntry, Session, TopicType } from '../../types'

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
  /** Currently-expanded task card (only one at a time, scoped per session view). */
  const [expandedId, setExpandedId] = useState<string | null>(null)
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

  async function markForReview(sessionId: string, activityId: string) {
    if (!uid || saving) return
    setSaving(true)
    try {
      await persistEntries(sessionId, (existing) => {
        const idx = existing.findIndex((e) => e.activityId === activityId)
        const prev = idx >= 0 ? existing[idx]! : undefined
        const entry: ProgressEntry = {
          activityId,
          status: 'review',
          due: prev?.due ?? false,
          studentMarkedAt: new Date().toISOString(),
          mentorApprovedAt: null,
          rating: prev?.rating,
          notes: prev?.notes,
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
        {totalItems > 0 ? (
          <div
            className="student-syllabus-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={totalItems}
            aria-valuenow={completedItems}
            aria-label={`${completedItems} of ${totalItems} items completed`}
          >
            <span
              className="student-syllabus-progress-bar-fill"
              style={{ width: `${Math.round((completedItems / totalItems) * 100)}%` }}
            />
          </div>
        ) : null}
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

              <ul className="student-task-list">
                {selectedSession.activities.map((a) => {
                  const status = getActivityStatus(selectedSession.id, a.id)
                  const isUnlocked = unlockedSet.has(`${selectedSession.id}__${a.id}`)
                  const colors = itemTypeColors(a.type)
                  const entry = getEntry(progressMap, selectedSession.id, a.id)
                  const rating = entry?.rating ?? 0
                  const nk = noteKey(selectedSession.id, a.id)
                  const notes = nk in noteDrafts ? noteDrafts[nk]! : (entry?.notes ?? '')
                  const canMark = isUnlocked && status !== 'review' && status !== 'completed'
                  const due = getIsDue(selectedSession.id, a.id)
                  const isExpanded = expandedId === a.id
                  const isDone = status === 'completed'

                  return (
                    <li
                      key={a.id}
                      className={[
                        'student-task',
                        isExpanded ? 'expanded' : '',
                        !isUnlocked ? 'locked' : '',
                        isDone ? 'done' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <div className="student-task-row">
                        <button
                          type="button"
                          className="student-task-trigger"
                          onClick={() => setExpandedId((cur) => (cur === a.id ? null : a.id))}
                          aria-expanded={isExpanded}
                          aria-label={`${itemTypeLabel(a.type)}: ${a.title}. ${statusLabel(status)}. ${isExpanded ? 'Collapse' : 'Expand'} details.`}
                        >
                          <span
                            className="student-task-badge"
                            style={{ background: colors.bg, color: colors.text }}
                          >
                            {itemTypeLabel(a.type)}
                          </span>
                          <span className="student-task-titles">
                            <span className="student-task-title">{a.title}</span>
                            {a.remark ? <span className="student-task-remark muted small">{a.remark}</span> : null}
                          </span>
                          {due ? <span className="student-task-due">DUE</span> : null}
                          {!isUnlocked ? (
                            <span className="student-task-status muted small">🔒 Locked</span>
                          ) : (
                            <span className="student-task-status muted small">{statusLabel(status)}</span>
                          )}
                          <span className="student-task-chevron" aria-hidden>
                            {isExpanded ? '▾' : '▸'}
                          </span>
                        </button>
                        <div className="student-task-actions">
                          <button
                            type="button"
                            className="btn small primary"
                            disabled={!canMark || saving}
                            onClick={() => void markForReview(selectedSession.id, a.id)}
                          >
                            Mark Done
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
                                  disabled={!isUnlocked || saving}
                                  onClick={() => void updateRating(selectedSession.id, a.id, star)}
                                  title={`${star} star${star > 1 ? 's' : ''}`}
                                >
                                  ★
                                </button>
                              ))}
                            </div>
                          </div>

                          <label className="student-task-notes-label">
                            <span className="muted small">Notes (optional)</span>
                            <textarea
                              className="student-task-notes"
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
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
