import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { todayStr, weekKeyOf, normalizeTimetable, normalizeElectives, timeStrToMinutes } from '../components/manager/schedulerShared'
import { determineNextCheckpoint, todaysPeriods, todayWeekday, checkpointLabel } from '../lib/attendance'
import type { AttendanceCheckpoint, ElectiveSession, TimetablePeriod } from '../types'

type ScanOutcome =
  | { kind: 'recorded'; checkpoint: AttendanceCheckpoint }
  | { kind: 'done' } // nothing left to record today (already logged out)
  | { kind: 'no-school' } // Sunday, or no periods configured today

type ScheduleRow =
  | { kind: 'period'; startMin: number; endMin: number; period: TimetablePeriod }
  | { kind: 'elective'; startMin: number; endMin: number; session: ElectiveSession }

function formatHourMinute(hhmm: string): string {
  const mins = timeStrToMinutes(hhmm)
  if (mins == null) return hhmm
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${display} ${period}` : `${display}:${String(m).padStart(2, '0')} ${period}`
}

/**
 * What a scanned ID-card QR code opens — route is `/scan/:studentId/:qrToken`,
 * a top-level route outside `<AppShell>` (see App.tsx) since it needs to work
 * the instant someone scans a card, not after fighting through role-gated
 * nav. Still requires being signed in (as the student, or a staff member
 * holding a kiosk) — see Firestore rules' `attendance` match for why that's
 * enough security without a separate backend.
 *
 * Beyond marking the login/period/logout checkpoint (which the Live Class
 * kiosk picks up live via its own `onSnapshot`, same `attendance` doc), this
 * also shows the student's own details and today's schedule right here, so
 * the card itself is useful without anyone having to go find a timetable.
 */
export default function ScanPage() {
  const { studentId, qrToken } = useParams<{ studentId: string; qrToken: string }>()
  const { firebaseUser, loading: authLoading } = useAuth()

  const [studentName, setStudentName] = useState('')
  const [studentEmail, setStudentEmail] = useState('')
  const [courseTitles, setCourseTitles] = useState<string[]>([])
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([])
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
        const weekKey = weekKeyOf(date)
        const [
          studentSnap, weekTimetableSnap, weekElectivesSnap, masterTimetableSnap, masterElectivesSnap,
          overrideTimetableSnap, overrideElectivesSnap, attendanceSnap,
        ] = await Promise.all([
          getDoc(doc(db, 'users', studentId)),
          getDoc(doc(db, 'class_timetable', weekKey)),
          getDoc(doc(db, 'elective_sessions', weekKey)),
          getDoc(doc(db, 'class_timetable', 'master')),
          getDoc(doc(db, 'elective_sessions', 'master')),
          getDoc(doc(db, 'student_timetables', studentId)),
          getDoc(doc(db, 'student_electives', studentId)),
          getDoc(doc(db, 'attendance', `${studentId}_${date}`)),
        ])
        if (cancelled) return

        if (!studentSnap.exists()) { setError('No such student — check the QR code.'); return }
        const studentData = studentSnap.data()
        setStudentName((studentData.name as string) || 'Student')
        setStudentEmail((studentData.email as string) || '')

        const courseIds = Array.isArray(studentData.courseIds)
          ? (studentData.courseIds as unknown[]).filter((c): c is string => typeof c === 'string' && c.length > 0)
          : []
        if (courseIds.length > 0) {
          const courseSnaps = await Promise.all(courseIds.map((id) => getDoc(doc(db, 'courses', id))))
          if (!cancelled) {
            setCourseTitles(courseSnaps.filter((s) => s.exists()).map((s) => (s.data().title as string) || 'Untitled course'))
          }
        }

        const weekday = todayWeekday()
        if (!weekday) { setOutcome({ kind: 'no-school' }); return }

        // A staff/self-saved override (same docs the Schedule page and the
        // student's own Timetable view read) wins over this week's shared
        // schedule, which itself falls back to the legacy `master` doc for any
        // week nobody's explicitly saved from the Schedule page yet.
        const timetable = normalizeTimetable(
          (overrideTimetableSnap.exists() ? overrideTimetableSnap.data() : undefined)
          ?? (weekTimetableSnap.exists() ? weekTimetableSnap.data() : undefined)
          ?? (masterTimetableSnap.exists() ? masterTimetableSnap.data() : undefined),
        )
        const electives = normalizeElectives(
          (overrideElectivesSnap.exists() ? overrideElectivesSnap.data() : undefined)
          ?? (weekElectivesSnap.exists() ? weekElectivesSnap.data() : undefined)
          ?? (masterElectivesSnap.exists() ? masterElectivesSnap.data() : undefined),
        )
        const periods = todaysPeriods(timetable, weekday)
        const sessions = electives.days[weekday]?.sessions ?? []

        if (!cancelled) {
          const rows: ScheduleRow[] = [
            ...periods.map((period) => ({
              kind: 'period' as const, period,
              startMin: timeStrToMinutes(period.startTime) ?? 0,
              endMin: (timeStrToMinutes(period.startTime) ?? 0) + period.durationMinutes,
            })),
            ...sessions.map((session) => ({
              kind: 'elective' as const, session,
              startMin: timeStrToMinutes(session.startTime) ?? 0,
              endMin: (timeStrToMinutes(session.startTime) ?? 0) + session.durationMinutes,
            })),
          ].sort((a, b) => a.startMin - b.startMin)
          setScheduleRows(rows)
        }

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

        // Writing through the student's own account (the card holder, having signed
        // in) marks login/logout on the shared `attendance` doc the Live Class kiosk
        // already subscribes to live — no separate step needed on the laptop's end.
        await setDoc(
          doc(db, 'attendance', `${studentId}_${date}`),
          { studentId, date, qrToken, checkpoints: [...existing, checkpoint] },
          { merge: true },
        )
        if (!cancelled) setOutcome({ kind: 'recorded', checkpoint })
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

  const details = (studentEmail || courseTitles.length > 0) && (
    <p className="muted small" style={{ margin: '0 0 1rem' }}>
      {[studentEmail, courseTitles.join(', ')].filter(Boolean).join(' · ')}
    </p>
  )

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const schedule = scheduleRows.length > 0 && (
    <div style={{ marginTop: '1.25rem', textAlign: 'left' }}>
      <strong style={{ fontSize: '0.82rem', display: 'block', marginBottom: '0.5rem' }}>📅 Today's Schedule</strong>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {scheduleRows.map((row) => {
          const isNow = nowMin >= row.startMin && nowMin < row.endMin
          const isPeriod = row.kind === 'period'
          const title = isPeriod ? row.period.title : (row.session.title || '🔓 Open slot')
          const meta = isPeriod ? 'School period' : row.session.mentorName ? `Elective · ${row.session.mentorName}` : 'Elective'
          return (
            <div
              key={isPeriod ? row.period.id : row.session.id}
              className="tag"
              style={{
                display: 'flex', justifyContent: 'space-between', gap: '0.5rem', textAlign: 'left',
                background: isNow ? 'var(--primary)' : isPeriod ? '#c3fae8' : '#d0ebff',
                color: isNow ? '#fff' : isPeriod ? '#087f5b' : '#1971c2',
                border: 'none', padding: '0.4rem 0.6rem',
              }}
            >
              <span>
                <strong>{formatHourMinute(isPeriod ? row.period.startTime : row.session.startTime)}</strong>
                {' · '}{title}
              </span>
              <span style={{ opacity: 0.85, fontSize: '0.72rem' }}>{meta}{isNow ? ' · now' : ''}</span>
            </div>
          )
        })}
      </div>
    </div>
  )

  if (outcome?.kind === 'no-school') {
    return (
      <ScanShell>
        <span style={{ fontSize: '3rem' }}>📅</span>
        <h2 style={{ margin: '0.5rem 0 0.25rem' }}>No school today</h2>
        <p className="muted" style={{ marginBottom: details ? '0.25rem' : '1rem' }}>{studentName} — nothing scheduled, nothing to check in to.</p>
        {details}
      </ScanShell>
    )
  }

  if (outcome?.kind === 'done') {
    return (
      <ScanShell>
        <span style={{ fontSize: '3rem' }}>✅</span>
        <h2 style={{ margin: '0.5rem 0 0.25rem' }}>All done for today</h2>
        <p className="muted" style={{ marginBottom: details ? '0.25rem' : '1rem' }}>{studentName} already logged out — see you tomorrow!</p>
        {details}
        {schedule}
      </ScanShell>
    )
  }

  if (outcome?.kind === 'recorded') {
    const { checkpoint } = outcome
    const late = checkpoint.status === 'late'
    const icon = checkpoint.kind === 'login' ? '👋' : checkpoint.kind === 'logout' ? '🏁' : '📍'
    const time = new Date(checkpoint.scannedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const periodsOnly = scheduleRows.filter((r) => r.kind === 'period').map((r) => r.period)
    return (
      <ScanShell>
        <span style={{ fontSize: '3rem' }}>{icon}</span>
        <h2 style={{ margin: '0.5rem 0 0.1rem' }}>{checkpointLabel(checkpoint, periodsOnly)}</h2>
        <p style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', fontWeight: 600 }}>{studentName}</p>
        {details}
        <p className="muted" style={{ margin: '0 0 0.75rem' }}>{time}</p>
        {checkpoint.kind !== 'logout' && (
          <span className={`tag ${late ? 'danger' : ''}`} style={{ fontSize: '0.85rem' }}>
            {late ? '⚠ Late' : '✓ On time'}
          </span>
        )}
        {schedule}
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
      <div className="panel" style={{ maxWidth: 420, width: '100%', textAlign: 'center', padding: '2rem 1.5rem' }}>
        {children}
      </div>
    </div>
  )
}
