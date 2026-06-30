import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { Course, ProgressEntry } from '../../types'
import { normalizeRoles } from '../../lib/roles'

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

interface StudentReport { id: string; name: string; email: string; courseIds: string[]; progress: Record<string, { total: number; done: number; review: number }>; totalTimeMs: number }

export function ReportsPage() {
  const [reports, setReports] = useState<StudentReport[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCourseId, setSelectedCourseId] = useState<string>('__all__')

  useEffect(() => { void loadReports() }, [])

  async function loadReports() {
    setLoading(true)
    try {
      const [usersSnap, coursesSnap, sessionsSnap, progSnap, plansSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('roles', 'array-contains', 'student'))),
        getDocs(collection(db, 'courses')),
        getDocs(collection(db, 'sessions')),
        getDocs(collection(db, 'student_lesson_progress')),
        getDocs(collection(db, 'student_daily_plans')),
      ])

      const courseList: Course[] = []
      coursesSnap.forEach((d) => { const x = d.data(); courseList.push({ id: d.id, title: (x.title as string) ?? '' }) })
      courseList.sort((a, b) => a.title.localeCompare(b.title))
      setCourses(courseList)

      const activityByCourse = new Map<string, number>()
      sessionsSnap.forEach((d) => {
        const x = d.data(); const cid = (x.courseId as string) ?? ''
        const activities = (x.activities as Array<{ id: string }>) ?? []
        activityByCourse.set(cid, (activityByCourse.get(cid) ?? 0) + activities.length)
      })

      const progByStudent = new Map<string, Map<string, { done: number; review: number }>>()
      const sessionCourseMap = new Map<string, string>()
      sessionsSnap.forEach((d) => { const x = d.data(); sessionCourseMap.set(d.id, (x.courseId as string) ?? '') })

      progSnap.forEach((d) => {
        const x = d.data(); const sid = x.studentId as string; const sessionId = (x.sessionId as string) ?? (x.lessonId as string)
        const cid = sessionCourseMap.get(sessionId) ?? ''
        const entries = (x.entries as ProgressEntry[]) ?? []
        if (!progByStudent.has(sid)) progByStudent.set(sid, new Map())
        const smap = progByStudent.get(sid)!
        if (!smap.has(cid)) smap.set(cid, { done: 0, review: 0 })
        const cs = smap.get(cid)!
        entries.forEach((e) => { if (e.status === 'completed') cs.done++; if (e.status === 'review') cs.review++ })
      })

      const timeByStudent = new Map<string, number>()
      plansSnap.forEach((d) => {
        const x = d.data(); const sid = x.studentId as string
        const items = (x.items as Array<{ timeSpentMs: number }>) ?? []
        const total = items.reduce((s, i) => s + (i.timeSpentMs ?? 0), 0)
        timeByStudent.set(sid, (timeByStudent.get(sid) ?? 0) + total)
      })

      const result: StudentReport[] = []
      usersSnap.forEach((d) => {
        const x = d.data()
        const roles = normalizeRoles(x)
        if (!roles.includes('student')) return
        const sid = d.id
        const progress: Record<string, { total: number; done: number; review: number }> = {}
        courseList.forEach((c) => {
          const total = activityByCourse.get(c.id) ?? 0
          const pr = progByStudent.get(sid)?.get(c.id) ?? { done: 0, review: 0 }
          progress[c.id] = { total, done: pr.done, review: pr.review }
        })
        result.push({ id: sid, name: (x.name as string) ?? '', email: (x.email as string) ?? '', courseIds: (x.courseIds as string[]) ?? [], progress, totalTimeMs: timeByStudent.get(sid) ?? 0 })
      })
      result.sort((a, b) => a.name.localeCompare(b.name))
      setReports(result)
    } catch (e) {
      console.error('loadReports failed', e)
    } finally { setLoading(false) }
  }

  const filtered = selectedCourseId === '__all__' ? reports : reports.filter((r) => r.courseIds.includes(selectedCourseId))

  const courseCompletionRates = courses.map((c) => {
    const relevant = reports.filter((r) => r.courseIds.includes(c.id))
    const doneCount = relevant.filter((r) => { const p = r.progress[c.id]; return p && p.total > 0 && p.done >= p.total }).length
    return { course: c, enrolled: relevant.length, completed: doneCount, rate: relevant.length > 0 ? Math.round((doneCount / relevant.length) * 100) : 0 }
  })

  return (
    <div>
      <h1>📊 Reports</h1>

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <h2>Course Completion Rates</h2>
        <div className="table-wrap"><table className="table"><thead><tr><th>Course</th><th>Enrolled</th><th>Completed</th><th>Rate</th></tr></thead><tbody>
          {courseCompletionRates.map((c) => (
            <tr key={c.course.id}>
              <td>{c.course.title}</td><td>{c.enrolled}</td><td>{c.completed}</td>
              <td><div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: 80, height: 6, background: '#e7e9ff', borderRadius: 3, overflow: 'hidden' }}><div style={{ height: '100%', width: `${c.rate}%`, background: c.rate === 100 ? '#10b981' : 'var(--primary)', borderRadius: 3 }} /></div>
                <span className="small">{c.rate}%</span></div></td>
            </tr>
          ))}
        </tbody></table></div>
      </section>

      <section className="panel">
        <h2>Per-Student Progress</h2>
        <div className="row" style={{ marginBottom: '0.75rem' }}>
          <label>Course Filter <select value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}>
            <option value="__all__">All Courses</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select></label>
        </div>
        {loading ? <p className="muted">Loading…</p> : null}
        <div className="table-wrap"><table className="table"><thead><tr>
          <th>Student</th><th>Email</th><th>Total Time</th>
          {(selectedCourseId === '__all__' ? courses : courses.filter((c) => c.id === selectedCourseId)).map((c) => (
            <th key={c.id}>{c.title}</th>
          ))}
        </tr></thead><tbody>
          {filtered.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/mentor/students/${r.id}`}>{r.name}</Link></td><td className="muted">{r.email}</td><td>{formatTime(r.totalTimeMs)}</td>
              {(selectedCourseId === '__all__' ? courses : courses.filter((c) => c.id === selectedCourseId)).map((c) => {
                const p = r.progress[c.id] ?? { total: 0, done: 0, review: 0 }
                const pct = p.total === 0 ? 0 : Math.round((p.done / p.total) * 100)
                return (
                  <td key={c.id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <div style={{ width: 60, height: 6, background: '#e7e9ff', borderRadius: 3, overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#10b981' : 'var(--primary)', borderRadius: 3 }} /></div>
                      <span className="small">{pct}%</span>
                      {p.review > 0 && <span className="tag small" style={{ background: '#fef9c3', color: '#92400e', border: 'none', padding: '0.1rem 0.3rem', fontSize: '0.65rem' }}>⏳{p.review}</span>}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody></table></div>
      </section>
    </div>
  )
}
