/**
 * Constants and pure helpers shared between `<PriorityScheduler />` and the pages
 * that load its data (`SchedulePage`, `StudentTimetableView`). Kept out of
 * `PriorityScheduler.tsx` itself — a component file may only export components, or
 * Fast Refresh stops working for it.
 */
import type { ClassTimetable, Course, ElectiveSchedule, Weekday } from '../../types'

export const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Rainbow-bright, one hue per weekday — reads as a kid-friendly weekly chart. */
export const DAY_COLORS: Record<Weekday, { bg: string; text: string }> = {
  Mon: { bg: '#ffe3e3', text: '#e03131' },
  Tue: { bg: '#ffe8cc', text: '#e8590c' },
  Wed: { bg: '#fff3bf', text: '#f08c00' },
  Thu: { bg: '#d3f9d8', text: '#2b8a3e' },
  Fri: { bg: '#d0ebff', text: '#1971c2' },
  Sat: { bg: '#e5dbff', text: '#7048e8' },
}

export function timeStrToMinutes(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const hh = Number(m[1]); const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}

export function formatTime(ms: number) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${String(sec).padStart(2, '0')}s`
}

// ─── Week date helpers (UTC-anchored so day math never drifts with local TZ) ──

export function todayStr() { return new Date().toISOString().slice(0, 10) }
export function parseDateStr(s: string): Date {
  const [y, mo, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y!, (mo ?? 1) - 1, d ?? 1))
}
export function formatDateStr(d: Date): string { return d.toISOString().slice(0, 10) }
export function addDays(s: string, days: number): string {
  const d = parseDateStr(s)
  d.setUTCDate(d.getUTCDate() + days)
  return formatDateStr(d)
}
/** Monday of the week containing `s`. */
export function mondayOf(s: string): string {
  const d = parseDateStr(s)
  const dow = d.getUTCDay() // 0=Sun..6=Sat
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  return formatDateStr(d)
}
export function formatDayName(s: string): string {
  return parseDateStr(s).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}
export function formatDayFullName(s: string): string {
  return parseDateStr(s).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}
export function formatDayDate(s: string): string {
  return parseDateStr(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
/** Label covers Mon–Sat only — the grid doesn't show Sunday. */
export function formatWeekRangeLabel(monday: string): string {
  const saturday = addDays(monday, 5)
  return `${formatDayDate(monday)} – ${formatDayDate(saturday)}, ${parseDateStr(saturday).getUTCFullYear()}`
}

// ─── Shared class timetable (Priority 1) ───────────────────────────────────────

export function createDefaultTimetable(): ClassTimetable {
  const days = {} as ClassTimetable['days']
  for (const d of WEEKDAYS) days[d] = { periods: [] }
  return { windowStart: '10:00', windowEnd: '18:00', days }
}

/** Defensive merge so a partially-shaped (or missing) Firestore doc never crashes the UI. */
export function normalizeTimetable(data: Record<string, unknown> | undefined): ClassTimetable {
  const fallback = createDefaultTimetable()
  if (!data) return fallback
  const rawDays = (data.days as Record<string, unknown>) ?? {}
  const days = {} as ClassTimetable['days']
  for (const d of WEEKDAYS) {
    const rd = rawDays[d] as Record<string, unknown> | undefined
    const rawPeriods = Array.isArray(rd?.periods) ? (rd!.periods as Record<string, unknown>[]) : []
    const periods = rawPeriods
      .map((p) => ({
        id: typeof p.id === 'string' ? p.id : crypto.randomUUID(),
        title: typeof p.title === 'string' ? p.title : '',
        startTime: typeof p.startTime === 'string' ? p.startTime : '',
        durationMinutes: Number(p.durationMinutes ?? 0),
        activityTypeId: typeof p.activityTypeId === 'string' ? p.activityTypeId : null,
        courseId: typeof p.courseId === 'string' ? p.courseId : null,
      }))
      .filter((p) => p.title && timeStrToMinutes(p.startTime) != null && p.durationMinutes > 0)
    days[d] = { periods }
  }
  return {
    windowStart: (data.windowStart as string) ?? fallback.windowStart,
    windowEnd: (data.windowEnd as string) ?? fallback.windowEnd,
    days,
  }
}

// ─── Elective-session board (Priority 2) ───────────────────────────────────────

export function createDefaultElectives(): ElectiveSchedule {
  const days = {} as ElectiveSchedule['days']
  for (const d of WEEKDAYS) days[d] = { sessions: [] }
  return { days }
}

/** Same defensive-merge treatment as `normalizeTimetable`, for the sibling collection. */
export function normalizeElectives(data: Record<string, unknown> | undefined): ElectiveSchedule {
  const fallback = createDefaultElectives()
  if (!data) return fallback
  const rawDays = (data.days as Record<string, unknown>) ?? {}
  const days = {} as ElectiveSchedule['days']
  for (const d of WEEKDAYS) {
    const rd = rawDays[d] as Record<string, unknown> | undefined
    const rawSessions = Array.isArray(rd?.sessions) ? (rd!.sessions as Record<string, unknown>[]) : []
    const sessions = rawSessions
      .map((s) => {
        const title = typeof s.title === 'string' ? s.title : ''
        // Back-compat: any session saved before `claimed` existed has a real title
        // already (the only kind that could exist then), so it counts as claimed.
        const claimed = typeof s.claimed === 'boolean' ? s.claimed : Boolean(title)
        return {
          id: typeof s.id === 'string' ? s.id : crypto.randomUUID(),
          title,
          startTime: typeof s.startTime === 'string' ? s.startTime : '',
          durationMinutes: Number(s.durationMinutes ?? 0),
          mentorName: typeof s.mentorName === 'string' ? s.mentorName : null,
          claimed,
          activityTypeId: typeof s.activityTypeId === 'string' ? s.activityTypeId : null,
          courseId: typeof s.courseId === 'string' ? s.courseId : null,
        }
      })
      // A real session always needs a valid time + duration — but an *unclaimed*
      // open slot is kept even with a blank title, since that blank is the whole
      // point until a student or mentor claims it.
      .filter((s) => (s.title || !s.claimed) && timeStrToMinutes(s.startTime) != null && s.durationMinutes > 0)
    days[d] = { sessions }
  }
  return { days }
}

// ─── Subject-wise hours summary ────────────────────────────────────────────────

export interface SubjectWeeklyHours {
  courseId: string
  courseTitle: string
  /** Total minutes/week this subject is scheduled, across every period + elective
   *  tagged with its courseId (Mon–Sat). */
  scheduledMinutes: number
  /** Portion of `scheduledMinutes` whose slot has already ended as of `now` —
   *  resets every Monday. There's no persisted log of which classes actually
   *  happened (no attendance data this draws on), so this is "time elapsed so
   *  far this week," not a true cumulative attendance count. */
  completedMinutes: number
}

/** Minutes from this Monday 00:00 to `now`, in the grid's own Mon–Sat week frame
 *  (Sunday has no row, so it's treated as falling after Saturday — anything
 *  scheduled Mon–Sat already reads as fully "completed" by then). */
function minutesSinceMonday(now: Date): number {
  const dow = now.getDay() // 0=Sun..6=Sat
  const daysSinceMonday = dow === 0 ? 6 : dow - 1
  return daysSinceMonday * 24 * 60 + now.getHours() * 60 + now.getMinutes()
}

/** Groups every courseId-tagged period/elective by subject, for the Schedule
 *  page's summary bar and the Syllabus page's "completed vs required" badge.
 *  Untagged entries (no courseId — free text, or an Activity Type) aren't
 *  attributable to any subject and are left out entirely. */
export function computeSubjectWeeklyHours(
  timetable: ClassTimetable, electives: ElectiveSchedule, courses: Course[], now: Date = new Date(),
): SubjectWeeklyHours[] {
  const courseById = new Map(courses.map((c) => [c.id, c]))
  const byId = new Map<string, SubjectWeeklyHours>()
  const nowOffset = minutesSinceMonday(now)

  function add(courseId: string | null | undefined, weekday: Weekday, startTime: string, durationMinutes: number) {
    if (!courseId) return
    const dayIndex = WEEKDAYS.indexOf(weekday)
    const startMin = timeStrToMinutes(startTime)
    if (dayIndex < 0 || startMin == null) return
    const slotEndOffset = dayIndex * 24 * 60 + startMin + durationMinutes
    const entry = byId.get(courseId) ?? { courseId, courseTitle: courseById.get(courseId)?.title ?? 'Unknown subject', scheduledMinutes: 0, completedMinutes: 0 }
    entry.scheduledMinutes += durationMinutes
    if (slotEndOffset <= nowOffset) entry.completedMinutes += durationMinutes
    byId.set(courseId, entry)
  }

  for (const d of WEEKDAYS) {
    for (const p of timetable.days[d]?.periods ?? []) add(p.courseId, d, p.startTime, p.durationMinutes)
    for (const s of electives.days[d]?.sessions ?? []) add(s.courseId, d, s.startTime, s.durationMinutes)
  }

  return [...byId.values()].sort((a, b) => a.courseTitle.localeCompare(b.courseTitle))
}
