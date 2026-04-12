import { useCallback, useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'

interface HistoryRecord { id: string; courseId: string; courseName: string; completedAt: string; totalItems: number }

export function StudentHistory() {
  const { firebaseUser } = useAuth()
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
      list.sort((a, b) => b.completedAt.localeCompare(a.completedAt))
      setRecords(list)
    } catch (e) {
      console.error('StudentHistory load failed', e)
    } finally { setLoading(false) }
  }, [uid])

  useEffect(() => { if (uid) void load() }, [uid, load])

  return (
    <div>
      <h1>🏆 Completed Courses</h1>
      {loading ? <p className="muted">Loading…</p> : null}
      {records.length === 0 && !loading ? (
        <div className="panel" style={{ textAlign: 'center', padding: '3rem' }}><p style={{ fontSize: '3rem', margin: 0 }}>📚</p><h3>No courses completed yet</h3><p className="muted">Keep studying — your completed courses will show up here!</p></div>
      ) : (
        <div className="course-grid">
          {records.map((r) => (
            <div key={r.id} className="course-card" style={{ background: '#f8fdf9', borderColor: '#bbf7d0' }}>
              <span style={{ fontSize: '2rem' }}>🎓</span>
              <h3 style={{ margin: '0.25rem 0' }}>{r.courseName}</h3>
              <p className="muted small">{r.totalItems} activities completed</p>
              {r.completedAt ? <p className="muted small">Completed: {new Date(r.completedAt).toLocaleDateString()}</p> : null}
              <span className="tag" style={{ background: '#dcfce7', color: '#166534', border: 'none', marginTop: '0.5rem' }}>✓ Certificate Earned</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
