/**
 * Constants and pure helpers shared between `<PriorityScheduler />` and the pages
 * that load its data (`SchedulePage`, `StudentTimetableView`). Kept out of
 * `PriorityScheduler.tsx` itself — a component file may only export components, or
 * Fast Refresh stops working for it.
 */
import type { ClassTimetable, ElectiveSchedule, Weekday } from '../../types'

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
