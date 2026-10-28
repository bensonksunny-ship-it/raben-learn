import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { signInWithCustomToken } from 'firebase/auth'
import { collection, deleteDoc, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where, type Timestamp } from 'firebase/firestore'
import { kioskAuth, kioskDb, resolveLiveClassKioskToken } from '../lib/liveClassKiosk'
import { mapUserDoc } from '../lib/userUtils'
import { todayStr, weekKeyOf, loadEffectiveWeekSchedule, timeStrToMinutes } from '../components/manager/schedulerShared'
import { GRACE_MINUTES, todaysPeriods, todayWeekday } from '../lib/attendance'
import type { AttendanceCheckpoint, ClassTimetable, ElectiveSchedule, TimetablePeriod, UserProfile } from '../types'

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

/** "9:05 AM" from minutes-since-midnight. */
function formatClock(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** "45 min" / "1 h 5 min" — for countdowns and how-late labels. */
function formatSpan(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} min`
  return m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/** Re-renders every second so the clock, countdowns and "now" period track the
 *  wall clock — the timetable runs on clock time, not on when class started. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/** One block on today's running timetable — a locked school period (`label`
 *  "P1", "P2"… matching the roster's attendance columns) or an elective session
 *  (`label` "Elective"), both placed purely by their scheduled clock time. */
interface TimedPeriod { id: string; title: string; label: string; kind: 'period' | 'elective'; startTime: string; startMin: number; endMin: number }

/** Where the wall clock sits within today's timetable. */
type ClockState =
  | { kind: 'none' }
  | { kind: 'before'; next: TimedPeriod }
  | { kind: 'in'; current: TimedPeriod; index: number; next: TimedPeriod | null }
  | { kind: 'break'; next: TimedPeriod }
  | { kind: 'over' }

function clockState(timed: TimedPeriod[], nowMin: number): ClockState {
  if (timed.length === 0) return { kind: 'none' }
  if (nowMin < timed[0]!.startMin) return { kind: 'before', next: timed[0]! }
  const index = timed.findIndex((t) => nowMin >= t.startMin && nowMin < t.endMin)
  if (index >= 0) return { kind: 'in', current: timed[index]!, index, next: timed[index + 1] ?? null }
  const next = timed.find((t) => t.startMin > nowMin)
  return next ? { kind: 'break', next } : { kind: 'over' }
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
  const [electives, setElectives] = useState<ElectiveSchedule | null>(null)
  const [checkpointsByStudent, setCheckpointsByStudent] = useState<Record<string, AttendanceCheckpoint[]>>({})
  /** `class_runs/{date}.startedAt` — undefined while loading, null if not started yet. */
  const [startedAt, setStartedAt] = useState<Date | null | undefined>(undefined)
  const [startBusy, setStartBusy] = useState(false)
  const [startError, setStartError] = useState('')

  const now = useNow()
  // Recomputed from the ticking clock so a TV left on overnight rolls into the new day.
  const date = todayStr()
  const weekday = todayWeekday(now)
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60

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
        const [usersSnap, effective] = await Promise.all([
          getDocs(collection(kioskDb, 'users')),
          loadEffectiveWeekSchedule(kioskDb, weekKeyOf(todayStr())),
        ])
        const list: UserProfile[] = []
        usersSnap.forEach((d) => {
          const p = mapUserDoc(d)
          if (p.roles.includes('student')) list.push(p)
        })
        list.sort((a, b) => a.name.localeCompare(b.name))
        setStudents(list)
        setTimetable(effective.timetable)
        setElectives(effective.electives)
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

  useEffect(() => {
    if (phase !== 'ready') return
    setStartedAt(undefined)
    return onSnapshot(
      doc(kioskDb, 'class_runs', date),
      (snap) => {
        const ts = snap.exists() ? (snap.data().startedAt as Timestamp | null | undefined) : null
        // A just-written serverTimestamp() reads back null locally until the server confirms it.
        setStartedAt(ts ? ts.toDate() : snap.exists() ? new Date() : null)
      },
      (e) => setStartError(`[reading class start] ${e.message}`),
    )
  }, [phase, date])

  const periods: TimetablePeriod[] = useMemo(
    () => (timetable && weekday ? todaysPeriods(timetable, weekday) : []),
    [timetable, weekday],
  )
  // Locked periods + the master elective board, merged and run by clock time —
  // a day with only electives (no locked periods) still has a timetable to run.
  const timed: TimedPeriod[] = useMemo(() => {
    const out: TimedPeriod[] = []
    periods.forEach((p, i) => {
      const startMin = timeStrToMinutes(p.startTime)
      if (startMin != null) out.push({ id: p.id, title: p.title, label: `P${i + 1}`, kind: 'period', startTime: p.startTime, startMin, endMin: startMin + p.durationMinutes })
    })
    for (const e of (weekday && electives?.days[weekday]?.sessions) || []) {
      const startMin = timeStrToMinutes(e.startTime)
      if (startMin == null || !(e.durationMinutes > 0)) continue
      out.push({ id: e.id, title: e.title || 'Open slot', label: 'Elective', kind: 'elective', startTime: e.startTime, startMin, endMin: startMin + e.durationMinutes })
    }
    return out.sort((a, b) => a.startMin - b.startMin)
  }, [periods, electives, weekday])
  const scheduledStartMin = timed[0]?.startMin ?? null
  const state = clockState(timed, nowMin)
  const currentPeriodId = state.kind === 'in' && state.current.kind === 'period' ? state.current.id : null

  async function startClass() {
    if (scheduledStartMin == null) return
    setStartBusy(true)
    setStartError('')
    try {
      await setDoc(doc(kioskDb, 'class_runs', date), {
        date,
        scheduledStart: timed[0]!.startTime,
        startedAt: serverTimestamp(),
      })
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Could not mark class as started')
    } finally {
      setStartBusy(false)
    }
  }

  async function undoStart() {
    if (!window.confirm('Undo "class started"? Use this only if it was pressed by mistake.')) return
    setStartBusy(true)
    setStartError('')
    try {
      await deleteDoc(doc(kioskDb, 'class_runs', date))
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Could not undo')
    } finally {
      setStartBusy(false)
    }
  }

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
            {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}
            {weekday ? `${timed.length} session${timed.length === 1 ? '' : 's'} today` : 'No school today.'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span className="page-stat" style={{ fontSize: '1.1rem' }}>{inCount} / {students.length} on campus now</span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '2.4rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
        <ClassStartPanel
          scheduledStartMin={scheduledStartMin}
          startedAt={startedAt}
          nowMin={nowMin}
          busy={startBusy}
          error={startError}
          onStart={() => void startClass()}
          onUndo={() => void undoStart()}
        />
        <NowPanel state={state} nowMin={nowMin} />
      </div>

      {timed.length > 0 && <TimetableStrip timed={timed} nowMin={nowMin} />}

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
                  <th key={p.id} style={{ textAlign: 'center', fontSize: '0.85rem', background: p.id === currentPeriodId ? 'var(--primary-soft)' : undefined }} title={p.title}>
                    P{i + 1}
                    <div className="muted" style={{ fontWeight: 500, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{p.title}</div>
                  </th>
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
                      <td key={p.id} style={{ textAlign: 'center', background: p.id === currentPeriodId ? 'var(--primary-soft)' : undefined }}>
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

interface ClassStartPanelProps {
  scheduledStartMin: number | null
  startedAt: Date | null | undefined
  nowMin: number
  busy: boolean
  error: string
  onStart: () => void
  onUndo: () => void
}

/** The morning "Class started" button, then — once pressed — whether that was
 *  on time against the first period's scheduled start (same grace window as a
 *  student's own login scan). Starting late never shifts the timetable. */
function ClassStartPanel({ scheduledStartMin, startedAt, nowMin, busy, error, onStart, onUndo }: ClassStartPanelProps) {
  let body: ReactNode
  if (scheduledStartMin == null) {
    body = <p className="muted" style={{ margin: 0, fontSize: '1.1rem' }}>No classes scheduled today.</p>
  } else if (startedAt === undefined) {
    body = <p className="muted" style={{ margin: 0 }}>Loading…</p>
  } else if (startedAt === null) {
    const diff = nowMin - scheduledStartMin
    body = (
      <>
        <p style={{ margin: '0 0 0.25rem', fontSize: '1.1rem' }}>
          Scheduled start <strong>{formatClock(scheduledStartMin)}</strong>
        </p>
        <p style={{ margin: '0 0 1rem', fontWeight: 600, color: diff > GRACE_MINUTES ? 'var(--danger)' : 'var(--muted)' }}>
          {diff < 0 ? `Starts in ${formatSpan(-diff)}` : diff <= GRACE_MINUTES ? 'Starting now' : `Not started yet — ${formatSpan(diff)} late`}
        </p>
        <button type="button" className="btn primary" style={{ fontSize: '1.25rem', padding: '0.8rem 1.6rem' }} disabled={busy} onClick={onStart}>
          {busy ? 'Starting…' : '▶ Class started'}
        </button>
      </>
    )
  } else {
    const startedMin = startedAt.getHours() * 60 + startedAt.getMinutes()
    const lateBy = startedMin - scheduledStartMin
    const late = lateBy > GRACE_MINUTES
    body = (
      <>
        <p style={{ margin: '0 0 0.5rem', fontSize: '1.6rem', fontWeight: 700, color: late ? 'var(--danger)' : 'var(--green)' }}>
          {late ? `⚠ Started ${formatSpan(lateBy)} late` : '✓ Started on time'}
        </p>
        <p className="muted" style={{ margin: 0, fontSize: '1.05rem' }}>
          Started at <strong style={{ color: 'var(--text)' }}>{startedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</strong>
          {' · scheduled '}{formatClock(scheduledStartMin)}
          {!late && lateBy > 0 ? ` (${lateBy} min, within the ${GRACE_MINUTES}-min grace)` : ''}
        </p>
        <button type="button" className="btn small ghost" style={{ marginTop: '0.75rem' }} disabled={busy} onClick={onUndo}>Undo</button>
      </>
    )
  }
  return (
    <div className="panel" style={{ padding: '1.25rem 1.5rem' }}>
      <div className="muted small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem' }}>Class start</div>
      {body}
      {error ? <p className="error small" style={{ margin: '0.6rem 0 0' }}>{error}</p> : null}
    </div>
  )
}

/** What's happening right now by the clock — the current period with a
 *  countdown and progress bar, a break, or what's next. */
function NowPanel({ state, nowMin }: { state: ClockState; nowMin: number }) {
  let body: ReactNode
  switch (state.kind) {
    case 'none':
      body = <p className="muted" style={{ margin: 0, fontSize: '1.1rem' }}>Nothing on the timetable today.</p>
      break
    case 'over':
      body = <p style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>🏁 Classes are over for today</p>
      break
    case 'before':
    case 'break':
      body = (
        <>
          <p style={{ margin: '0 0 0.35rem', fontSize: '1.4rem', fontWeight: 700 }}>{state.kind === 'before' ? '🌅 Before class' : '☕ Break'}</p>
          <p style={{ margin: 0, fontSize: '1.1rem' }}>
            Next: <strong>{state.next.title}</strong> at {formatClock(state.next.startMin)}
            <span className="muted"> · in {formatSpan(state.next.startMin - nowMin)}</span>
          </p>
        </>
      )
      break
    case 'in': {
      const { current, next } = state
      const pct = Math.min(100, Math.max(0, ((nowMin - current.startMin) / (current.endMin - current.startMin)) * 100))
      body = (
        <>
          <p style={{ margin: '0 0 0.2rem', fontSize: '1.6rem', fontWeight: 700 }}>
            <span className="muted" style={{ fontSize: '1rem', fontWeight: 600 }}>{current.label} · </span>{current.title}
          </p>
          <p className="muted" style={{ margin: '0 0 0.6rem', fontSize: '1.05rem' }}>
            {formatClock(current.startMin)} – {formatClock(current.endMin)} · <strong style={{ color: 'var(--text)' }}>ends in {formatSpan(current.endMin - nowMin)}</strong>
          </p>
          <div style={{ height: 10, borderRadius: 99, background: 'var(--surface-soft)', border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)', transition: 'width 1s linear' }} />
          </div>
          {next && (
            <p className="muted" style={{ margin: '0.6rem 0 0' }}>
              Next: <strong style={{ color: 'var(--text)' }}>{next.title}</strong> at {formatClock(next.startMin)}
            </p>
          )}
        </>
      )
      break
    }
  }
  return (
    <div className="panel" style={{ padding: '1.25rem 1.5rem' }}>
      <div className="muted small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem' }}>Now</div>
      {body}
    </div>
  )
}

/** Today's periods left-to-right at their scheduled clock times — done ones
 *  faded, the current one highlighted. */
function TimetableStrip({ timed, nowMin }: { timed: TimedPeriod[]; nowMin: number }) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem', overflowX: 'auto', marginBottom: '1.5rem', paddingBottom: '0.25rem' }}>
      {timed.map((t) => {
        const done = nowMin >= t.endMin
        const current = nowMin >= t.startMin && nowMin < t.endMin
        return (
          <div
            key={t.id}
            className="panel"
            style={{
              flex: '0 0 auto', minWidth: 150, padding: '0.7rem 0.9rem', margin: 0,
              opacity: done ? 0.5 : 1,
              borderColor: current ? 'var(--primary)' : undefined,
              boxShadow: current ? '0 0 0 2px var(--primary)' : undefined,
              background: current ? 'var(--primary-soft)' : undefined,
            }}
          >
            <div className="muted small" style={{ fontWeight: 700 }}>{t.label}{current ? ' · NOW' : done ? ' · done' : ''}</div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{t.title}</div>
            <div className="muted small">{formatClock(t.startMin)} – {formatClock(t.endMin)}</div>
          </div>
        )
      })}
    </div>
  )
}
