export interface AttendanceDay { studentId: string; date: string; late: boolean }

export interface AttendanceRow {
  studentId: string
  name: string
  present: number
  late: number
  absent: number
  /** % of school days present, or null when the month has no school days yet. */
  rate: number | null
}

export interface AttendanceMonth { schoolDays: number; rows: AttendanceRow[] }

/** One row per student for a month's scans. A "school day" is any day at least
 *  one of these students scanned — there's no holiday calendar, so a day with
 *  no scans at all is simply not counted (same rule as the Founder Overview). */
export function computeAttendanceMonth(
  students: readonly { id: string; name: string }[],
  days: readonly AttendanceDay[],
): AttendanceMonth {
  const ids = new Set(students.map((s) => s.id))
  const schoolDays = new Set<string>()
  const presentBy = new Map<string, Set<string>>()
  const lateBy = new Map<string, Set<string>>()
  for (const d of days) {
    if (!ids.has(d.studentId)) continue
    schoolDays.add(d.date)
    if (!presentBy.has(d.studentId)) presentBy.set(d.studentId, new Set())
    presentBy.get(d.studentId)!.add(d.date)
    if (d.late) {
      if (!lateBy.has(d.studentId)) lateBy.set(d.studentId, new Set())
      lateBy.get(d.studentId)!.add(d.date)
    }
  }
  const total = schoolDays.size
  const rows = students.map((s) => {
    const present = presentBy.get(s.id)?.size ?? 0
    return {
      studentId: s.id, name: s.name, present,
      late: lateBy.get(s.id)?.size ?? 0,
      absent: total - present,
      rate: total > 0 ? Math.round((present / total) * 100) : null,
    }
  })
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return { schoolDays: total, rows }
}

/** "YYYY-MM" shifted by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y!, (m ?? 1) - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}

export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y!, (m ?? 1) - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
