import { useCallback, useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { mapCourseDoc } from '../../lib/courses'
import type { ProgressEntry } from '../../types'

interface HistoryRecord { id: string; courseId: string; courseName: string; completedAt: string; totalItems: number }

export function StudentHistory() {
  const { firebaseUser, profile } = useAuth()
  const uid = firebaseUser?.uid
  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!uid) return
    try {
      const snap = await getDocs(query(collection(db, 'course_history'), where('studentId', '==', uid)))
      const list: HistoryRecord[] = []
      snap.forEach((d) => {
        const x = d.data()
        list.push({ id: d.id, courseId: x.courseId as string, courseName: (x.courseName as string) ?? '', completedAt: x.completedAt?.toDate?.()?.toISOString?.() ?? '', totalItems: Number(x.totalItems ?? 0) })
      })

      // Courses finished before completion records were being saved have no
      // course_history doc — work those out from the progress itself.
      const recorded = new Set(list.map((r) => r.courseId))
      const [coursesSnap, sessionsSnap, progSnap] = await Promise.all([
        getDocs(collection(db, 'courses')),
        getDocs(collection(db, 'sessions')),
        getDocs(query(collection(db, 'student_lesson_progress'), where('studentId', '==', uid))),
      ])
      const approvedAt = new Map<string, string>() // `${sessionId}_${activityId}` → ISO (or '')
      progSnap.forEach((d) => {
        const x = d.data()
        const sid = (x.sessionId as string) ?? (x.lessonId as string)
        for (const e of (x.entries as ProgressEntry[]) ?? []) {
          if (e.status === 'completed') approvedAt.set(`${sid}_${e.activityId}`, e.mentorApprovedAt ?? '')
        }
      })
      const byCourse = new Map<string, { total: number; done: number; last: string }>()
      sessionsSnap.forEach((d) => {
        const x = d.data()
        const cid = (x.courseId as string) ?? ''
        const c = byCourse.get(cid) ?? { total: 0, done: 0, last: '' }
        for (const a of (x.activities as { id: string }[]) ?? []) {
          c.total++
          const at = approvedAt.get(`${d.id}_${a.id}`)
          if (at !== undefined) { c.done++; if (at > c.last) c.last = at }
        }
        byCourse.set(cid, c)
      })
      const courseIds = profile?.courseIds ?? []
      coursesSnap.forEach((d) => {
        const c = byCourse.get(d.id)
        if (recorded.has(d.id) || !c || c.total === 0 || c.done < c.total) return
        if (courseIds.length > 0 && !courseIds.includes(d.id)) return
        list.push({ id: `derived_${d.id}`, courseId: d.id, courseName: mapCourseDoc(d).title, completedAt: c.last, totalItems: c.total })
      })

      list.sort((a, b) => b.completedAt.localeCompare(a.completedAt))
      setRecords(list)
    } catch (e) {
      console.error('StudentHistory load failed', e)
    } finally { setLoading(false) }
  }, [uid, profile])

  useEffect(() => { if (uid && profile) void load() }, [uid, profile, load])

  return (
    <div>
      <h1>🏆 Completed Courses</h1>
      {loading ? <p className="muted">Loading…</p> : null}
      {records.length === 0 && !loading ? (
        <div className="panel" style={{ textAlign: 'center', padding: '3rem' }}><p style={{ fontSize: '3rem', margin: 0 }}>📚</p><h3 style={{ margin: 0 }}>No courses completed yet</h3></div>
      ) : (
        <div className="course-grid">
          {records.map((r) => (
            <div key={r.id} className="course-card" style={{ background: '#f8fdf9', borderColor: '#bbf7d0' }}>
              <span style={{ fontSize: '2rem' }}>🎓</span>
              <h3 style={{ margin: '0.25rem 0' }}>{r.courseName}</h3>
              <p className="muted small">{r.totalItems} topic{r.totalItems === 1 ? '' : 's'} completed</p>
              {r.completedAt ? <p className="muted small">Completed: {new Date(r.completedAt).toLocaleDateString()}</p> : null}
              <span className="tag" style={{ background: '#dcfce7', color: '#166534', border: 'none', marginTop: '0.5rem' }}>✓ Certificate Earned</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
