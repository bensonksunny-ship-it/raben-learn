import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { normalizeRoles } from '../../lib/roles'
import { mapCourseDoc } from '../../lib/courses'
import { levelName } from '../../lib/levels'
import { computeFounderStats, type FounderStats } from '../../lib/founderStats'
import {
  addDays, computeSubjectWeeklyHours, formatDayDate, formatWeekRangeLabel, loadEffectiveWeekSchedule, mondayOf, todayStr,
} from '../../components/manager/schedulerShared'
import type { AttendanceCheckpoint, Course, ProgressEntry } from '../../types'

/** Firestore Timestamp / ISO string / missing → ISO string or null. */
function toIso(v: unknown): string | null {
  if (typeof v === 'string') return v
  const d = (v as { toDate?: () => Date } | null)?.toDate?.()
  return d ? d.toISOString() : null
}

async function loadFounderStats(): Promise<FounderStats> {
  const today = todayStr()
  // Plans and attendance grow by a doc per student per day — the stats only look
  // at last week, this week and this month, so that's all that's fetched.
  const lastMonday = addDays(mondayOf(today), -7)
  const monthStart = `${today.slice(0, 7)}-01`
  const from = lastMonday < monthStart ? lastMonday : monthStart
  const [usersSnap, coursesSnap, sessionsSnap, progSnap, plansSnap, attendanceSnap, attemptsSnap, applicantsSnap, schedule] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'courses')),
    getDocs(collection(db, 'sessions')),
    getDocs(collection(db, 'student_lesson_progress')),
    getDocs(query(collection(db, 'student_daily_plans'), where('date', '>=', from))),
    getDocs(query(collection(db, 'attendance'), where('date', '>=', from))),
    getDocs(collection(db, 'examAttempts')),
    // Staff-only collection — a failed read shows as "—", never as zero applicants.
    getDocs(collection(db, 'applicants')).catch(() => null),
    loadEffectiveWeekSchedule(db, mondayOf(today)).catch(() => null),
  ])

  const courses: Course[] = coursesSnap.docs.map(mapCourseDoc)

  return computeFounderStats({
    today,
    courses,
    students: usersSnap.docs
      .filter((d) => normalizeRoles(d.data()).includes('student'))
      .map((d) => {
        const x = d.data()
        return { id: d.id, active: x.status !== 'disabled', createdAt: toIso(x.createdAt), courseIds: (x.courseIds as string[]) ?? [] }
      }),
    sessions: sessionsSnap.docs.map((d) => {
      const topics = Array.isArray(d.data().activities) ? (d.data().activities as { durationMinutes?: unknown }[]) : []
      return {
        id: d.id,
        courseId: (d.data().courseId as string) ?? '',
        topicCount: topics.length,
        requiredMinutes: topics.reduce((n, t) => n + (Number(t?.durationMinutes) || 0), 0),
      }
    }),
    progress: progSnap.docs.map((d) => {
      const x = d.data()
      return {
        studentId: (x.studentId as string) ?? '',
        sessionId: (x.sessionId as string) ?? (x.lessonId as string) ?? '',
        entries: (x.entries as ProgressEntry[]) ?? [],
      }
    }),
    plans: plansSnap.docs.map((d) => {
      const x = d.data()
      return { studentId: (x.studentId as string) ?? '', date: (x.date as string) ?? '', itemCount: Array.isArray(x.items) ? x.items.length : 0 }
    }),
    attendance: attendanceSnap.docs.map((d) => {
      const x = d.data()
      return { studentId: (x.studentId as string) ?? '', date: (x.date as string) ?? '', checkpoints: (x.checkpoints as AttendanceCheckpoint[]) ?? [] }
    }),
    examAttempts: attemptsSnap.docs.map((d) => {
      const x = d.data()
      return { courseId: (x.courseId as string) ?? '', submittedAt: toIso(x.submittedAt), score: Number(x.score ?? 0), totalMarks: Number(x.totalMarks ?? 0) }
    }),
    applicantsWaiting: applicantsSnap ? applicantsSnap.docs.filter((d) => d.data().status !== 'recruited').length : null,
    scheduledThisWeek: schedule ? computeSubjectWeeklyHours(schedule.timetable, schedule.electives, courses) : [],
  })
}

const DASH = '—'

function pctText(v: number | null): string {
  return v == null ? DASH : `${v}%`
}

/** Week-over-week change — arrow + sign, so direction never rests on color alone. */
function Delta({ now, before, unit = '' }: { now: number | null; before: number | null; unit?: string }) {
  if (now == null || before == null || now === before) return null
  const up = now > before
  return (
    <span className={`founder-delta ${up ? 'up' : 'down'}`}>
      {up ? '▲' : '▼'} {Math.abs(now - before)}{unit}
    </span>
  )
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function FounderDashboard() {
  const [stats, setStats] = useState<FounderStats | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadFounderStats()
      .then((s) => { if (!cancelled) setStats(s) })
      .catch((e) => { console.error('FounderDashboard load failed', e); if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.75rem' }}>
      <h1 style={{ margin: 0 }}>Founder Overview</h1>
      <span className="page-stat">{formatWeekRangeLabel(mondayOf(todayStr()))}</span>
    </div>
  )

  if (error) return <div>{header}<p className="error">Couldn't load the overview.</p></div>
  if (!stats) return <div>{header}<p className="muted">Loading…</p></div>

  const { students, attendance, habit, topics, pace, levels, mentors, exams, attention } = stats
  const paceMax = Math.max(1, ...pace.map((w) => w.count))

  const attentionItems = [
    attention.noRecentPlan > 0 && `${plural(attention.noRecentPlan, 'student', 'students')} with no plan in 5+ days`,
    attention.lowAttendance > 0 && `${plural(attention.lowAttendance, 'student', 'students')} under 75% attendance this month`,
    attention.unscheduledSubjects > 0 && `${plural(attention.unscheduledSubjects, 'subject', 'subjects')} with no class time this week`,
  ].filter((x): x is string => Boolean(x))

  return (
    <div>
      {header}

      <div className="dash-stat-grid">
        <div className="panel dash-stat-card">
          <span className="dash-stat-value" style={{ color: 'var(--primary)' }}>{students.total}</span>
          <span className="dash-stat-label">Students</span>
          <span className="muted small">
            {students.newThisMonth} new this month · {students.applicantsWaiting ?? DASH} applicants
          </span>
        </div>
        <div className="panel dash-stat-card">
          <span className="dash-stat-value" style={{ color: 'var(--primary)' }}>{pctText(attendance.rate)}</span>
          <span className="dash-stat-label">Attendance</span>
          <span className="muted small">
            <Delta now={attendance.rate} before={attendance.lastWeekRate} unit="%" /> {pctText(attendance.lateRate)} late
          </span>
        </div>
        <div className="panel dash-stat-card">
          <span className="dash-stat-value" style={{ color: 'var(--primary)' }}>{pctText(habit.rate)}</span>
          <span className="dash-stat-label">Daily Habit</span>
          <span className="muted small">
            <Delta now={habit.rate} before={habit.lastWeekRate} unit="%" /> planned every day
          </span>
        </div>
        <div className="panel dash-stat-card">
          <span className="dash-stat-value" style={{ color: 'var(--primary)' }}>{topics.thisWeek}</span>
          <span className="dash-stat-label">Topics Completed</span>
          <span className="muted small">
            <Delta now={topics.thisWeek} before={topics.lastWeek} /> {topics.lastWeek} last week
          </span>
        </div>
      </div>

      <div className="dash-two-col">
        <section className="panel">
          <h2 className="founder-heading">Learning Pace</h2>
          <div className="founder-bars" role="img" aria-label={`Topics completed per week: ${pace.map((w) => `${formatDayDate(w.weekStart)} ${w.count}`).join(', ')}`}>
            {pace.map((w, i) => (
              <div key={w.weekStart} className={`founder-bar-col${i === pace.length - 1 ? ' current' : ''}`}>
                <span className="founder-bar-value">{w.count}</span>
                <div className="founder-bar" style={{ height: `${(w.count / paceMax) * 100}%` }} />
                <span className="founder-bar-label">{formatDayDate(w.weekStart)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2 className="founder-heading">Progress by Level</h2>
          {levels.length === 0 ? <p className="muted" style={{ margin: 0 }}>{DASH}</p> : (
            <div className="founder-rows">
              {levels.map((l) => (
                <div key={l.levelId} className="founder-level">
                  <span className="founder-level-name">{levelName(l.levelId)} <span className="muted small">· {l.students}</span></span>
                  <div className="dash-progress-bar"><div className="dash-progress-fill" style={{ width: `${l.pct ?? 0}%`, background: 'var(--primary)' }} /></div>
                  <span className="founder-level-pct">{pctText(l.pct)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="dash-two-col">
        <section className="panel">
          <h2 className="founder-heading">Mentors</h2>
          <div className="founder-rows">
            <div className="founder-row"><span>Waiting for review</span><strong>{mentors.waiting}</strong></div>
            <div className="founder-row"><span>Oldest waiting</span><strong>{mentors.oldestWaitingDays == null ? DASH : plural(mentors.oldestWaitingDays, 'day', 'days')}</strong></div>
            <div className="founder-row"><span>Approved this week</span><strong>{mentors.approvedThisWeek}</strong></div>
          </div>
        </section>

        <section className="panel">
          <h2 className="founder-heading">Exams</h2>
          <div className="founder-rows">
            <div className="founder-row"><span>Taken this month</span><strong>{exams.takenThisMonth}</strong></div>
            <div className="founder-row"><span>Average score</span><strong>{pctText(exams.averagePct)}</strong></div>
            <div className="founder-row"><span>Weakest subject</span><strong>{exams.weakest ? `${exams.weakest.title} · ${exams.weakest.pct}%` : DASH}</strong></div>
          </div>
        </section>
      </div>

      <section className="panel">
        <h2 className="founder-heading">Needs Attention</h2>
        {attentionItems.length === 0 ? <p className="muted" style={{ margin: 0 }}>All clear</p> : (
          <div className="founder-rows">
            {attentionItems.map((text) => <div key={text} className="dash-review-item">{text}</div>)}
          </div>
        )}
      </section>
    </div>
  )
}
