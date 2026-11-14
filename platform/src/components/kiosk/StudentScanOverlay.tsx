import { useEffect, useRef, useState } from 'react'
import { doc, setDoc, type Firestore } from 'firebase/firestore'
import { avatarClass } from '../../lib/userUtils'
import { computeSubjectWeeklyHours, type SubjectWeeklyHours } from '../../components/manager/schedulerShared'
import {
  determineNextCheckpoint, checkpointLabel, clockState, formatClock, formatSpan,
  type TimedPeriod,
} from '../../lib/attendance'
import { loadPersonalizedDay, loadCoursePreview, loadStreak } from '../../lib/kioskScan'
import type { AttendanceCheckpoint, ClassTimetable, Course, ElectiveSchedule, Topic, TimetablePeriod, UserProfile, Weekday } from '../../types'

/** How long a scanned student's full-screen view stays up before the kiosk
 *  reverts to its neutral campus-wide display and resumes scanning. Tapping
 *  anything on the timeline extends it — exploring shouldn't get cut off —
 *  up to `MAX_OVERLAY_MS`. */
const BASE_OVERLAY_MS = 25000
const TAP_EXTENSION_MS = 8000
const MAX_OVERLAY_MS = 60000

/** Re-renders every second so the countdowns/progress bars keep moving while
 *  this view is on screen. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

const MEDALS = ['🥇', '🥈', '🥉']

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
  /** For subject names on the stats/timeline, and this student's weekly
   *  subject-hours stat. */
  syllabusCourses: Course[]
  onClose: () => void
}

/**
 * What a scanned student sees — a full-screen, celebratory personal portal:
 * their own login/period/logout checkpoint recorded on the spot (same
 * `attendance` doc the roster table already live-subscribes to), a
 * punctuality shout-out, today's current/next subject with a live countdown,
 * a few gamified stats, and an interactive timeline of the whole day they can
 * tap into for a subject's topics/exam status. Written through `kioskDb` (the
 * kiosk's own signed-in session, not the student's), which the `attendance`
 * Firestore rule already allows for any signed-in caller whose write carries
 * a matching `studentId`/`qrToken` pair.
 */
export function StudentScanOverlay({
  studentId, qrToken, student, kioskDb, date, weekday, fallbackTimetable, fallbackElectives,
  existingCheckpoints, syllabusCourses, onClose,
}: Props) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'invalid' | 'error'>('loading')
  const [periods, setPeriods] = useState<TimetablePeriod[]>([])
  const [timed, setTimed] = useState<TimedPeriod[]>([])
  const [subjectHours, setSubjectHours] = useState<SubjectWeeklyHours[]>([])
  const [streak, setStreak] = useState<number | null>(null)
  const [checkpoint, setCheckpoint] = useState<AttendanceCheckpoint | null>(null)
  const [resultKind, setResultKind] = useState<'already-done' | 'in-progress' | 'no-school'>('in-progress')
  // Which subject's topics/exam-status preview is open, and the lazy-loaded
  // results per courseId tapped so far this scan (never refetched twice).
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null)
  const [previewByCourse, setPreviewByCourse] = useState<Record<string, { topics: Topic[]; hasExam: boolean } | 'loading' | 'error'>>({})

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
      if (!weekday) { if (!cancelled) { setResultKind('no-school'); setPhase('ready') } return }
      try {
        const day = await loadPersonalizedDay(kioskDb, studentId, weekday, fallbackTimetable, fallbackElectives)
        if (cancelled) return
        setPeriods(day.periods)
        setTimed(day.timed)
        setSubjectHours(computeSubjectWeeklyHours(day.timetable, day.electives, syllabusCourses))

        const existing = initialCheckpointsRef.current
        const next = determineNextCheckpoint(day.periods, existing, new Date())
        if (next.kind === 'done') { setResultKind('already-done'); setPhase('ready'); return }
        if (next.kind === 'in-progress') { setResultKind('in-progress'); setPhase('ready'); return }

        const newCheckpoint: AttendanceCheckpoint = {
          kind: next.kind,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, qrToken, student.qrToken, kioskDb, date, weekday, fallbackTimetable, fallbackElectives])

  // Streak loads on its own, non-critical — a failure here just hides that one stat.
  useEffect(() => {
    let cancelled = false
    void loadStreak(kioskDb, studentId, date)
      .then((s) => { if (!cancelled) setStreak(s) })
      .catch(() => { if (!cancelled) setStreak(null) })
    return () => { cancelled = true }
  }, [kioskDb, studentId, date])

  // Auto-return countdown — resets (up to MAX_OVERLAY_MS total) on every
  // timeline tap, so a student exploring their day doesn't get cut off mid-look.
  const [msLeft, setMsLeft] = useState(BASE_OVERLAY_MS)
  const deadlineRef = useRef(Date.now() + BASE_OVERLAY_MS)
  const startRef = useRef(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => {
      const left = deadlineRef.current - Date.now()
      if (left <= 0) { onClose(); return }
      setMsLeft(left)
    }, 250)
    return () => window.clearInterval(id)
  }, [onClose])
  function extendTimer() {
    const maxDeadline = startRef.current + MAX_OVERLAY_MS
    deadlineRef.current = Math.min(deadlineRef.current + TAP_EXTENSION_MS, maxDeadline)
  }

  function openPreview(courseId: string) {
    extendTimer()
    setActiveCourseId((cur) => (cur === courseId ? null : courseId))
    if (previewByCourse[courseId]) return
    setPreviewByCourse((prev) => ({ ...prev, [courseId]: 'loading' }))
    void loadCoursePreview(kioskDb, courseId)
      .then((result) => setPreviewByCourse((prev) => ({ ...prev, [courseId]: result })))
      .catch(() => setPreviewByCourse((prev) => ({ ...prev, [courseId]: 'error' })))
  }

  const now = useNow()
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
  const state = clockState(timed, nowMin)
  const currentId = state.kind === 'in' ? state.current.id : null
  const doneCount = timed.filter((t) => nowMin >= t.endMin).length

  const initials = student.name.trim()
    ? student.name.trim().split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  // Punctuality shout-out — only for a fresh on-time/early login; a late
  // login already gets its own ⚠ line below, no fanfare needed on top of it.
  const banner = (() => {
    if (!checkpoint || checkpoint.kind !== 'login' || checkpoint.status === 'late') return null
    const first = timed[0]
    if (first && nowMin < first.startMin - 1) {
      return { emoji: '🚀', text: `Early Bird Star! ${formatSpan(first.startMin - nowMin)} left until your first class begins at ${formatClock(first.startMin)}.` }
    }
    return { emoji: '🌟', text: "Super Punctual! You're right on time!" }
  })()

  const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000))
  const courseTitleById = new Map(syllabusCourses.map((c) => [c.id, c.title]))

  return (
    <div className="kiosk-overlay-backdrop full" onClick={onClose}>
      <div className="kid-theme kiosk-portal" onClick={(e) => e.stopPropagation()}>
        <div className="kiosk-portal-topbar">
          <div className="kiosk-portal-identity">
            <div className={`user-avatar ${avatarClass(student.roles)} kiosk-portal-avatar`}>{initials}</div>
            <div>
              <h1 className="kiosk-portal-name">{student.name}</h1>
              <p className="muted" style={{ margin: 0 }}>
                {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="kiosk-portal-topbar-actions">
            <span className="kiosk-return-pill" title="Returning to the scanner soon">⏱ {secondsLeft}s</span>
            <button type="button" className="btn primary" onClick={onClose}>✕ Done</button>
          </div>
        </div>

        {phase === 'loading' && <p className="muted" style={{ fontSize: '1.2rem', textAlign: 'center' }}>Checking in…</p>}
        {phase === 'invalid' && <p className="error" style={{ fontSize: '1.2rem', textAlign: 'center' }}>This ID card is no longer valid.</p>}
        {phase === 'error' && <p className="error" style={{ fontSize: '1.2rem', textAlign: 'center' }}>Couldn't record this scan — try again.</p>}

        {phase === 'ready' && (
          <div className="kiosk-portal-body">
            {checkpoint ? (
              <>
                <p className="kiosk-checkpoint-line" style={{ color: checkpoint.status === 'late' ? 'var(--danger)' : 'var(--green)' }}>
                  {checkpoint.status === 'late' ? '⚠ ' : '✓ '}{checkpointLabel(checkpoint, periods)}
                </p>
                {banner && (
                  <div className="kiosk-banner kiosk-bounce">
                    <span className="kiosk-banner-emoji">{banner.emoji}</span> {banner.text}
                  </div>
                )}
              </>
            ) : (
              <p className="kiosk-checkpoint-line">
                {resultKind === 'already-done' ? '✅ Already logged out for today'
                  : resultKind === 'no-school' ? '📅 Nothing scheduled today'
                  : `👋 Hi, ${student.name.split(' ')[0]}! Here's your day.`}
              </p>
            )}

            {/* Current/next subject, prominent, with a live countdown */}
            {state.kind === 'in' && (() => {
              const { current, next } = state
              const pct = Math.min(100, Math.max(0, ((nowMin - current.startMin) / (current.endMin - current.startMin)) * 100))
              return (
                <div className="kiosk-now-card kiosk-now-card--current">
                  <div className="kiosk-now-kicker">🔥 Happening Now</div>
                  <div className="kiosk-now-title">{current.title}</div>
                  <div className="kiosk-now-countdown">{formatSpan(current.endMin - nowMin)} left</div>
                  <div className="kiosk-now-bar"><div className="kiosk-now-bar-fill" style={{ width: `${pct}%` }} /></div>
                  {next && <div className="kiosk-now-next">Next up: <strong>{next.title}</strong> at {formatClock(next.startMin)}</div>}
                </div>
              )
            })()}
            {(state.kind === 'before' || state.kind === 'break') && (
              <div className="kiosk-now-card kiosk-now-card--next">
                <div className="kiosk-now-kicker">{state.kind === 'before' ? '🌅 Up Next' : '☕ On a Break — Up Next'}</div>
                <div className="kiosk-now-title">{state.next.title}</div>
                <div className="kiosk-now-countdown">starts in {formatSpan(state.next.startMin - nowMin)} · {formatClock(state.next.startMin)}</div>
              </div>
            )}
            {state.kind === 'over' && (
              <div className="kiosk-now-card kiosk-now-card--done">
                <div className="kiosk-now-title">🏁 All done for today — great work!</div>
              </div>
            )}

            {/* Gamified stats row */}
            <div className="kiosk-stats-row">
              <div className="kiosk-stat-card">
                <div className="kiosk-stat-icon">🎯</div>
                <div className="kiosk-stat-value">{doneCount} of {timed.length}</div>
                <div className="kiosk-stat-label">missions done today!</div>
              </div>
              {streak != null && streak > 0 && (
                <div className="kiosk-stat-card">
                  <div className="kiosk-stat-icon">🔥</div>
                  <div className="kiosk-stat-value">{streak} day{streak === 1 ? '' : 's'}</div>
                  <div className="kiosk-stat-label">streak</div>
                </div>
              )}
              {subjectHours.slice(0, 3).map((s, i) => {
                const pct = s.scheduledMinutes > 0 ? Math.min(100, Math.round((s.completedMinutes / s.scheduledMinutes) * 100)) : 0
                return (
                  <div className="kiosk-stat-card" key={s.courseId}>
                    <div className="kiosk-stat-icon">{MEDALS[i] ?? '⭐'}</div>
                    <div className="kiosk-stat-value" style={{ fontSize: '1.05rem' }}>{s.courseTitle}</div>
                    <div className="kiosk-stat-bar"><div className="kiosk-stat-bar-fill" style={{ width: `${pct}%` }} /></div>
                    <div className="kiosk-stat-label">{formatSpan(s.completedMinutes)} / {formatSpan(s.scheduledMinutes)} this week</div>
                  </div>
                )
              })}
            </div>

            {/* Interactive today's-timeline journey */}
            {timed.length > 0 && (
              <div className="kiosk-timeline">
                {timed.map((t) => {
                  const done = nowMin >= t.endMin
                  const current = t.id === currentId
                  const courseId = t.courseId
                  const cls = `kiosk-timeline-card${done ? ' done' : ''}${current ? ' current' : ''}${courseId ? ' tappable' : ''}${activeCourseId === courseId ? ' active' : ''}`
                  const content = (
                    <>
                      <span className="kiosk-timeline-status" aria-hidden>{done ? '⭐' : current ? '✨' : '•'}</span>
                      <span className="kiosk-timeline-time">{formatClock(t.startMin)}</span>
                      <span className="kiosk-timeline-title">{t.title}</span>
                      {current && <span className="kiosk-timeline-now">NOW</span>}
                    </>
                  )
                  return courseId ? (
                    <button key={t.id} type="button" className={cls} onClick={() => openPreview(courseId)}>{content}</button>
                  ) : (
                    <div key={t.id} className={cls}>{content}</div>
                  )
                })}
              </div>
            )}

            {/* Tapped subject's preview — topics + exam status */}
            {activeCourseId && (() => {
              const preview = previewByCourse[activeCourseId]
              return (
                <div className="kiosk-preview-panel kiosk-bounce">
                  <div className="kiosk-preview-title">📖 {courseTitleById.get(activeCourseId) ?? 'Subject'}</div>
                  {preview === 'loading' && <p className="muted" style={{ margin: 0 }}>Loading…</p>}
                  {preview === 'error' && <p className="error" style={{ margin: 0 }}>Couldn't load this subject.</p>}
                  {preview && preview !== 'loading' && preview !== 'error' && (
                    <>
                      {preview.hasExam && <span className="tag" style={{ marginBottom: '0.5rem' }}>🎓 Exam Configured</span>}
                      {preview.topics.length === 0 ? (
                        <p className="muted" style={{ margin: 0 }}>No topics added yet.</p>
                      ) : (
                        <ul className="kiosk-preview-topics">
                          {preview.topics.slice(0, 6).map((topic) => <li key={topic.id}>{topic.title}</li>)}
                          {preview.topics.length > 6 && <li className="muted">+ {preview.topics.length - 6} more</li>}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
