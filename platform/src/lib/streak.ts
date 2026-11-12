import { addDays, parseDateStr } from '../components/manager/schedulerShared'

/** School days (Mon–Sat) in a row, ending today or the last school day, on which
 *  the student finished at least one plan item. Sundays are skipped, and a today
 *  that isn't done yet doesn't break the run — it just doesn't count so far. */
export function computeStreak(keptDates: ReadonlySet<string>, today: string): number {
  let streak = 0
  let date = today
  // Bounded walk — a streak can't be longer than the kept days we know about.
  for (let i = 0; i <= keptDates.size * 2 + 14; i++, date = addDays(date, -1)) {
    if (parseDateStr(date).getUTCDay() === 0) continue
    if (keptDates.has(date)) streak++
    else if (date !== today) break
  }
  return streak
}
