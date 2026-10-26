import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { todayStr, normalizeTimetable } from '../components/manager/schedulerShared'
import { determineNextCheckpoint, todaysPeriods, todayWeekday, checkpointLabel } from '../lib/attendance'
import type { AttendanceCheckpoint, TimetablePeriod } from '../types'

type ScanOutcome =
  | { kind: 'recorded'; checkpoint: AttendanceCheckpoint; periods: TimetablePeriod[] }
  | { kind: 'done' } // nothing left to record today (already logged out)
  | { kind: 'no-school' } // Sunday, or no periods configured today

/**
 * What a scanned ID-card QR code opens — route is `/scan/:studentId/:qrToken`,
 * a top-level route outside `<AppShell>` (see App.tsx) since it needs to work
 * the instant someone scans a card, not after fighting through role-gated
 * nav. Still requires being signed in (as the student, or a staff member
 * holding a kiosk) — see Firestore rules' `attendance` match for why that's
 * enough security without a separate backend.
 */
export default function ScanPage() {
  const { studentId, qrToken } = useParams<{ studentId: string; qrToken: string }>()
  const { firebaseUser, loading: authLoading } = useAuth()

  const [studentName, setStudentName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)

  useEffect(() => {
    if (authLoading || !firebaseUser || !studentId || !qrToken) return
    let cancelled = false
    void (async () => {
      setLoading(true); setError('')
      try {
        const date = todayStr()
        const [studentSnap, timetableSnap, attendanceSnap] = await Promise.all([
          getDoc(doc(db, 'users', studentId)),
          getDoc(doc(db, 'class_timetable', 'master')),
          getDoc(doc(db, 'attendance', `${studentId}_${date}`)),
        ])
        if (cancelled) return

        if (!studentSnap.exists()) { setError('No such student — check the QR code.'); return }
        const studentData = studentSnap.data()
        setStudentName((studentData.name as string) || 'Student')

        const weekday = todayWeekday()
        if (!weekday) { setOutcome({ kind: 'no-school' }); return }

        const timetable = normalizeTimetable(timetableSnap.exists() ? timetableSnap.data() : undefined)
        const periods = todaysPeriods(timetable, weekday)
        if (periods.length === 0) { setOutcome({ kind: 'no-school' }); return }

        const existing: AttendanceCheckpoint[] = attendanceSnap.exists()
          ? ((attendanceSnap.data().checkpoints as AttendanceCheckpoint[] | undefined) ?? [])
          : []

        const next = determineNextCheckpoint(periods, existing, new Date())
        if (!next) { setOutcome({ kind: 'done' }); return }

        const checkpoint: AttendanceCheckpoint = {
          kind: next.kind,
          ...(next.kind === 'period' ? { periodId: next.periodId } : {}),
          status: next.status,
          scannedAt: new Date().toISOString(),
        }

        await setDoc(
          doc(db, 'attendance', `${studentId}_${date}`),
          { studentId, date, qrToken, checkpoints: [...existing, checkpoint] },
          { merge: true },
        )
        if (!cancelled) setOutcome({ kind: 'recorded', checkpoint, periods })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Scan failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // Re-run if a different card is scanned in the same browser session.
  }, [authLoading, firebaseUser, studentId, qrToken])

  if (!studentId || !qrToken) {
    return <ScanShell><p className="error">Invalid QR code.</p></ScanShell>
  }

  if (authLoading) {
    return <ScanShell><p className="muted">Loading…</p></ScanShell>
  }

  if (!firebaseUser) {
    return (
      <ScanShell>
        <p style={{ fontSize: '1.05rem', marginBottom: '1rem' }}>Please sign in, then scan this code again.</p>
        <Link to="/login" className="btn primary">Sign In</Link>
      </ScanShell>
    )
  }

  if (loading) {
    return <ScanShell><p className="muted">Checking in…</p></ScanShell>
  }

  if (error) {
    return <ScanShell><p className="error">{error}</p></ScanShell>
  }

  if (outcome?.kind === 'no-school') {
    return (
      <ScanShell>
        <span style={{ fontSize: '3rem' }}>📅</span>
        <h2 style={{ margin: '0.5rem 0 0.25rem' }}>No school today</h2>
        <p className="muted">{studentName} — nothing scheduled, nothing to check in to.</p>
      </ScanShell>
    )
  }

  if (outcome?.kind === 'done') {
    return (
      <ScanShell>
        <span style={{ fontSize: '3rem' }}>✅</span>
        <h2 style={{ margin: '0.5rem 0 0.25rem' }}>All done for today</h2>
        <p className="muted">{studentName} already logged out — see you tomorrow!</p>
      </ScanShell>
    )
  }

  if (outcome?.kind === 'recorded') {
    const { checkpoint, periods } = outcome
    const late = checkpoint.status === 'late'
    const icon = checkpoint.kind === 'login' ? '👋' : checkpoint.kind === 'logout' ? '🏁' : '📍'
    const time = new Date(checkpoint.scannedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return (
      <ScanShell>
        <span style={{ fontSize: '3rem' }}>{icon}</span>
        <h2 style={{ margin: '0.5rem 0 0.1rem' }}>{checkpointLabel(checkpoint, periods)}</h2>
        <p style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 600 }}>{studentName}</p>
        <p className="muted" style={{ margin: '0 0 0.75rem' }}>{time}</p>
        {checkpoint.kind !== 'logout' && (
          <span className={`tag ${late ? 'danger' : ''}`} style={{ fontSize: '0.85rem' }}>
            {late ? '⚠ Late' : '✓ On time'}
          </span>
        )}
      </ScanShell>
    )
  }

  return <ScanShell><p className="muted">Loading…</p></ScanShell>
}

/** Full-screen, mobile-first — this opens straight from a camera scan, never
 *  through app nav, so it stands alone rather than reusing `<AppShell>`. */
function ScanShell({ children }: { children: ReactNode }) {
  return (
    <div className="kid-theme" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
      <div className="panel" style={{ maxWidth: 360, width: '100%', textAlign: 'center', padding: '2rem 1.5rem' }}>
        {children}
      </div>
    </div>
  )
}
