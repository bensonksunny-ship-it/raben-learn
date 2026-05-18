import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import type { Course, DailyPlan, ProgressEntry } from '../../types'

function todayStr() { return new Date().toISOString().slice(0, 10) }
function formatDate(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

export function StudentDashboard() {
  const { firebaseUser, profile } = useAuth()
  const uid = firebaseUser?.uid
  const [courses, setCourses] = useState<Course[]>([])
  const [progress, setProgress] = useState<Record<string, { total: number; done: number; review: number }>>({})
  const [plan, setPlan] = useState<DailyPlan | null>(null)
  const [loading, setLoading] = useState(true)

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
        const x = d.data()
        if (courseIds.length === 0 || courseIds.includes(d.id))
          courseList.push({ id: d.id, title: (x.title as string) ?? '', description: (x.description as string) ?? '' })
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
        setPlan({ id: planSnap.id, studentId: d.studentId as string, date: d.date as string, items: (d.items as DailyPlan['items']) ?? [] })
      }
    } catch (e) {
      console.error('StudentDashboard load failed', e)
    } finally { setLoading(false) }
  }, [uid, profile])

  useEffect(() => { if (uid && profile) void load() }, [uid, profile, load])

  const todayDone = plan?.items.filter((i) => i.done).length ?? 0
  const todayTotal = plan?.items.length ?? 0
  const totalDone = Object.values(progress).reduce((s, p) => s + p.done, 0)
  const totalActivities = Object.values(progress).reduce((s, p) => s + p.total, 0)
  const overallPct = totalActivities > 0 ? Math.round((totalDone / totalActivities) * 100) : 0
  const totalReview = Object.values(progress).reduce((s, p) => s + p.review, 0)

  const firstName = profile?.name?.split(' ')[0] ?? 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.2rem' }}>{greeting}, {firstName}!</h1>
          <p className="muted" style={{ margin: 0 }}>Here's your learning overview</p>
        </div>
        <span className="page-stat">{formatDate(new Date())}</span>
      </div>

      {loading ? <p className="muted">Loading…</p> : (
        <>
          {/* Stat cards */}
          <div className="dash-stat-grid" style={{ marginBottom: '1.75rem' }}>
            {([
              { icon: '📚', value: courses.length, label: 'Courses', sub: 'enrolled', color: 'var(--primary)' },
              { icon: '✅', value: `${todayDone}/${todayTotal}`, label: "Today's Plan", sub: todayTotal === 0 ? 'no plan yet' : `${todayTotal - todayDone} remaining`, color: '#059669' },
              { icon: '📈', value: `${overallPct}%`, label: 'Overall Progress', sub: `${totalDone} completed`, color: '#7c3aed' },
              { icon: '⏳', value: totalReview, label: 'Under Review', sub: 'pending mentor', color: totalReview > 0 ? '#d97706' : 'var(--muted-2)' },
            ] as const).map((s) => (
              <div key={s.label} className="panel dash-stat-card">
                <span className="dash-stat-icon">{s.icon}</span>
                <span className="dash-stat-value" style={{ color: s.color }}>{s.value}</span>
                <span className="dash-stat-label">{s.label}</span>
                <span className="muted small">{s.sub}</span>
              </div>
            ))}
          </div>

          <div className="dash-two-col">
            {/* Quick actions */}
            <section className="panel">
              <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Quick Actions</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {[
                  { to: '/student/planner', icon: '📅', label: "Today's Plan", desc: 'View and complete your daily tasks' },
                  { to: '/student/history', icon: '🏆', label: 'History', desc: 'Your completed sessions and progress' },
                  { to: '/student', icon: '📖', label: 'My Courses', desc: 'Browse all enrolled courses' },
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

          {/* Course progress */}
          <section className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>My Courses</h2>
              <Link to="/student" className="btn small secondary">All Courses →</Link>
            </div>

            {courses.length === 0 ? (
              <p className="muted">No courses assigned yet. Ask your mentor to enroll you.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                {courses.map((c) => {
                  const p = progress[c.id] ?? { total: 0, done: 0, review: 0 }
                  const pct = p.total === 0 ? 0 : Math.round((p.done / p.total) * 100)
                  return (
                    <Link key={c.id} to={`/student/courses/${c.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{c.title}</span>
                          <span className="muted small">{p.done} of {p.total} done</span>
                          {p.review > 0 && (
                            <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 99, padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 700 }}>
                              ⏳ {p.review} under review
                            </span>
                          )}
                        </div>
                        <span style={{ fontWeight: 700, fontSize: '0.92rem', color: pct === 100 ? '#059669' : 'var(--primary)', flexShrink: 0 }}>
                          {pct}%
                        </span>
                      </div>
                      <div className="dash-progress-bar">
                        <div className="dash-progress-fill" style={{ width: `${pct}%`, background: pct === 100 ? '#10b981' : 'var(--primary)' }} />
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
