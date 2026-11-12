import { addDays, mondayOf } from '../components/manager/schedulerShared'

export interface WeekCount { weekStart: string; count: number }

/** Topics approved per week for the `weeks` weeks ending with the one containing
 *  `today` (oldest first). `approvedAt` are ISO timestamps. */
export function weeklyApprovals(approvedAt: readonly string[], today: string, weeks = 8): WeekCount[] {
  const thisMonday = mondayOf(today)
  const out: WeekCount[] = []
  for (let i = weeks - 1; i >= 0; i--) out.push({ weekStart: addDays(thisMonday, -7 * i), count: 0 })
  const byWeek = new Map(out.map((w) => [w.weekStart, w]))
  for (const at of approvedAt) {
    const w = byWeek.get(mondayOf(at.slice(0, 10)))
    if (w) w.count++
  }
  return out
}

/** How many of `dates` fall in the `days` days ending today. */
export function countRecentDays(dates: readonly string[], today: string, days = 28): number {
  const from = addDays(today, -(days - 1))
  return new Set(dates.filter((d) => d >= from && d <= today)).size
}

export interface ExamResult { courseId: string; submittedAt: string; pct: number }

/** Average % across results, or null when there are none. */
export function averagePct(results: readonly ExamResult[]): number | null {
  if (results.length === 0) return null
  return Math.round(results.reduce((s, r) => s + r.pct, 0) / results.length)
}
