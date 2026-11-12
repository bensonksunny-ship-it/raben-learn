import { addDays, mondayOf, type SubjectWeeklyHours } from '../components/manager/schedulerShared'
import { LEVELS } from './levels'
import type { AttendanceCheckpoint, Course, LevelId, ProgressEntry } from '../types'

/** Everything the Founder Overview needs, already read out of Firestore into
 *  plain values — `computeFounderStats` below is pure, so the page only fetches. */
export interface FounderInput {
  /** "YYYY-MM-DD", same UTC-anchored convention as `todayStr()`. */
  today: string
  students: { id: string; active: boolean; createdAt: string | null; courseIds: string[] }[]
  courses: Course[]
  sessions: { id: string; courseId: string; topicCount: number; requiredMinutes: number }[]
  progress: { studentId: string; sessionId: string; entries: ProgressEntry[] }[]
  plans: { studentId: string; date: string; itemCount: number }[]
  attendance: { studentId: string; date: string; checkpoints: AttendanceCheckpoint[] }[]
  examAttempts: { courseId: string; submittedAt: string | null; score: number; totalMarks: number }[]
  /** null = couldn't be read (never shown as 0). */
  applicantsWaiting: number | null
  scheduledThisWeek: SubjectWeeklyHours[]
}

export interface FounderStats {
  students: { total: number; newThisMonth: number; applicantsWaiting: number | null }
  /** Rates are 0–100, null when there's nothing to measure yet. */
  attendance: { rate: number | null; lastWeekRate: number | null; lateRate: number | null }
  habit: { rate: number | null; lastWeekRate: number | null }
  topics: { thisWeek: number; lastWeek: number }
  /** Oldest first — the last entry is the current week. */
  pace: { weekStart: string; count: number }[]
  levels: { levelId: LevelId; students: number; pct: number | null }[]
  mentors: { waiting: number; oldestWaitingDays: number | null; approvedThisWeek: number }
  exams: { takenThisMonth: number; averagePct: number | null; weakest: { title: string; pct: number } | null }
  attention: { noRecentPlan: number; lowAttendance: number; unscheduledSubjects: number }
}

const PACE_WEEKS = 8
const NO_PLAN_DAYS = 5
const LOW_ATTENDANCE_PCT = 75
/** Below this many recorded school days a month's attendance % is noise. */
const MIN_ATTENDANCE_DAYS = 3

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

/** Mon–Sat dates of the week starting `monday`, optionally cut off at `upTo` (inclusive). */
function weekDays(monday: string, upTo?: string): string[] {
  const days: string[] = []
  for (let i = 0; i < 6; i++) {
    const d = addDays(monday, i)
    if (upTo && d > upTo) break
    days.push(d)
  }
  return days
}

export function computeFounderStats(input: FounderInput): FounderStats {
  const { today } = input
  const thisMonday = mondayOf(today)
  const lastMonday = addDays(thisMonday, -7)
  const month = today.slice(0, 7)

  const active = input.students.filter((s) => s.active)
  const activeIds = new Set(active.map((s) => s.id))

  // ── Attendance ── a "school day" is any day at least one card was scanned —
  // there's no holiday calendar, so a day with no scans at all is simply not counted.
  const presentByDate = new Map<string, Set<string>>()
  const lateByDate = new Map<string, number>()
  for (const a of input.attendance) {
    if (!activeIds.has(a.studentId) || a.checkpoints.length === 0) continue
    if (!presentByDate.has(a.date)) presentByDate.set(a.date, new Set())
    presentByDate.get(a.date)!.add(a.studentId)
    if (a.checkpoints.some((c) => c.kind === 'login' && c.status === 'late')) {
      lateByDate.set(a.date, (lateByDate.get(a.date) ?? 0) + 1)
    }
  }
  function attendanceFor(days: string[]) {
    const schoolDays = days.filter((d) => presentByDate.has(d))
    const present = schoolDays.reduce((n, d) => n + presentByDate.get(d)!.size, 0)
    const late = schoolDays.reduce((n, d) => n + (lateByDate.get(d) ?? 0), 0)
    return { rate: pct(present, active.length * schoolDays.length), lateRate: pct(late, present) }
  }
  const attThis = attendanceFor(weekDays(thisMonday, today))
  const attLast = attendanceFor(weekDays(lastMonday))

  // ── Daily habit ── share of students with a non-empty plan on every planning
  // day. Today is left out (the day isn't over), and — same reasoning as
  // attendance — a day nobody planned at all isn't held against anyone.
  const plannedByDate = new Map<string, Set<string>>()
  const lastPlanDate = new Map<string, string>()
  for (const p of input.plans) {
    if (!activeIds.has(p.studentId) || p.itemCount === 0) continue
    if (!plannedByDate.has(p.date)) plannedByDate.set(p.date, new Set())
    plannedByDate.get(p.date)!.add(p.studentId)
    if (p.date > (lastPlanDate.get(p.studentId) ?? '')) lastPlanDate.set(p.studentId, p.date)
  }
  function habitFor(days: string[]): number | null {
    const planDays = days.filter((d) => plannedByDate.has(d))
    if (planDays.length === 0) return null
    const consistent = active.filter((s) => planDays.every((d) => plannedByDate.get(d)!.has(s.id))).length
    return pct(consistent, active.length)
  }
  const habitThis = habitFor(weekDays(thisMonday, addDays(today, -1)))
  const habitLast = habitFor(weekDays(lastMonday))

  // ── Progress ── one pass over every entry feeds the pace trend, the per-level
  // completion and the mentor backlog.
  const sessionCourse = new Map(input.sessions.map((s) => [s.id, s.courseId]))
  const approvedByWeek = new Map<string, number>()
  const doneByStudentCourse = new Map<string, number>()
  let waiting = 0
  let oldestMarkedAt: string | null = null
  for (const doc of input.progress) {
    const courseId = sessionCourse.get(doc.sessionId)
    for (const e of doc.entries) {
      if (e.status === 'completed') {
        if (courseId) {
          const key = `${doc.studentId}|${courseId}`
          doneByStudentCourse.set(key, (doneByStudentCourse.get(key) ?? 0) + 1)
        }
        if (e.mentorApprovedAt) {
          const week = mondayOf(e.mentorApprovedAt.slice(0, 10))
          approvedByWeek.set(week, (approvedByWeek.get(week) ?? 0) + 1)
        }
      } else if (e.status === 'review') {
        waiting++
        if (e.studentMarkedAt && (!oldestMarkedAt || e.studentMarkedAt < oldestMarkedAt)) oldestMarkedAt = e.studentMarkedAt
      }
    }
  }
  const pace = Array.from({ length: PACE_WEEKS }, (_, i) => {
    const weekStart = addDays(thisMonday, -7 * (PACE_WEEKS - 1 - i))
    return { weekStart, count: approvedByWeek.get(weekStart) ?? 0 }
  })
  const topicsThisWeek = approvedByWeek.get(thisMonday) ?? 0

  // ── Levels ── across each level's subjects: topics approved ÷ topics assigned,
  // counting only students actually enrolled in that subject.
  const topicsByCourse = new Map<string, number>()
  const requiredMinutesByCourse = new Map<string, number>()
  for (const s of input.sessions) {
    topicsByCourse.set(s.courseId, (topicsByCourse.get(s.courseId) ?? 0) + s.topicCount)
    requiredMinutesByCourse.set(s.courseId, (requiredMinutesByCourse.get(s.courseId) ?? 0) + s.requiredMinutes)
  }
  const enrolledCourseIds = new Set(active.flatMap((s) => s.courseIds))
  const levels = LEVELS.flatMap((levelId) => {
    const courseIds = input.courses.filter((c) => c.levelId === levelId).map((c) => c.id)
    let students = 0, total = 0, done = 0
    for (const s of active) {
      const mine = courseIds.filter((id) => s.courseIds.includes(id))
      if (mine.length === 0) continue
      students++
      for (const id of mine) {
        const topics = topicsByCourse.get(id) ?? 0
        total += topics
        done += Math.min(doneByStudentCourse.get(`${s.id}|${id}`) ?? 0, topics)
      }
    }
    return students > 0 ? [{ levelId, students, pct: pct(done, total) }] : []
  })

  // ── Exams ──
  const monthAttempts = input.examAttempts.filter((a) => a.submittedAt?.startsWith(month) && a.totalMarks > 0)
  const byCourse = new Map<string, { sum: number; n: number }>()
  let scoreSum = 0
  for (const a of monthAttempts) {
    const ratio = a.score / a.totalMarks
    scoreSum += ratio
    const c = byCourse.get(a.courseId) ?? { sum: 0, n: 0 }
    c.sum += ratio; c.n++
    byCourse.set(a.courseId, c)
  }
  let weakest: { title: string; pct: number } | null = null
  // "Weakest" only means something relative to another subject.
  if (byCourse.size > 1) {
    for (const [courseId, c] of byCourse) {
      const p = Math.round((c.sum / c.n) * 100)
      if (!weakest || p < weakest.pct) {
        weakest = { title: input.courses.find((x) => x.id === courseId)?.title ?? 'Unknown subject', pct: p }
      }
    }
  }

  // ── Needs attention ──
  const planCutoff = addDays(today, -NO_PLAN_DAYS)
  const noRecentPlan = active.filter((s) => {
    // A student who joined inside the window hasn't had the chance yet.
    if (s.createdAt && s.createdAt.slice(0, 10) > planCutoff) return false
    return (lastPlanDate.get(s.id) ?? '') <= planCutoff
  }).length

  const monthDays = [...presentByDate.keys()].filter((d) => d.startsWith(month) && d <= today)
  const lowAttendance = monthDays.length < MIN_ATTENDANCE_DAYS ? 0 : active.filter((s) => {
    const present = monthDays.filter((d) => presentByDate.get(d)!.has(s.id)).length
    return (present / monthDays.length) * 100 < LOW_ATTENDANCE_PCT
  }).length

  const scheduledIds = new Set(input.scheduledThisWeek.filter((h) => h.scheduledMinutes > 0).map((h) => h.courseId))
  const unscheduledSubjects = input.courses.filter((c) =>
    enrolledCourseIds.has(c.id) && (requiredMinutesByCourse.get(c.id) ?? 0) > 0 && !scheduledIds.has(c.id),
  ).length

  return {
    students: {
      total: active.length,
      newThisMonth: active.filter((s) => s.createdAt?.startsWith(month)).length,
      applicantsWaiting: input.applicantsWaiting,
    },
    attendance: { rate: attThis.rate, lastWeekRate: attLast.rate, lateRate: attThis.lateRate },
    habit: { rate: habitThis, lastWeekRate: habitLast },
    topics: { thisWeek: topicsThisWeek, lastWeek: approvedByWeek.get(lastMonday) ?? 0 },
    pace,
    levels,
    mentors: {
      waiting,
      oldestWaitingDays: oldestMarkedAt
        ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(oldestMarkedAt.slice(0, 10))) / 86_400_000))
        : null,
      approvedThisWeek: topicsThisWeek,
    },
    exams: {
      takenThisMonth: monthAttempts.length,
      averagePct: monthAttempts.length > 0 ? Math.round((scoreSum / monthAttempts.length) * 100) : null,
      weakest,
    },
    attention: { noRecentPlan, lowAttendance, unscheduledSubjects },
  }
}
