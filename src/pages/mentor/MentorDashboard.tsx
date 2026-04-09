import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { normalizeRoles } from '../../lib/roles'
import type { Course, ProgressEntry, Session } from '../../types'

interface StudentSummary { id: string; name: string; email: string; courseIds: string[]; pct: number; reviewCount: number }

export function MentorDashboard() {
  const [students, setStudents] = useState<StudentSummary[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCourseId, setFilterCourseId] = useState<string>('__all__')

  useEffect(() => { void load() }, [])

  async function load() {
    try {
      const [usersSnap, coursesSnap, sessionsSnap, progSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('roles', 'array-contains', 'student'))),
        getDocs(collection(db, 'courses')),
        getDocs(collection(db, 'sessions')),
        getDocs(collection(db, 'student_lesson_progress')),
      ])

      const courseList: Course[] = []
      coursesSnap.forEach((d) => { const x = d.data(); courseList.push({ id: d.id, title: (x.title as string) ?? '' }) })
      courseList.sort((a, b) => a.title.localeCompare(b.title))
      setCourses(courseList)

      const sessionMap = new Map<string, Session>()
      sessionsSnap.forEach((d) => {
        const x = d.data()
        sessionMap.set(d.id, { id: d.id, title: '', courseId: (x.courseId as string) ?? null, order: Number(x.order ?? 0), activities: (x.activities as Session['activities']) ?? [] })
      })

      const progByStudent = new Map<string, { done: number; review: number; total: number }>()
      progSnap.forEach((d) => {
        const x = d.data(); const sid = x.studentId as string; const sessionId = (x.sessionId as string) ?? (x.lessonId as string)
        const session = sessionMap.get(sessionId)
        if (!session) return
        const entries = (x.entries as ProgressEntry[]) ?? []
        if (!progByStudent.has(sid)) progByStudent.set(sid, { done: 0, review: 0, total: 0 })
        const s = progByStudent.get(sid)!
        entries.forEach((e) => { if (e.status === 'completed') s.done++; if (e.status === 'review') s.review++ })
      })

      const totalItemsByStudent = new Map<string, number>()
      usersSnap.forEach((d) => {
        const x = d.data(); const cids = (x.courseIds as string[]) ?? []
        let total = 0
        sessionMap.forEach((s) => { if (cids.includes(s.courseId ?? '')) total += s.activities.length })
        totalItemsByStudent.set(d.id, total)
      })

      const list: StudentSummary[] = []
      usersSnap.forEach((d) => {
        const x = d.data()
        const roles = normalizeRoles(x)
        if (!roles.includes('student')) return
        const p = progByStudent.get(d.id) ?? { done: 0, review: 0, total: 0 }
        const totalItems = totalItemsByStudent.get(d.id) ?? 0
        const pct = totalItems === 0 ? 0 : Math.round((p.done / totalItems) * 100)
        list.push({ id: d.id, name: (x.name as string) ?? '', email: (x.email as string) ?? '', courseIds: (x.courseIds as string[]) ?? [], pct, reviewCount: p.review })
      })
      list.sort((a, b) => b.reviewCount - a.reviewCount || a.name.localeCompare(b.name))
      setStudents(list)
    } catch {} finally { setLoading(false) }
  }

  const filtered = filterCourseId === '__all__' ? students : students.filter((s) => s.courseIds.includes(filterCourseId))

  return (
    <div>
      <h1>Mentor Dashboard</h1>
      <p className="muted">Review student progress and approve completed activities.</p>

      <div className="row" style={{ marginBottom: '1rem', gap: '0.75rem' }}>
        <label>Course <select value={filterCourseId} onChange={(e) => setFilterCourseId(e.target.value)}>
          <option value="__all__">All</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select></label>
      </div>

      {loading ? <p className="muted">Loading…</p> : null}

      <div className="student-grid">
        {filtered.map((s) => (
          <Link key={s.id} to={`/mentor/students/${s.id}`} className="student-card">
            <div className="student-card-avatar">{s.name.charAt(0).toUpperCase()}</div>
            <div style={{ flex: 1 }}>
              <strong>{s.name}</strong>
              <div className="muted small">{s.email}</div>
              <div className="muted small" style={{ marginTop: '0.15rem' }}>{s.courseIds.map((cid) => courses.find((c) => c.id === cid)?.title ?? '').filter(Boolean).join(', ') || 'No courses'}</div>
              <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ flex: 1, height: 6, background: '#e7e9ff', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${s.pct}%`, background: s.pct === 100 ? '#10b981' : 'var(--primary)', borderRadius: 3 }} />
                </div>
                <span className="small" style={{ fontWeight: 600 }}>{s.pct}%</span>
              </div>
            </div>
            {s.reviewCount > 0 && <span className="review-badge">{s.reviewCount} to review</span>}
          </Link>
        ))}
        {filtered.length === 0 && !loading && <p className="muted">No students found.</p>}
      </div>
    </div>
  )
}
