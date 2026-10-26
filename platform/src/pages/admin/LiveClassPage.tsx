import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { mapUserDoc } from '../../lib/userUtils'
import { todayStr, normalizeTimetable } from '../../components/manager/schedulerShared'
import { todaysPeriods, todayWeekday } from '../../lib/attendance'
import type { AttendanceCheckpoint, ClassTimetable, TimetablePeriod, UserProfile } from '../../types'
import { EmptyState } from '../../components/EmptyState'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function Badge({ checkpoint }: { checkpoint: AttendanceCheckpoint | undefined }) {
  if (!checkpoint) return <span className="muted small">—</span>
  const late = checkpoint.status === 'late'
  return (
    <span className={`tag ${late ? 'danger' : ''}`} style={{ fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
      {late ? '⚠' : '✓'} {formatTime(checkpoint.scannedAt)}
    </span>
  )
}

/**
 * Staff kiosk for Live Class — a real-time roster of today's attendance,
 * driven straight off student scans of their ID-card QR codes (see
 * `/scan/:studentId/:qrToken` → ScanPage). Nothing here is editable from this
 * page in v1; it's a live read of what students have already scanned, via
 * `onSnapshot` so a scan on someone's phone shows up here within a second or
 * two without a refresh.
 */
export function LiveClassPage() {
  const [students, setStudents] = useState<UserProfile[]>([])
  const [timetable, setTimetable] = useState<ClassTimetable | null>(null)
  const [checkpointsByStudent, setCheckpointsByStudent] = useState<Record<string, AttendanceCheckpoint[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const date = todayStr()
  const weekday = todayWeekday()

  useEffect(() => {
    void (async () => {
      try {
        let usersSnap
        try {
          usersSnap = await getDocs(collection(db, 'users'))
        } catch (e) {
          throw new Error(`[reading students] ${e instanceof Error ? e.message : String(e)}`)
        }

        let timetableSnap
        try {
          timetableSnap = await getDoc(doc(db, 'class_timetable', 'master'))
        } catch (e) {
          throw new Error(`[reading the class timetable] ${e instanceof Error ? e.message : String(e)}`)
        }

        const list: UserProfile[] = []
        usersSnap.forEach((d) => {
          const p = mapUserDoc(d)
          if (p.roles.includes('student')) list.push(p)
        })
        list.sort((a, b) => a.name.localeCompare(b.name))
        setStudents(list)
        setTimetable(normalizeTimetable(timetableSnap.exists() ? timetableSnap.data() : undefined))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load students')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'attendance'), where('date', '==', date))
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const next: Record<string, AttendanceCheckpoint[]> = {}
        snap.forEach((d) => {
          const x = d.data()
          const sid = x.studentId as string | undefined
          if (sid) next[sid] = (x.checkpoints as AttendanceCheckpoint[] | undefined) ?? []
        })
        setCheckpointsByStudent(next)
      },
      (e) => setError(`[reading attendance] ${e.message}`),
    )
    return unsubscribe
  }, [date])

  const periods: TimetablePeriod[] = useMemo(
    () => (timetable && weekday ? todaysPeriods(timetable, weekday) : []),
    [timetable, weekday],
  )

  const inCount = students.filter((s) => {
    const cps = checkpointsByStudent[s.id] ?? []
    return cps.some((c) => c.kind === 'login') && !cps.some((c) => c.kind === 'logout')
  }).length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.2rem' }}>🟢 Live Class</h1>
          <p className="muted" style={{ margin: 0 }}>
            {weekday ? `${periods.length} period${periods.length === 1 ? '' : 's'} today — updates live as students scan in.` : 'No school today.'}
          </p>
        </div>
        {!loading && <span className="page-stat">{inCount} / {students.length} on campus now</span>}
      </div>

      {error ? <p className="error" style={{ marginBottom: '1rem' }}>{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && students.length === 0 && (
        <EmptyState title="No students yet" subtitle="Add students from the Students page." />
      )}

      {!loading && students.length > 0 && (
        <div className="panel" style={{ overflowX: 'auto', padding: 0 }}>
          <table className="session-topics-table readonly" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Student</th>
                <th style={{ textAlign: 'center' }}>Login</th>
                {periods.map((p, i) => <th key={p.id} style={{ textAlign: 'center' }} title={p.title}>P{i + 1}</th>)}
                <th style={{ textAlign: 'center' }}>Logout</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const checkpoints = checkpointsByStudent[s.id] ?? []
                const login = checkpoints.find((c) => c.kind === 'login')
                const logout = checkpoints.find((c) => c.kind === 'logout')
                return (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td style={{ textAlign: 'center' }}><Badge checkpoint={login} /></td>
                    {periods.map((p) => (
                      <td key={p.id} style={{ textAlign: 'center' }}>
                        <Badge checkpoint={checkpoints.find((c) => c.kind === 'period' && c.periodId === p.id)} />
                      </td>
                    ))}
                    <td style={{ textAlign: 'center' }}><Badge checkpoint={logout} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
