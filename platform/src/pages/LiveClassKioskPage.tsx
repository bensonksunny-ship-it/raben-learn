import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { signInWithCustomToken } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { kioskAuth, kioskDb, resolveLiveClassKioskToken } from '../lib/liveClassKiosk'
import { mapUserDoc } from '../lib/userUtils'
import { todayStr, normalizeTimetable } from '../components/manager/schedulerShared'
import { todaysPeriods, todayWeekday } from '../lib/attendance'
import type { AttendanceCheckpoint, ClassTimetable, TimetablePeriod, UserProfile } from '../types'

type Phase = 'resolving' | 'ready' | 'error'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function Badge({ checkpoint }: { checkpoint: AttendanceCheckpoint | undefined }) {
  if (!checkpoint) return <span className="muted">—</span>
  const late = checkpoint.status === 'late'
  return (
    <span className={`tag ${late ? 'danger' : ''}`} style={{ fontSize: '0.95rem', whiteSpace: 'nowrap' }}>
      {late ? '⚠' : '✓'} {formatTime(checkpoint.scannedAt)}
    </span>
  )
}

/** Full-screen, no chrome — this is a classroom TV/projector display, not
 *  something anyone navigates around in. */
function KioskShell({ children }: { children: ReactNode }) {
  return (
    <div className="kid-theme" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div className="panel" style={{ maxWidth: 420, width: '100%', textAlign: 'center', padding: '2.5rem 2rem' }}>
        {children}
      </div>
    </div>
  )
}

/**
 * No login, no `<AppShell>`, no role check — opened from its own secret link
 * (generated on the Schedule page), meant for a classroom TV/projector. Signs
 * into the isolated `kioskAuth`/`kioskDb` secondary Firebase app (see
 * `lib/liveClassKiosk.ts`) with a custom token the `resolveLiveClassKiosk`
 * Cloud Function mints only if `:token` matches the currently-live kiosk link
 * — so this never touches (or signs out) a staff member's own session if
 * opened in the same browser, and a stale/replaced link just fails to open.
 * Same live-roster content as the staff Schedule page's own Live Class view,
 * just TV-sized and read-only.
 */
export function LiveClassKioskPage() {
  const { token } = useParams<{ token: string }>()
  const [phase, setPhase] = useState<Phase>('resolving')
  const [error, setError] = useState('')

  const [students, setStudents] = useState<UserProfile[]>([])
  const [timetable, setTimetable] = useState<ClassTimetable | null>(null)
  const [checkpointsByStudent, setCheckpointsByStudent] = useState<Record<string, AttendanceCheckpoint[]>>({})

  const date = todayStr()
  const weekday = todayWeekday()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!token) {
        if (!cancelled) { setError('This link is missing its token.'); setPhase('error') }
        return
      }
      try {
        const customToken = await resolveLiveClassKioskToken(token)
        await signInWithCustomToken(kioskAuth, customToken)
        if (!cancelled) setPhase('ready')
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'This link could not be opened.')
          setPhase('error')
        }
      }
    })()
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (phase !== 'ready') return
    void (async () => {
      try {
        const [usersSnap, timetableSnap] = await Promise.all([
          getDocs(collection(kioskDb, 'users')),
          getDoc(doc(kioskDb, 'class_timetable', 'master')),
        ])
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
        setPhase('error')
      }
    })()
  }, [phase])

  useEffect(() => {
    if (phase !== 'ready') return
    const q = query(collection(kioskDb, 'attendance'), where('date', '==', date))
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
  }, [phase, date])

  const periods: TimetablePeriod[] = useMemo(
    () => (timetable && weekday ? todaysPeriods(timetable, weekday) : []),
    [timetable, weekday],
  )

  if (phase === 'resolving') {
    return <KioskShell><p className="muted" style={{ fontSize: '1.1rem' }}>Opening Live Class…</p></KioskShell>
  }
  if (phase === 'error') {
    return (
      <KioskShell>
        <span style={{ fontSize: '2.5rem' }}>📡</span>
        <h2 style={{ margin: '0.5rem 0 0.25rem' }}>Can't open this link</h2>
        <p className="error" style={{ margin: 0 }}>{error}</p>
      </KioskShell>
    )
  }

  const inCount = students.filter((s) => {
    const cps = checkpointsByStudent[s.id] ?? []
    return cps.some((c) => c.kind === 'login') && !cps.some((c) => c.kind === 'logout')
  }).length

  return (
    <div className="kid-theme" style={{ minHeight: '100dvh', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.2rem', fontSize: '2rem' }}>🟢 Live Class</h1>
          <p className="muted" style={{ margin: 0, fontSize: '1.05rem' }}>
            {weekday ? `${periods.length} period${periods.length === 1 ? '' : 's'} today` : 'No school today.'}
          </p>
        </div>
        <span className="page-stat" style={{ fontSize: '1.1rem' }}>{inCount} / {students.length} on campus now</span>
      </div>

      {students.length === 0 ? (
        <p className="muted" style={{ fontSize: '1.1rem' }}>No students yet.</p>
      ) : (
        <div className="panel" style={{ overflowX: 'auto', padding: 0 }}>
          <table className="session-topics-table readonly" style={{ minWidth: 720, fontSize: '1.05rem' }}>
            <thead>
              <tr>
                <th style={{ fontSize: '0.85rem' }}>Student</th>
                <th style={{ textAlign: 'center', fontSize: '0.85rem' }}>Login</th>
                {periods.map((p, i) => (
                  <th key={p.id} style={{ textAlign: 'center', fontSize: '0.85rem' }} title={p.title}>P{i + 1}</th>
                ))}
                <th style={{ textAlign: 'center', fontSize: '0.85rem' }}>Logout</th>
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
