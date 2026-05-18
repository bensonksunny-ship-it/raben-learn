import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { normalizeRoles } from '../../lib/roles'
import type { Course, ProgressEntry } from '../../types'

interface DashStats {
  students: number
  activeStudents: number
  mentors: number
  courses: number
  sessions: number
}

interface CourseStats {
  course: Course
  enrolled: number
  avgProgress: number
  pendingReviews: number
}

interface ReviewItem {
  studentId: string
  studentName: string
  count: number
  courseNames: string[]
}

function formatDate(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

export default function AdminDashboard() {
  const { profile } = useAuth()
  const [stats, setStats] = useState<DashStats | null>(null)
  const [courseStats, setCourseStats] = useState<CourseStats[]>([])
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { void load() }, [])

  async function load() {
    try {
      const [usersSnap, coursesSnap, sessionsSnap, progSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'courses')),
        getDocs(collection(db, 'sessions')),
        getDocs(collection(db, 'student_lesson_progress')),
      ])

      // Users
      let studentCount = 0, activeStudents = 0, mentorCount = 0
      const studentMap = new Map<string, { name: string; courseIds: string[] }>()
      usersSnap.forEach((d) => {
        const x = d.data()
        const roles = normalizeRoles(x)
        if (roles.includes('student')) {
          studentCount++
          if (x.status === 'active') activeStudents++
          studentMap.set(d.id, { name: (x.name as string) ?? '', courseIds: (x.courseIds as string[]) ?? [] })
        }
        if (roles.includes('mentor')) mentorCount++
      })

      // Courses
      const courseList: Course[] = []
      coursesSnap.forEach((d) => { const x = d.data(); courseList.push({ id: d.id, title: (x.title as string) ?? '' }) })
      courseList.sort((a, b) => a.title.localeCompare(b.title))

      // Sessions — map sessionId → courseId, count activities per course
      const sessionCourse = new Map<string, string>()
      const activitiesPerCourse = new Map<string, number>()
      sessionsSnap.forEach((d) => {
        const x = d.data()
        const cid = (x.courseId as string) ?? ''
        const acts = (x.activities as unknown[]) ?? []
        sessionCourse.set(d.id, cid)
        activitiesPerCourse.set(cid, (activitiesPerCourse.get(cid) ?? 0) + acts.length)
      })

      // Progress — per student per course: done count, review count
      const prog = new Map<string, Map<string, { done: number; review: number }>>()
      progSnap.forEach((d) => {
        const x = d.data()
        const sid = x.studentId as string
        const sessId = (x.sessionId as string) ?? (x.lessonId as string)
        const cid = sessionCourse.get(sessId) ?? ''
        if (!cid || !studentMap.has(sid)) return
        const entries = (x.entries as ProgressEntry[]) ?? []
        if (!prog.has(sid)) prog.set(sid, new Map())
        const smap = prog.get(sid)!
        if (!smap.has(cid)) smap.set(cid, { done: 0, review: 0 })
        const cur = smap.get(cid)!
        entries.forEach((e) => {
          if (e.status === 'completed') cur.done++
          if (e.status === 'review') cur.review++
        })
      })

      // Build course stats
      const cStats: CourseStats[] = courseList.map((c) => {
        const enrolled = [...studentMap.entries()].filter(([, s]) => s.courseIds.includes(c.id))
        const total = activitiesPerCourse.get(c.id) ?? 0
        let sumPct = 0, pendingReviews = 0
        enrolled.forEach(([sid]) => {
          const p = prog.get(sid)?.get(c.id)
          if (p) {
            sumPct += total > 0 ? Math.round((p.done / total) * 100) : 0
            pendingReviews += p.review
          }
        })
        return {
          course: c,
          enrolled: enrolled.length,
          avgProgress: enrolled.length > 0 ? Math.round(sumPct / enrolled.length) : 0,
          pendingReviews,
        }
      })

      // Pending reviews — aggregate per student
      const reviewMap = new Map<string, { count: number; cids: Set<string> }>()
      progSnap.forEach((d) => {
        const x = d.data()
        const sid = x.studentId as string
        const sessId = (x.sessionId as string) ?? (x.lessonId as string)
        const cid = sessionCourse.get(sessId) ?? ''
        const entries = (x.entries as ProgressEntry[]) ?? []
        const rc = entries.filter((e) => e.status === 'review').length
        if (rc > 0 && studentMap.has(sid)) {
          if (!reviewMap.has(sid)) reviewMap.set(sid, { count: 0, cids: new Set() })
          const r = reviewMap.get(sid)!
          r.count += rc
          if (cid) r.cids.add(cid)
        }
      })
      const reviewList: ReviewItem[] = [...reviewMap.entries()]
        .map(([sid, data]) => ({
          studentId: sid,
          studentName: studentMap.get(sid)?.name ?? '',
          count: data.count,
          courseNames: [...data.cids].map((cid) => courseList.find((c) => c.id === cid)?.title ?? '').filter(Boolean),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)

      setStats({ students: studentCount, activeStudents, mentors: mentorCount, courses: courseList.length, sessions: sessionsSnap.size })
      setCourseStats(cStats)
      setReviews(reviewList)
    } catch (e) {
      console.error('Dashboard load failed', e)
    } finally {
      setLoading(false)
    }
  }

  const totalPending = reviews.reduce((s, r) => s + r.count, 0)

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.2rem' }}>Dashboard</h1>
          <p className="muted" style={{ margin: 0 }}>
            Welcome back{profile?.name ? `, ${profile.name}` : ''}
          </p>
        </div>
        <span className="page-stat">{formatDate(new Date())}</span>
      </div>

      {loading ? <p className="muted">Loading…</p> : null}

      {/* Stat cards */}
      {stats && (
        <div className="dash-stat-grid">
          {([
            { icon: '🎓', value: stats.students, label: 'Students', sub: `${stats.activeStudents} active`, color: 'var(--primary)' },
            { icon: '👨‍🏫', value: stats.mentors, label: 'Mentors', sub: 'teaching staff', color: '#d97706' },
            { icon: '📚', value: stats.courses, label: 'Courses', sub: 'available', color: '#7c3aed' },
            { icon: '📄', value: stats.sessions, label: 'Sessions', sub: 'total lessons', color: '#059669' },
          ] as const).map((s) => (
            <div key={s.label} className="panel dash-stat-card">
              <span className="dash-stat-icon">{s.icon}</span>
              <span className="dash-stat-value" style={{ color: s.color }}>{s.value}</span>
              <span className="dash-stat-label">{s.label}</span>
              <span className="muted small">{s.sub}</span>
            </div>
          ))}
        </div>
      )}

      <div className="dash-two-col">
        {/* Quick actions */}
        <section className="panel">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Quick Actions</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {[
              { to: '/admin/students', icon: '🎓', label: 'Students', desc: 'Add students, manage enrollments' },
              { to: '/admin/users', icon: '👤', label: 'User Management', desc: 'Roles, passwords, accounts' },
              { to: '/admin/syllabus', icon: '📚', label: 'Syllabus Builder', desc: 'Courses, sessions, topics' },
              { to: '/admin/reports', icon: '📊', label: 'Reports', desc: 'Progress and completion rates' },
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

        {/* Pending reviews */}
        <section className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Pending Reviews</h2>
            {totalPending > 0 && (
              <span style={{ background: '#f59e0b', color: '#fff', borderRadius: 99, padding: '0.15rem 0.65rem', fontSize: '0.75rem', fontWeight: 700 }}>
                {totalPending}
              </span>
            )}
          </div>
          {reviews.length === 0 && !loading ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--muted-2)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</div>
              <div className="small">No pending reviews</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {reviews.map((r) => (
                <Link key={r.studentId} to={`/mentor/students/${r.studentId}`} className="dash-review-item">
                  <span style={{ fontSize: '1rem', flexShrink: 0 }}>⏳</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.studentName}
                    </div>
                    <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.courseNames.join(', ')}
                    </div>
                  </div>
                  <span style={{ background: '#f59e0b', color: '#fff', borderRadius: 99, padding: '0.12rem 0.55rem', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>
                    {r.count}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Course overview */}
      <section className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Course Overview</h2>
          <Link to="/admin/reports" className="btn small secondary">Full Reports →</Link>
        </div>

        {courseStats.length === 0 && !loading && (
          <p className="muted">No courses yet. <Link to="/admin/syllabus">Create one →</Link></p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          {courseStats.map((cs) => (
            <div key={cs.course.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{cs.course.title}</span>
                  <span className="muted small">{cs.enrolled} student{cs.enrolled !== 1 ? 's' : ''}</span>
                  {cs.pendingReviews > 0 && (
                    <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 99, padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 700 }}>
                      ⏳ {cs.pendingReviews} review{cs.pendingReviews !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <span style={{ fontWeight: 700, fontSize: '0.92rem', color: cs.avgProgress === 100 ? '#059669' : 'var(--primary)', flexShrink: 0 }}>
                  {cs.avgProgress}%
                </span>
              </div>
              <div className="dash-progress-bar">
                <div
                  className="dash-progress-fill"
                  style={{
                    width: `${cs.avgProgress}%`,
                    background: cs.avgProgress === 100 ? '#10b981' : 'var(--primary)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
