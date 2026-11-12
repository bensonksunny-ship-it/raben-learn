import { timeStrToMinutes } from '../components/manager/schedulerShared'
import type { AttendanceCheckpoint, ClassTimetable, ElectiveSession, TimetablePeriod, Weekday } from '../types'

const JS_DAY_TO_WEEKDAY: (Weekday | null)[] = [null, 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Minutes of grace after a period's (or the day's) own start time before a scan
 *  counts as late. One shared constant — tweak here, not per call site. */
export const GRACE_MINUTES = 5

export function todayWeekday(now: Date = new Date()): Weekday | null {
  return JS_DAY_TO_WEEKDAY[now.getDay()] ?? null
}

/** Today's locked periods, time-sorted — the same list a login, every
 *  in-between scan, and a logout are all checked against. */
export function todaysPeriods(timetable: ClassTimetable, weekday: Weekday): TimetablePeriod[] {
  return [...(timetable.days[weekday]?.periods ?? [])].sort(
    (a, b) => (timeStrToMinutes(a.startTime) ?? 0) - (timeStrToMinutes(b.startTime) ?? 0),
  )
}

export type NextCheckpoint =
  | { kind: 'login'; status: 'on-time' | 'late' }
  | { kind: 'period'; periodId: string; status: 'on-time' | 'late' }
  | { kind: 'logout'; status: 'on-time' | 'late' }

/**
 * The whole "which scan is this?" state machine — one QR scan in, exactly one
 * checkpoint out (or `null` once there's nothing left to record today). Called
 * fresh on every scan with that student's checkpoints so far; never mutates.
 *  1. No `login` yet → this scan is the login, judged against the first period's
 *     start time.
 *  2. Earliest not-yet-checked-in period whose own start time has arrived → this
 *     scan is that period's check-in, judged against *that* period's start time.
 *  3. Every period checked in, no `logout` yet → this scan is the logout
 *     (always "on-time" — there's no "late to leave").
 *  4. Otherwise → `null` ("already checked out for today").
 */
export function determineNextCheckpoint(
  periods: TimetablePeriod[], existing: AttendanceCheckpoint[], now: Date = new Date(),
): NextCheckpoint | null {
  if (periods.length === 0) return null
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const statusFor = (startMin: number): 'on-time' | 'late' => (nowMin <= startMin + GRACE_MINUTES ? 'on-time' : 'late')

  const hasLogin = existing.some((c) => c.kind === 'login')
  if (!hasLogin) {
    return { kind: 'login', status: statusFor(timeStrToMinutes(periods[0]!.startTime) ?? 0) }
  }

  const checkedInPeriodIds = new Set(existing.filter((c) => c.kind === 'period').map((c) => c.periodId))
  for (const period of periods) {
    if (checkedInPeriodIds.has(period.id)) continue
    const startMin = timeStrToMinutes(period.startTime) ?? 0
    if (nowMin < startMin) break // periods are time-sorted — nothing later is due yet either
    return { kind: 'period', periodId: period.id, status: statusFor(startMin) }
  }

  const hasLogout = existing.some((c) => c.kind === 'logout')
  if (!hasLogout) return { kind: 'logout', status: 'on-time' }

  return null
}

/** Display label for one checkpoint — shared by the scan confirmation screen
 *  and the Live Class roster. */
export function checkpointLabel(c: AttendanceCheckpoint, periods: TimetablePeriod[]): string {
  if (c.kind === 'login') return 'Logged in'
  if (c.kind === 'logout') return 'Logged out'
  const idx = periods.findIndex((p) => p.id === c.periodId)
  return idx >= 0 ? `Period ${idx + 1}${periods[idx]?.title ? ` — ${periods[idx]!.title}` : ''}` : 'Period check-in'
}

/** "9:05 AM" from minutes-since-midnight — shared by the Live Class kiosk's
 *  running timetable and a scanned student's own personalized overlay. */
export function formatClock(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** "45 min" / "1 h 5 min" — for countdowns and how-late labels. */
export function formatSpan(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} min`
  return m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/** One block on a running timetable — a locked school period (`label` "P1",
 *  "P2"… matching the roster's attendance columns) or an elective session
 *  (`label` ''), both placed purely by their scheduled clock time. Shared by
 *  the campus-wide Live Class kiosk view and each scanned student's own
 *  personalized overlay. */
export interface TimedPeriod { id: string; title: string; label: string; kind: 'period' | 'elective' | 'exam'; startTime: string; startMin: number; endMin: number }

/** Where the wall clock sits within a day's timetable. */
export type ClockState =
  | { kind: 'none' }
  | { kind: 'before'; next: TimedPeriod }
  | { kind: 'in'; current: TimedPeriod; index: number; next: TimedPeriod | null }
  | { kind: 'break'; next: TimedPeriod }
  | { kind: 'over' }

export function clockState(timed: TimedPeriod[], nowMin: number): ClockState {
  if (timed.length === 0) return { kind: 'none' }
  if (nowMin < timed[0]!.startMin) return { kind: 'before', next: timed[0]! }
  const index = timed.findIndex((t) => nowMin >= t.startMin && nowMin < t.endMin)
  if (index >= 0) return { kind: 'in', current: timed[index]!, index, next: timed[index + 1] ?? null }
  const next = timed.find((t) => t.startMin > nowMin)
  return next ? { kind: 'break', next } : { kind: 'over' }
}

/** Locked periods + elective sessions, merged and sorted by clock time — the
 *  shared shape both the campus-wide kiosk view and a scanned student's own
 *  personalized timeline are built from. Periods are numbered `P1`, `P2`… in
 *  schedule order; electives carry no label. */
export function buildTimedPeriods(periods: TimetablePeriod[], sessions: ElectiveSession[]): TimedPeriod[] {
  const out: TimedPeriod[] = []
  periods.forEach((p, i) => {
    const startMin = timeStrToMinutes(p.startTime)
    if (startMin != null) out.push({ id: p.id, title: p.title, label: `P${i + 1}`, kind: 'period', startTime: p.startTime, startMin, endMin: startMin + p.durationMinutes })
  })
  for (const e of sessions) {
    const startMin = timeStrToMinutes(e.startTime)
    if (startMin == null || !(e.durationMinutes > 0)) continue
    out.push({ id: e.id, title: e.title || 'Open slot', label: '', kind: 'elective', startTime: e.startTime, startMin, endMin: startMin + e.durationMinutes })
  }
  return out.sort((a, b) => a.startMin - b.startMin)
}
