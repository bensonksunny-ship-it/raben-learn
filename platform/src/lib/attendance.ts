import { timeStrToMinutes } from '../components/manager/schedulerShared'
import type { AttendanceCheckpoint, ClassTimetable, TimetablePeriod, Weekday } from '../types'

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
