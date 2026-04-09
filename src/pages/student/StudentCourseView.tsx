import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import type { Course, ItemStatus, ProgressEntry, Session } from '../../types'

const MAX_ATTEMPTS = 5

function itemTypeLabel(t: string) {
  if (t === 'concept') return 'Concept'
  if (t === 'exercise') return 'Exercise'
  return 'Implementation'
}
function itemTypeColors(t: string) {
  if (t === 'concept') return { bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe' }
  if (t === 'exercise') return { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' }
  return { bg: '#fce7f3', text: '#9d174d', border: '#fbcfe8' }
}
function statusLabel(s: ItemStatus) {
  if (s === 'completed') return '✓ Approved'
  if (s === 'review') return '⏳ Under Review'
  if (s === 'in_progress') return '● In Progress'
  return '○ Locked'
}
function statusColor(s: ItemStatus) {
  if (s === 'completed') return '#10b981'
  if (s === 'review') return '#f59e0b'
  if (s === 'in_progress') return 'var(--primary)'
  return 'var(--muted)'
}

export function StudentCourseView() {
  const { courseId } = useParams<{ courseId: string }>()
  const { firebaseUser } = useAuth()
  const uid = firebaseUser?.uid
  const [course, setCourse] = useState<Course | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [progressMap, setProgressMap] = useState<Record<string, Record<string, ProgressEntry>>>({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { if (courseId && uid) void load() }, [courseId, uid])

  async function load() {
    if (!courseId || !uid) return
    setLoading(true); setError('')
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
          activities: (x.activities as Session['activities']) ?? [],
        })
      })
      sess.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title))
      setSessions(sess)

      const pm: Record<string, Record<string, ProgressEntry>> = {}
      progSnap.forEach((d) => {
        const x = d.data(); const sid = (x.sessionId as string) ?? (x.lessonId as string)
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
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') } finally { setLoading(false) }
  }

  function getActivityStatus(sessionId: string, activityId: string): ItemStatus {
    return progressMap[sessionId]?.[activityId]?.status ?? 'locked'
  }
  function getIsDue(sessionId: string, activityId: string): boolean {
    return Boolean(progressMap[sessionId]?.[activityId]?.due)
  }
  function getAttemptsUsed(sessionId: string, activityId: string): number {
    return Number(progressMap[sessionId]?.[activityId]?.attemptsUsed ?? 0)
  }

  const flat = useMemo(() => {
    return sessions.flatMap((s) => s.activities.map((a) => ({ session: s, activity: a })))
  }, [sessions])

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
  }, [flat, progressMap])

  async function markForReview(sessionId: string, activityId: string) {
    if (!uid || saving) return
    setSaving(true)
    try {
      const ref = doc(db, 'student_lesson_progress', `${uid}_${sessionId}`)
      const snap = await getDoc(ref)
      const existing: ProgressEntry[] = snap.exists() ? ((snap.data().entries as ProgressEntry[]) ?? []) : []
      const idx = existing.findIndex((e) => (e.activityId as string) === activityId)
      const prevAttempts = idx >= 0 ? Number(existing[idx]?.attemptsUsed ?? 0) : 0
      const nextAttempts = prevAttempts + 1
      if (nextAttempts > MAX_ATTEMPTS) return
      const entry: ProgressEntry = {
        activityId,
        status: 'review',
        due: existing[idx]?.due ?? false,
        attemptsUsed: nextAttempts,
        studentMarkedAt: new Date().toISOString(),
        mentorApprovedAt: null,
      }
      if (idx >= 0) existing[idx] = entry; else existing.push(entry)
      await setDoc(ref, { studentId: uid, sessionId, entries: existing }, { merge: true })
      setProgressMap((m) => {
        const sessionMap = { ...(m[sessionId] ?? {}) }; sessionMap[activityId] = entry
        return { ...m, [sessionId]: sessionMap }
      })
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') } finally { setSaving(false) }
  }

  if (loading) return <div className="shell"><p className="muted">Loading…</p></div>
  if (!course) return <div className="shell"><p className="error">Course not found.</p></div>

  const totalItems = flat.length
  const completedItems = flat.reduce((s, x) => s + (getActivityStatus(x.session.id, x.activity.id) === 'completed' ? 1 : 0), 0)
  const reviewItems = flat.reduce((s, x) => s + (getActivityStatus(x.session.id, x.activity.id) === 'review' ? 1 : 0), 0)
  const pct = totalItems === 0 ? 0 : Math.round((completedItems / totalItems) * 100)

  return (
    <div>
      <div className="course-hero">
        <Link to="/student" className="btn ghost small" style={{ marginBottom: '0.75rem' }}>← My Courses</Link>
        <h1 style={{ margin: '0 0 0.25rem' }}>{course.title}</h1>
        {course.description ? <p className="muted" style={{ margin: '0 0 0.75rem' }}>{course.description}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div className="planner-progress-bar"><div className="planner-progress-fill" style={{ width: `${pct}%` }} /></div>
          </div>
          <span style={{ fontWeight: 700 }}>{pct}%</span>
          <span className="tag">{completedItems} approved</span>
          {reviewItems > 0 && <span className="tag" style={{ background: '#fef9c3', color: '#92400e', border: 'none' }}>{reviewItems} under review</span>}
          {pct === 100 && <span className="tag" style={{ background: '#dcfce7', color: '#166534', border: 'none' }}>🎉 Complete!</span>}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
        {sessions.map((s) => (
          <div key={s.id} className="module-accordion">
            <div className="module-accordion-header" style={{ cursor: 'default' }}>
              <span style={{ fontWeight: 700 }}>{s.order ? `${s.order}. ` : ''}{s.title}</span>
              <span className="muted small">{s.activities.length} activities</span>
            </div>
            <div className="lesson-card">
              <div className="lesson-items-list">
                {s.activities.map((a) => {
                  const status = getActivityStatus(s.id, a.id)
                  const isUnlocked = unlockedSet.has(`${s.id}__${a.id}`)
                  const colors = itemTypeColors(a.type)
                  const attemptsUsed = getAttemptsUsed(s.id, a.id)
                  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attemptsUsed)
                  const canMark = isUnlocked && status !== 'review' && status !== 'completed' && attemptsUsed < MAX_ATTEMPTS
                  const due = getIsDue(s.id, a.id)
                  return (
                    <div key={a.id} className={`lesson-activity-row ${status}`}
                      style={{ borderLeft: `3px solid ${isUnlocked ? colors.border : '#e2e8f0'}`, background: status === 'completed' ? '#f8fdf9' : status === 'review' ? '#fffbeb' : '#fff', opacity: isUnlocked ? 1 : 0.45 }}>
                      <span className="activity-type-badge" style={{ background: colors.bg, color: colors.text }}>{itemTypeLabel(a.type)}</span>
                      <span className="activity-title" style={{ textDecoration: status === 'completed' ? 'line-through' : 'none' }}>{a.title}</span>
                      {due ? <span className="tag" style={{ background: '#fff0f0', borderColor: '#ffc7c7', color: '#b91c1c' }}>DUE</span> : null}
                      {attemptsUsed > 0 && status !== 'completed' ? (
                        <span className="tag" style={{ background: '#eef2ff', borderColor: '#c7d2fe', color: '#3730a3' }}>
                          Attempts left: {attemptsLeft}
                        </span>
                      ) : null}
                      {canMark ? (
                        <button type="button" className="mark-done-btn" onClick={() => void markForReview(s.id, a.id)} disabled={saving}>
                          Mark as Done
                        </button>
                      ) : attemptsUsed >= MAX_ATTEMPTS && status !== 'completed' ? (
                        <span className="status-badge" style={{ color: '#b91c1c' }}>No attempts left</span>
                      ) : (
                        <span className="status-badge" style={{ color: statusColor(status) }}>{statusLabel(status)}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ))}
        {sessions.length === 0 && <div className="panel" style={{ textAlign: 'center', padding: '2rem' }}><p className="muted">No sessions yet.</p></div>}
      </div>
    </div>
  )
}
