import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { mapCourseDoc } from '../../lib/courses'
import type { ClassTimetable, Course, ElectiveSchedule, ProgressEntry, Weekday } from '../../types'
import { OwlMascot } from '../../components/manager/OwlMascot'
import { NavCard } from '../../components/manager/NavCard'
import {
  timeStrToMinutes, todayStr,
  createDefaultTimetable, normalizeTimetable, createDefaultElectives, normalizeElectives,
} from '../../components/manager/schedulerShared'
// Statically imported, not lazy — App.tsx already bundles it eagerly for its own
// /student/planner route, so a lazy() wrapper here would just be dead weight
// (same JS, no later chunk fetch to defer).
import { StudentDailyPlanner } from './StudentDailyPlanner'

// This one genuinely isn't loaded anywhere else yet, so lazy-loading it here keeps
// its (PriorityScheduler-pulling) chunk out of the main bundle until opened.
const StudentTimetableView = lazy(() => import('./StudentTimetableView').then((m) => ({ default: m.StudentTimetableView })))

// No separate "courses" view — the dashboard's own "My Courses" section below is
// the one place a student browses their enrolled courses. A popup duplicating
// that list (the old `?view=courses`) was redundant with it.
type StudentView = 'timetable' | 'planner'

function isStudentView(v: string | null): v is StudentView {
  return v === 'timetable' || v === 'planner'
}

/** 12-hour clock label for an "HH:MM" string, e.g. "14:30" → "2:30 PM". */
function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (h == null || m == null) return hhmm
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${display} ${period}` : `${display}:${String(m).padStart(2, '0')} ${period}`
}

const JS_DAY_TO_WEEKDAY: (Weekday | null)[] = [null, 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface NextClassInfo { title: string; startTime: string; mentorName: string | null; status: 'now' | 'next' }

/** The next class today — a locked period or an elective, whichever starts soonest
 *  from now (or is already running). Locked periods have no mentor field, so
 *  `mentorName` is only ever populated for an elective. */
function computeNextClass(timetable: ClassTimetable, electives: ElectiveSchedule): NextClassInfo | null {
  const now = new Date()
  const weekday = JS_DAY_TO_WEEKDAY[now.getDay()]
  if (!weekday) return null
  const nowMin = now.getHours() * 60 + now.getMinutes()

  const items = [
    ...(timetable.days[weekday]?.periods ?? []).map((p) => ({
      title: p.title, startTime: p.startTime, mentorName: null as string | null,
      startMin: timeStrToMinutes(p.startTime) ?? 0, durationMinutes: p.durationMinutes,
    })),
    ...(electives.days[weekday]?.sessions ?? []).map((s) => ({
      title: s.title, startTime: s.startTime, mentorName: s.mentorName ?? null,
      startMin: timeStrToMinutes(s.startTime) ?? 0, durationMinutes: s.durationMinutes,
    })),
  ].sort((a, b) => a.startMin - b.startMin)

  const inProgress = items.find((i) => i.startMin <= nowMin && nowMin < i.startMin + i.durationMinutes)
  if (inProgress) return { title: inProgress.title, startTime: inProgress.startTime, mentorName: inProgress.mentorName, status: 'now' }
  const upcoming = items.find((i) => i.startMin >= nowMin)
  if (upcoming) return { title: upcoming.title, startTime: upcoming.startTime, mentorName: upcoming.mentorName, status: 'next' }
  return null
}

export function StudentDashboard() {
  const { firebaseUser, profile } = useAuth()
  const uid = firebaseUser?.uid
  const [courses, setCourses] = useState<Course[]>([])
  const [progress, setProgress] = useState<Record<string, { total: number; done: number; review: number }>>({})
  const [plan, setPlan] = useState<{ items: { id: string; done: boolean; activityTitle: string }[] } | null>(null)
  const [loading, setLoading] = useState(true)

  const [nextClass, setNextClass] = useState<NextClassInfo | null>(null)
  const [loadingSchedule, setLoadingSchedule] = useState(true)

  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const rawView = searchParams.get('view')
  const view = isStudentView(rawView) ? rawView : null
  function closeView() { navigate('/student') }

  const load = useCallback(async () => {
    if (!uid || !profile) return
    try {
      const courseIds = profile.courseIds ?? []
      const [coursesSnap, sessionsSnap, progSnap, planSnap] = await Promise.all([
        getDocs(collection(db, 'courses')),
        getDocs(collection(db, 'sessions')),
        getDocs(query(collection(db, 'student_lesson_progress'), where('studentId', '==', uid))),
        getDoc(doc(db, 'student_daily_plans', `${uid}_${todayStr()}`)),
      ])

      const courseList: Course[] = []
      coursesSnap.forEach((d) => {
        if (courseIds.length === 0 || courseIds.includes(d.id))
          courseList.push(mapCourseDoc(d))
      })
      courseList.sort((a, b) => a.title.localeCompare(b.title))
      setCourses(courseList)

      const activityCountByCourse = new Map<string, number>()
      const sessionCourseMap = new Map<string, string>()
      sessionsSnap.forEach((d) => {
        const x = d.data()
        const cid = (x.courseId as string) ?? ''
        const activities = (x.activities as Array<{ id: string }>) ?? []
        activityCountByCourse.set(cid, (activityCountByCourse.get(cid) ?? 0) + activities.length)
        sessionCourseMap.set(d.id, cid)
      })

      const progMap: Record<string, { total: number; done: number; review: number }> = {}
      for (const c of courseList) progMap[c.id] = { total: activityCountByCourse.get(c.id) ?? 0, done: 0, review: 0 }

      progSnap.forEach((d) => {
        const x = d.data()
        const sid = (x.sessionId as string) ?? (x.lessonId as string)
        const cid = sessionCourseMap.get(sid) ?? ''
        const entries = (x.entries as ProgressEntry[]) ?? []
        if (progMap[cid]) {
          entries.forEach((e) => {
            if (e.status === 'completed') progMap[cid].done++
            if (e.status === 'review') progMap[cid].review++
          })
        }
      })
      setProgress(progMap)

      if (planSnap.exists()) {
        const d = planSnap.data()
        setPlan({ items: (d.items as { id: string; done: boolean; activityTitle: string }[]) ?? [] })
      }
    } catch (e) {
      console.error('StudentDashboard load failed', e)
    } finally { setLoading(false) }
  }, [uid, profile])

  useEffect(() => { if (uid && profile) void load() }, [uid, profile, load])

  useEffect(() => {
    void (async () => {
      try {
        const [timetableSnap, electivesSnap] = await Promise.all([
          getDoc(doc(db, 'class_timetable', 'master')),
          getDoc(doc(db, 'elective_sessions', 'master')),
        ])
        const timetable = normalizeTimetable(timetableSnap.exists() ? timetableSnap.data() : undefined)
        const electives = normalizeElectives(electivesSnap.exists() ? electivesSnap.data() : undefined)
        setNextClass(computeNextClass(timetable, electives))
      } catch (e) {
        console.error('StudentDashboard schedule load failed', e)
        setNextClass(computeNextClass(createDefaultTimetable(), createDefaultElectives()))
      } finally {
        setLoadingSchedule(false)
      }
    })()
  }, [])

  const todayDone = plan?.items.filter((i) => i.done).length ?? 0
  const todayTotal = plan?.items.length ?? 0
  const totalDone = Object.values(progress).reduce((s, p) => s + p.done, 0)
  const totalActivities = Object.values(progress).reduce((s, p) => s + p.total, 0)
  const overallPct = totalActivities > 0 ? Math.round((totalDone / totalActivities) * 100) : 0
  const totalReview = Object.values(progress).reduce((s, p) => s + p.review, 0)

  const firstName = profile?.name?.split(' ')[0] ?? 'there'

  return (
    <div>
      {/* Hero — just the mascot (kept for the same illustrated identity every
          dashboard uses) and a plain title. No date, no tagline, no emoji. */}
      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', borderRadius: 'calc(var(--radius) + 10px)' }}>
        <OwlMascot size={108} />
        <h1 style={{ margin: 0 }}>Welcome back, {firstName}</h1>
      </div>

      {/* Today's schedule — next class summary, plain text only (no status pill,
          no mentor name) so it reads as one simple line. */}
      <div className="panel" style={{ marginBottom: '1.75rem', borderRadius: 'calc(var(--radius) + 10px)' }}>
        <h2 style={{ margin: '0 0 0.6rem', fontSize: '1rem' }}>Today's Schedule</h2>
        {loadingSchedule ? (
          <p className="muted small" style={{ margin: 0 }}>Loading…</p>
        ) : !nextClass ? (
          <p className="muted small" style={{ margin: 0 }}>No more classes scheduled for today.</p>
        ) : (
          <p style={{ margin: 0, fontSize: '0.98rem' }}>
            {nextClass.status === 'now' ? 'Now' : 'Next'}: {nextClass.title} at {formatClock(nextClass.startTime)}
          </p>
        )}
      </div>

      {/* Student Action Grid — minimal cards: bold title only, no icon/subtitle/arrow.
          Just Timetable and Notes — courses live in the "My Courses" section below,
          not a separate card/view. */}
      <div className="nav-card-grid student-action-grid" style={{ marginBottom: '1.75rem' }}>
        <NavCard title="Timetable" color="#8b5cf6" to="/student?view=timetable" minimal />
        <NavCard title="Notes" color="#059669" to="/student?view=planner" minimal />
      </div>

      {loading ? <p className="muted">Loading…</p> : (
        <>
          {/* Stat cards — "Courses" is informational only (enrolled count), since
              there's no more course-browsing view to link it to. */}
          <div className="dash-stat-grid" style={{ marginBottom: '1.75rem' }}>
            {([
              { icon: '📚', value: courses.length, label: 'Courses', sub: 'enrolled', color: 'var(--primary)', to: null },
              { icon: '✅', value: `${todayDone}/${todayTotal}`, label: "Today's Plan", sub: todayTotal === 0 ? 'no plan yet' : `${todayTotal - todayDone} remaining`, color: '#059669', to: '/student/planner' },
              { icon: '📈', value: `${overallPct}%`, label: 'Overall Progress', sub: `${totalDone} completed`, color: '#7c3aed', to: '/student/history' },
              { icon: '⏳', value: totalReview, label: 'Under Review', sub: 'pending mentor', color: totalReview > 0 ? '#d97706' : 'var(--muted-2)', to: '/student/history' },
            ] as const).map((s) => {
              const body = (
                <>
                  <span className="dash-stat-icon">{s.icon}</span>
                  <span className="dash-stat-value" style={{ color: s.color }}>{s.value}</span>
                  <span className="dash-stat-label">{s.label}</span>
                  <span className="muted small">{s.sub}</span>
                  {s.to && <span className="dash-stat-arrow" aria-hidden>→</span>}
                </>
              )
              return s.to
                ? <Link key={s.label} to={s.to} className="panel dash-stat-card">{body}</Link>
                : <div key={s.label} className="panel dash-stat-card">{body}</div>
            })}
          </div>

          <div className="dash-two-col">
            {/* Quick actions */}
            <section className="panel">
              <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Quick Actions</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {[
                  { to: '/student/planner', icon: '📅', label: "Today's Plan", desc: 'View and complete your daily tasks' },
                  { to: '/student/history', icon: '🏆', label: 'History', desc: 'Your completed sessions and progress' },
                ].map((a) => (
                  <Link key={a.to} to={a.to} className="dash-action-link">
                    <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>{a.icon}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{a.label}</div>
                      <div className="muted small">{a.desc}</div>
                    </div>
                    <span style={{ marginLeft: 'auto', color: 'var(--muted-2)', fontSize: '1rem' }}>›</span>
                  </Link>
                ))}
              </div>
            </section>

            {/* Today's plan snapshot */}
            <section className="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Today's Plan</h2>
                {todayTotal > 0 && (
                  <span style={{ background: '#059669', color: '#fff', borderRadius: 99, padding: '0.15rem 0.65rem', fontSize: '0.75rem', fontWeight: 700 }}>
                    {todayDone}/{todayTotal}
                  </span>
                )}
              </div>

              {todayTotal === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--muted-2)' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📅</div>
                  <div className="small">No plan for today yet</div>
                  <Link to="/student/planner" className="btn primary small" style={{ marginTop: '0.75rem', display: 'inline-flex' }}>Open Planner</Link>
                </div>
              ) : (
                <>
                  <div className="dash-progress-bar" style={{ marginBottom: '0.85rem' }}>
                    <div className="dash-progress-fill" style={{ width: `${todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : 0}%`, background: '#059669' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {(plan?.items ?? []).slice(0, 5).map((item) => (
                      <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0.6rem', borderRadius: 8, background: item.done ? '#f0fdf4' : 'var(--surface-soft)', border: '1px solid var(--border)' }}>
                        <span style={{ fontSize: '0.9rem' }}>{item.done ? '✅' : '⬜'}</span>
                        <span style={{ fontSize: '0.88rem', flex: 1, color: item.done ? 'var(--muted-2)' : 'var(--text)', textDecoration: item.done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.activityTitle}</span>
                      </div>
                    ))}
                    {(plan?.items.length ?? 0) > 5 && (
                      <Link to="/student/planner" className="muted small" style={{ textAlign: 'center', paddingTop: '0.25rem' }}>
                        +{(plan?.items.length ?? 0) - 5} more — View all →
                      </Link>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        </>
      )}

      {/* Action-grid popups — same `?view=` overlay pattern as ManagerDashboard. */}
      {view && (() => {
        const isFullscreen = view === 'timetable'
        return (
          <div
            className={`modal-backdrop${isFullscreen ? ' modal-backdrop-fullscreen' : ''}`}
            onClick={closeView}
          >
            <div
              className={`modal manager-view-modal${isFullscreen ? ' manager-view-modal-fullscreen' : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Close"
                className={`btn small ghost manager-view-close${isFullscreen ? ' manager-view-close-fullscreen' : ''}`}
                onClick={closeView}
              >
                {isFullscreen ? '✕' : '✕ Close'}
              </button>
              {isFullscreen ? (
                <div className="manager-view-fullscreen-body">
                  <Suspense fallback={<p className="muted">Loading…</p>}>
                    <StudentTimetableView />
                  </Suspense>
                </div>
              ) : (
                view === 'planner' && <StudentDailyPlanner />
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
