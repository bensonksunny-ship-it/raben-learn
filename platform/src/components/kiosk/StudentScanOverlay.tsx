import { useEffect, useRef, useState } from 'react'
import { doc, setDoc, type Firestore } from 'firebase/firestore'
import { avatarClass } from '../../lib/userUtils'
import {
  determineNextCheckpoint, checkpointLabel, clockState, formatClock,
  type TimedPeriod,
} from '../../lib/attendance'
import { loadPersonalizedDay } from '../../lib/kioskScan'
import type { AttendanceCheckpoint, ClassTimetable, ElectiveSchedule, TimetablePeriod, UserProfile, Weekday } from '../../types'

/** How long a scanned student's personalized view stays up before the kiosk
 *  reverts to its neutral campus-wide display and resumes scanning. */
const OVERLAY_MS = 9000

/** Re-renders every second so the current session's progress bar keeps moving
 *  for the few seconds this overlay is on screen. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

interface Props {
  studentId: string
  qrToken: string
  student: UserProfile
  kioskDb: Firestore
  date: string
  weekday: Weekday | null
  fallbackTimetable: ClassTimetable
  fallbackElectives: ElectiveSchedule
  /** This student's checkpoints so far today, from the kiosk's own live
   *  `attendance` listener — avoids a redundant read on every scan. */
  existingCheckpoints: AttendanceCheckpoint[]
  onClose: () => void
}

/**
 * What a scanned student sees — their own name, a login/period/logout
 * checkpoint recorded on the spot (same `attendance` doc the roster table
 * already live-subscribes to), and today's personalized timeline. Written
 * through `kioskDb` (the kiosk's own signed-in session, not the student's),
 * which the `attendance` Firestore rule already allows for any signed-in
 * caller whose write carries a matching `studentId`/`qrToken` pair.
 */
export function StudentScanOverlay({
  studentId, qrToken, student, kioskDb, date, weekday, fallbackTimetable, fallbackElectives, existingCheckpoints, onClose,
}: Props) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'invalid' | 'error'>('loading')
  const [periods, setPeriods] = useState<TimetablePeriod[]>([])
  const [timed, setTimed] = useState<TimedPeriod[]>([])
  const [checkpoint, setCheckpoint] = useState<AttendanceCheckpoint | null>(null)
  const [alreadyDone, setAlreadyDone] = useState(false)
  // A snapshot from the moment this card was scanned — the kiosk's live
  // `attendance` listener keeps handing this component new `existingCheckpoints`
  // arrays as the roster updates (including right after this very write), and
  // reacting to those would re-run the effect below and write a second, third…
  // checkpoint for one physical scan. Captured once; deliberately not in the
  // effect's own dependency array.
  const initialCheckpointsRef = useRef(existingCheckpoints)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // The printed card's token must still match what's on file — a reissued
      // ID (lost card, etc.) rotates this field, so an old physical card stops
      // working here the same way it already stops working on `/scan`.
      if (qrToken !== student.qrToken) { if (!cancelled) setPhase('invalid'); return }
      if (!weekday) { if (!cancelled) { setAlreadyDone(true); setPhase('ready') } return }
      try {
        const day = await loadPersonalizedDay(kioskDb, studentId, weekday, fallbackTimetable, fallbackElectives)
        if (cancelled) return
        setPeriods(day.periods)
        setTimed(day.timed)

        const existing = initialCheckpointsRef.current
        const next = determineNextCheckpoint(day.periods, existing, new Date())
        if (!next) { setAlreadyDone(true); setPhase('ready'); return }

        const newCheckpoint: AttendanceCheckpoint = {
          kind: next.kind,
          ...(next.kind === 'period' ? { periodId: next.periodId } : {}),
          status: next.status,
          scannedAt: new Date().toISOString(),
        }
        await setDoc(
          doc(kioskDb, 'attendance', `${studentId}_${date}`),
          { studentId, date, qrToken, checkpoints: [...existing, newCheckpoint] },
          { merge: true },
        )
        if (cancelled) return
        setCheckpoint(newCheckpoint)
        setPhase('ready')
      } catch {
        if (!cancelled) setPhase('error')
      }
    })()
    return () => { cancelled = true }
  }, [studentId, qrToken, student.qrToken, kioskDb, date, weekday, fallbackTimetable, fallbackElectives])

  useEffect(() => {
    const id = window.setTimeout(onClose, OVERLAY_MS)
    return () => window.clearTimeout(id)
  }, [onClose])

  const now = useNow()
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
  const state = clockState(timed, nowMin)
  const currentId = state.kind === 'in' ? state.current.id : null

  const initials = student.name.trim()
    ? student.name.trim().split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  return (
    <div className="kiosk-overlay-backdrop" onClick={onClose}>
      <div className="panel kid-theme kiosk-overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div className={`user-avatar ${avatarClass(student.roles)} kiosk-overlay-avatar`}>{initials}</div>
        <h2 style={{ margin: '0.85rem 0 0.2rem' }}>{student.name}</h2>

        {phase === 'loading' && <p className="muted" style={{ fontSize: '1.05rem' }}>Checking in…</p>}
        {phase === 'invalid' && <p className="error" style={{ fontSize: '1.05rem' }}>This ID card is no longer valid.</p>}
        {phase === 'error' && <p className="error" style={{ fontSize: '1.05rem' }}>Couldn't record this scan — try again.</p>}

        {phase === 'ready' && (
          <>
            {checkpoint ? (
              <p style={{ margin: '0 0 0.25rem', fontSize: '1.3rem', fontWeight: 700, color: checkpoint.status === 'late' ? 'var(--danger)' : 'var(--green)' }}>
                {checkpoint.status === 'late' ? '⚠ ' : '✓ '}{checkpointLabel(checkpoint, periods)}
              </p>
            ) : (
              <p style={{ margin: '0 0 0.25rem', fontSize: '1.2rem', fontWeight: 700 }}>
                {alreadyDone ? '✅ Already logged out for today' : '📅 Nothing scheduled today'}
              </p>
            )}

            {timed.length > 0 && (
              <div style={{ marginTop: '1.1rem', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '40vh', overflowY: 'auto' }}>
                {timed.map((t) => {
                  const done = nowMin >= t.endMin
                  const current = t.id === currentId
                  const pct = current ? Math.min(100, Math.max(0, ((nowMin - t.startMin) / (t.endMin - t.startMin)) * 100)) : 0
                  return (
                    <div key={t.id} style={{ opacity: done ? 0.6 : 1 }}>
                      <div
                        className="tag"
                        style={{
                          display: 'flex', justifyContent: 'space-between', gap: '0.5rem', border: 'none', padding: '0.5rem 0.75rem',
                          background: current ? 'var(--primary)' : 'var(--primary-soft)',
                          color: current ? '#fff' : 'var(--text)',
                        }}
                      >
                        <span>{formatClock(t.startMin)} · {t.title}</span>
                        <span style={{ fontWeight: 700 }}>{current ? 'NOW' : done ? 'done' : ''}</span>
                      </div>
                      {current && (
                        <div style={{ height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.4)', overflow: 'hidden', marginTop: '0.3rem' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)', transition: 'width 1s linear' }} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
