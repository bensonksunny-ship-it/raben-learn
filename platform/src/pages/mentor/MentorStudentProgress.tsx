import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { stripUndefinedDeep } from '../../lib/firestoreSanitize'
import { readTopicsFromSessionDoc } from '../../lib/topics'
import type { Course, DailyPlan, DailyPlanItem, ItemStatus, LessonItemType, ProgressEntry, Session } from '../../types'

const MAX_ATTEMPTS = 5

function itemTypeLabel(t: LessonItemType | string): string {
  if (t === 'concept') return 'Concept'
  if (t === 'custom') return 'Custom'
  return 'Exercise'
}
function itemTypeColors(t: LessonItemType | string): { bg: string; text: string; border: string } {
  if (t === 'concept') return { bg: '#ede9fe', text: '#5b21b6', border: '#c4b5fd' }
  if (t === 'custom') return { bg: '#f3f4f6', text: '#374151', border: '#e5e7eb' }
  return { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' }
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function MentorStudentProgress() {
  const { studentId } = useParams<{ studentId: string }>()
  const [studentName, setStudentName] = useState('')
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [progressMap, setProgressMap] = useState<Record<string, Record<string, ProgressEntry>>>({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'progress' | 'planner'>('progress')
  const [plan, setPlan] = useState<DailyPlan | null>(null)
  const [planDate, setPlanDate] = useState(new Date().toISOString().slice(0, 10))
  const [loadingPlan, setLoadingPlan] = useState(false)

  const loadStudent = useCallback(async () => {
    if (!studentId) return
    setLoading(true); setError('')
    try {
      const userSnap = await getDoc(doc(db, 'users', studentId))
      if (userSnap.exists()) setStudentName((userSnap.data().name as string) ?? 'Student')
      const [coursesSnap, progSnap] = await Promise.all([
        getDocs(collection(db, 'courses')),
        getDocs(query(collection(db, 'student_lesson_progress'), where('studentId', '==', studentId))),
      ])
      const courseList: Course[] = []
      coursesSnap.forEach((d) => { const x = d.data(); courseList.push({ id: d.id, title: (x.title as string) ?? '', description: (x.description as string) ?? '' }) })
      courseList.sort((a, b) => a.title.localeCompare(b.title))
      setCourses(courseList)

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
      if (courseList.length > 0) { setSelectedCourseId(courseList[0].id); await loadCourseData(courseList[0].id) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') } finally { setLoading(false) }
  }, [studentId])

  const loadPlan = useCallback(async () => {
    if (!studentId) return
    setLoadingPlan(true)
    try {
      const snap = await getDoc(doc(db, 'student_daily_plans', `${studentId}_${planDate}`))
      if (snap.exists()) {
        const d = snap.data()
        const loaded: DailyPlan = {
          id: snap.id,
          studentId: (d.studentId as string) ?? '',
          date: (d.date as string) ?? planDate,
          items: (d.items as DailyPlanItem[]) ?? [],
          startTime: (d.startTime as string) ?? '09:00',
        }
        setPlan(loaded)
      } else { setPlan(null) }
    } catch (e) { console.error('loadPlan failed', e) } finally { setLoadingPlan(false) }
  }, [studentId, planDate])

  useEffect(() => { if (studentId) void loadStudent() }, [studentId, loadStudent])
  useEffect(() => { if (studentId && tab === 'planner') void loadPlan() }, [studentId, tab, planDate, loadPlan])

  async function loadCourseData(courseId: string) {
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
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title))
    setSessions(list)
  }

  async function selectCourse(courseId: string) { setSelectedCourseId(courseId); await loadCourseData(courseId) }

  function getStatus(sessionId: string, activityId: string): ItemStatus {
    return progressMap[sessionId]?.[activityId]?.status ?? 'locked'
  }
  function isDue(sessionId: string, activityId: string): boolean {
    return Boolean(progressMap[sessionId]?.[activityId]?.due)
  }
  function getAttemptsUsed(sessionId: string, activityId: string): number {
    return Number(progressMap[sessionId]?.[activityId]?.attemptsUsed ?? 0)
  }

  async function toggleDue(sessionId: string, activityId: string) {
    if (!studentId || saving) return
    setSaving(true)
    try {
      const ref = doc(db, 'student_lesson_progress', `${studentId}_${sessionId}`)
      const snap = await getDoc(ref)
      const existing: ProgressEntry[] = snap.exists() ? ((snap.data().entries as ProgressEntry[]) ?? []) : []
      const idx = existing.findIndex((e) => (e.activityId as string) === activityId)
      const prev = idx >= 0 ? existing[idx]! : null
      const nextDue = !(prev?.due ?? false)
      const entry: ProgressEntry = {
        activityId,
        status: prev?.status ?? 'in_progress',
        due: nextDue,
        studentMarkedAt: prev?.studentMarkedAt ?? null,
        mentorApprovedAt: prev?.mentorApprovedAt ?? null,
      }
      if (idx >= 0) existing[idx] = entry
      else existing.push(entry)
      await setDoc(ref, stripUndefinedDeep({ studentId, sessionId, entries: existing }), { merge: true })
      setProgressMap((m) => { const sm = { ...(m[sessionId] ?? {}) }; sm[activityId] = entry; return { ...m, [sessionId]: sm } })
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') } finally { setSaving(false) }
  }

  async function approve(sessionId: string, activityId: string) {
    if (!studentId || saving) return
    setSaving(true)
    try {
      const ref = doc(db, 'student_lesson_progress', `${studentId}_${sessionId}`)
      const snap = await getDoc(ref)
      const existing: ProgressEntry[] = snap.exists() ? ((snap.data().entries as ProgressEntry[]) ?? []) : []
      const idx = existing.findIndex((e) => (e.activityId as string) === activityId)
      const entry: ProgressEntry = {
        activityId,
        status: 'completed',
        due: existing[idx]?.due ?? false,
        attemptsUsed: existing[idx]?.attemptsUsed ?? 0,
        studentMarkedAt: existing[idx]?.studentMarkedAt ?? null,
        mentorApprovedAt: new Date().toISOString(),
      }
      if (idx >= 0) existing[idx] = entry; else existing.push(entry)
      await setDoc(ref, stripUndefinedDeep({ studentId, sessionId, entries: existing }), { merge: true })
      setProgressMap((m) => { const sm = { ...(m[sessionId] ?? {}) }; sm[activityId] = entry; return { ...m, [sessionId]: sm } })
      await checkCourseCompletion()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') } finally { setSaving(false) }
  }

  async function reject(sessionId: string, activityId: string) {
    if (!studentId || saving) return
    setSaving(true)
    try {
      const ref = doc(db, 'student_lesson_progress', `${studentId}_${sessionId}`)
      const snap = await getDoc(ref)
      const existing: ProgressEntry[] = snap.exists() ? ((snap.data().entries as ProgressEntry[]) ?? []) : []
      const idx = existing.findIndex((e) => (e.activityId as string) === activityId)
      const entry: ProgressEntry = {
        activityId,
        status: 'in_progress',
        due: existing[idx]?.due ?? false,
        attemptsUsed: existing[idx]?.attemptsUsed ?? 0,
        studentMarkedAt: null,
        mentorApprovedAt: null,
      }
      if (idx >= 0) existing[idx] = entry; else existing.push(entry)
      await setDoc(ref, stripUndefinedDeep({ studentId, sessionId, entries: existing }), { merge: true })
      setProgressMap((m) => { const sm = { ...(m[sessionId] ?? {}) }; sm[activityId] = entry; return { ...m, [sessionId]: sm } })
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') } finally { setSaving(false) }
  }

  async function resetAttempts(sessionId: string, activityId: string) {
    if (!studentId || saving) return
    setSaving(true)
    try {
      const ref = doc(db, 'student_lesson_progress', `${studentId}_${sessionId}`)
      const snap = await getDoc(ref)
      const existing: ProgressEntry[] = snap.exists() ? ((snap.data().entries as ProgressEntry[]) ?? []) : []
      const idx = existing.findIndex((e) => (e.activityId as string) === activityId)
      const prev = idx >= 0 ? existing[idx]! : null
      const entry: ProgressEntry = {
        activityId,
        status: prev?.status ?? 'in_progress',
        due: prev?.due ?? false,
        attemptsUsed: 0,
        studentMarkedAt: prev?.studentMarkedAt ?? null,
        mentorApprovedAt: prev?.mentorApprovedAt ?? null,
      }
      if (idx >= 0) existing[idx] = entry
      else existing.push(entry)
      await setDoc(ref, stripUndefinedDeep({ studentId, sessionId, entries: existing }), { merge: true })
      setProgressMap((m) => { const sm = { ...(m[sessionId] ?? {}) }; sm[activityId] = entry; return { ...m, [sessionId]: sm } })
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') } finally { setSaving(false) }
  }

  const flat = useMemo(() => sessions.flatMap((s) => s.activities.map((a) => ({ sessionId: s.id, activityId: a.id }))), [sessions])

  async function checkCourseCompletion() {
    if (!studentId || !selectedCourseId) return
    const total = flat.length
    const done = flat.reduce((acc, x) => acc + (getStatus(x.sessionId, x.activityId) === 'completed' ? 1 : 0), 0)
    if (total > 0 && done >= total) {
      const courseName = courses.find((c) => c.id === selectedCourseId)?.title ?? ''
      try {
        await addDoc(collection(db, 'course_history'), { studentId, courseId: selectedCourseId, courseName, completedAt: serverTimestamp(), totalItems: total })
      } catch (e) {
        console.error('Failed writing course history', e)
      }
    }
  }


  if (loading) return <div className="shell"><p className="muted">Loading…</p></div>

  const selectedCourse = courses.find((c) => c.id === selectedCourseId)
  const totalAll = flat.length
  const doneAll = flat.reduce((s, x) => s + (getStatus(x.sessionId, x.activityId) === 'completed' ? 1 : 0), 0)
  const reviewAll = flat.reduce((s, x) => s + (getStatus(x.sessionId, x.activityId) === 'review' ? 1 : 0), 0)
  const pctAll = totalAll === 0 ? 0 : Math.round((doneAll / totalAll) * 100)

  return (
    <div>
      <Link to="/mentor" className="btn ghost small" style={{ marginBottom: '1rem', display: 'inline-flex' }}>← All Students</Link>
      <div className="mentor-student-header">
        <div className="mentor-student-avatar">{studentName.charAt(0).toUpperCase()}</div>
        <div>
          <h1 style={{ margin: 0 }}>{studentName}</h1>
          <p className="muted" style={{ margin: 0 }}>Review and approve student work</p>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}

      <div className="course-tabs" style={{ marginBottom: '0.75rem' }}>
        <button type="button" className={`course-tab${tab === 'progress' ? ' active' : ''}`} onClick={() => setTab('progress')}>📊 Progress</button>
        <button type="button" className={`course-tab${tab === 'planner' ? ' active' : ''}`} onClick={() => setTab('planner')}>📅 Daily Planner</button>
      </div>

      {tab === 'planner' && (
        <div>
          <div className="row" style={{ marginBottom: '1rem' }}>
            <input type="date" className="date-picker" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
          </div>
          {loadingPlan ? <p className="muted">Loading…</p> : null}
          {!loadingPlan && !plan ? <p className="muted">No plan for this date.</p> : null}
          {plan && plan.items.length === 0 ? <p className="muted">Student has an empty plan for this date.</p> : null}
          {plan && plan.items.length > 0 && (
            <div className="plan-items-list">
              {plan.items.map((item) => {
                const colors = itemTypeColors(item.activityType)
                return (
                  <div key={item.id} className={`plan-item${item.done ? ' done' : ''}`}>
                    <div className={`plan-item-check${item.done ? ' checked' : ''}`}>{item.done ? '✓' : ''}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="tag" style={{ background: colors.bg, color: colors.text, border: 'none', fontSize: '0.75rem' }}>{itemTypeLabel(item.activityType)}</span>
                        <strong style={{ textDecoration: item.done ? 'line-through' : 'none', opacity: item.done ? 0.6 : 1 }}>{item.activityTitle}</strong>
                      </div>
                      <span className="muted small">{item.sessionTitle}</span>
                      <div className="row" style={{ marginTop: '0.25rem' }}>
                        <span className="timer-display">{formatTime(item.timeSpentMs)}</span>
                        <span className="muted small">/ {item.plannedMinutes}m planned</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'progress' && (
        <>
          {courses.length > 1 && (
            <div className="course-tabs">
              {courses.map((c) => (
                <button key={c.id} type="button" className={`course-tab${selectedCourseId === c.id ? ' active' : ''}`}
                  onClick={() => void selectCourse(c.id)}>{c.title}</button>
              ))}
            </div>
          )}

          {selectedCourse && (
            <div className="course-hero" style={{ marginTop: '0.75rem' }}>
              <h2 style={{ margin: '0 0 0.5rem' }}>{selectedCourse.title}</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}><div className="planner-progress-bar"><div className="planner-progress-fill" style={{ width: `${pctAll}%` }} /></div></div>
                <span style={{ fontWeight: 700 }}>{pctAll}%</span>
                <span className="tag">{doneAll}/{totalAll} approved</span>
                {reviewAll > 0 && <span className="tag" style={{ background: '#fef9c3', color: '#92400e', border: 'none' }}>⏳ {reviewAll} to review</span>}
              </div>
            </div>
          )}

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
                      const status = getStatus(s.id, a.id)
                      const colors = itemTypeColors(a.type)
                      const isReview = status === 'review'
                      const isDone = status === 'completed'
                      const due = isDue(s.id, a.id)
                      const attemptsUsed = getAttemptsUsed(s.id, a.id)
                      const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attemptsUsed)
                      return (
                        <div key={a.id} className={`lesson-activity-row ${status}`}
                          style={{ borderLeft: `3px solid ${colors.border}`, background: isDone ? '#f8fdf9' : isReview ? '#fffbeb' : '#fff' }}>
                          <span className="activity-type-badge" style={{ background: colors.bg, color: colors.text }}>{itemTypeLabel(a.type)}</span>
                          <span className="activity-title" style={{ textDecoration: isDone ? 'line-through' : 'none', opacity: isDone ? 0.6 : 1 }}>{a.title}</span>
                          {due ? <span className="tag" style={{ background: '#fff0f0', borderColor: '#ffc7c7', color: '#b91c1c' }}>DUE</span> : null}
                          {attemptsUsed > 0 && !isDone ? (
                            <span className="tag" style={{ background: '#eef2ff', borderColor: '#c7d2fe', color: '#3730a3' }}>
                              Attempts: {attemptsUsed}/{MAX_ATTEMPTS} (left {attemptsLeft})
                            </span>
                          ) : null}
                          <div className="actions" style={{ marginLeft: 'auto' }}>
                            <button type="button" className="btn small ghost" onClick={() => void toggleDue(s.id, a.id)} disabled={saving}>
                              {due ? 'Clear Due' : 'Mark Due'}
                            </button>
                            <label className="row" style={{ gap: '0.35rem' }}>
                              <input
                                type="checkbox"
                                checked={isDone}
                                disabled={saving || isDone}
                                onChange={() => void approve(s.id, a.id)}
                              />
                              <span className="small" style={{ fontWeight: 700 }}>Complete</span>
                            </label>
                            {isReview ? (
                              <button type="button" className="btn small ghost" onClick={() => void reject(s.id, a.id)} disabled={saving}>Reject</button>
                            ) : null}
                            {attemptsUsed >= MAX_ATTEMPTS && !isDone ? (
                              <button type="button" className="btn small ghost" onClick={() => void resetAttempts(s.id, a.id)} disabled={saving}>Reset Attempts</button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
