import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import type { Course, ProgressEntry } from '../../types'

export function StudentCoursesPage() {
  const { firebaseUser, profile } = useAuth()
  const uid = firebaseUser?.uid
  const [courses, setCourses] = useState<Course[]>([])
  const [progress, setProgress] = useState<Record<string, { total: number; done: number; review: number }>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!uid || !profile) return
    try {
      const courseIds = profile.courseIds ?? []
      const [coursesSnap, sessionsSnap, progSnap] = await Promise.all([
        getDocs(collection(db, 'courses')),
        getDocs(collection(db, 'sessions')),
        getDocs(query(collection(db, 'student_lesson_progress'), where('studentId', '==', uid))),
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
    } catch (e) {
      console.error('StudentCoursesPage load failed', e)
    } finally { setLoading(false) }
  }, [uid, profile])

  useEffect(() => { if (uid && profile) void load() }, [uid, profile, load])

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ marginBottom: '0.2rem' }}>My Courses</h1>
        <p className="muted" style={{ margin: 0 }}>Open a course to view its syllabus and track your progress</p>
      </div>

      {loading ? <p className="muted">Loading…</p> : (
        <>
          {courses.length === 0 ? (
            <p className="muted">No courses assigned yet. Ask your mentor to enroll you.</p>
          ) : (
            <div className="course-grid">
              {courses.map((c) => {
                const p = progress[c.id] ?? { total: 0, done: 0, review: 0 }
                const pct = p.total === 0 ? 0 : Math.round((p.done / p.total) * 100)
                return (
                  <Link key={c.id} to={`/student/courses/${c.id}`} className="course-card">
                    <h3 style={{ margin: '0 0 0.25rem' }}>{c.title}</h3>
                    {c.description ? <p className="muted small" style={{ margin: '0 0 0.65rem' }}>{c.description}</p> : null}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                      <div style={{ flex: 1, height: 8, background: '#e7e9ff', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#10b981' : 'var(--primary)', borderRadius: 4, transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{pct}%</span>
                    </div>
                    <div className="muted small">
                      {p.done} approved
                      {p.review > 0 ? ` · ${p.review} under review` : ''}
                      {` · ${p.total - p.done - p.review} remaining`}
                    </div>
                    {pct === 100 && <span className="tag" style={{ background: '#dcfce7', color: '#166534', border: 'none', marginTop: '0.5rem', display: 'inline-block' }}>🎉 Complete!</span>}
                  </Link>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
