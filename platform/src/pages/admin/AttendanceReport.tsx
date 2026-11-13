import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { normalizeRoles } from '../../lib/roles'
import type { AttendanceCheckpoint } from '../../types'
import { todayStr } from '../../components/manager/schedulerShared'
import { computeAttendanceMonth, formatMonth, shiftMonth, type AttendanceDay, type AttendanceMonth } from '../../lib/attendanceReport'

async function loadMonth(month: string): Promise<AttendanceMonth> {
  const [usersSnap, attendanceSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(query(collection(db, 'attendance'), where('date', '>=', `${month}-01`), where('date', '<=', `${month}-31`))),
  ])
  const students: { id: string; name: string }[] = []
  usersSnap.forEach((d) => {
    const x = d.data()
    if (x.status !== 'disabled' && normalizeRoles(x).includes('student')) students.push({ id: d.id, name: (x.name as string) ?? '' })
  })
  const days: AttendanceDay[] = []
  attendanceSnap.forEach((d) => {
    const x = d.data()
    const checkpoints = (x.checkpoints as AttendanceCheckpoint[]) ?? []
    if (checkpoints.length === 0) return
    days.push({
      studentId: (x.studentId as string) ?? '',
      date: (x.date as string) ?? '',
      late: checkpoints.some((c) => c.kind === 'login' && c.status === 'late'),
    })
  })
  return computeAttendanceMonth(students, days)
}

/** Month-by-month attendance per student. Shown inside Reports (admin/mentor)
 *  and as its own popup on the Manager Dashboard. */
export function AttendanceReport() {
  const thisMonth = todayStr().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const [loaded, setLoaded] = useState<{ month: string; data: AttendanceMonth } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    loadMonth(month)
      .then((data) => { if (!cancelled) { setLoaded({ month, data }); setError('') } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed') })
    return () => { cancelled = true }
  }, [month])

  const data = loaded?.month === month ? loaded.data : null

  return (
    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <h2 style={{ margin: 0 }}>Attendance</h2>
        <div className="diary-week-nav">
          <button type="button" className="btn small ghost" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
          <span className="muted small diary-week-label">{formatMonth(month)}</span>
          <button type="button" className="btn small ghost" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth} aria-label="Next month">›</button>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {!data && !error ? <p className="muted">Loading…</p> : null}
      {data && (
        <div className="table-wrap"><table className="table"><thead><tr>
          <th>Student</th><th>Present</th><th>Late</th><th>Absent</th><th>Rate</th>
        </tr></thead><tbody>
          {data.rows.map((r) => (
            <tr key={r.studentId}>
              <td>{r.name}</td>
              <td>{r.present}/{data.schoolDays}</td>
              <td>{r.late}</td>
              <td>{r.absent}</td>
              <td>{r.rate == null ? '—' : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ width: 80, height: 6, background: '#e7e9ff', borderRadius: 3, overflow: 'hidden' }}><div style={{ height: '100%', width: `${r.rate}%`, background: r.rate >= 75 ? '#10b981' : '#d97706', borderRadius: 3 }} /></div>
                  <span className="small">{r.rate}%</span>
                </div>
              )}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
    </section>
  )
}
