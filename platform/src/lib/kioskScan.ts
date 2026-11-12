import { doc, getDoc, type Firestore } from 'firebase/firestore'
import { normalizeElectives, normalizeTimetable } from '../components/manager/schedulerShared'
import { todaysPeriods, buildTimedPeriods, type TimedPeriod } from './attendance'
import type { ClassTimetable, ElectiveSchedule, TimetablePeriod, Weekday } from '../types'

/**
 * Pulls `studentId`/`qrToken` out of whatever a decoded QR payload turns out
 * to be — the same `/scan/:studentId/:qrToken` path every printed ID card
 * already encodes (see `lib/idCard.ts`), whether the scanner handed back a
 * bare path or a full URL.
 */
export function parseScanQr(text: string): { studentId: string; qrToken: string } | null {
  const match = /\/scan\/([^/?#]+)\/([^/?#]+)/.exec(text.trim())
  if (!match) return null
  const studentId = decodeURIComponent(match[1]!)
  const qrToken = decodeURIComponent(match[2]!)
  return studentId && qrToken ? { studentId, qrToken } : null
}

/**
 * One scanned student's own day — a staff/self-saved override
 * (`student_timetables`/`student_electives`, same docs the Schedule page and
 * the student's own Timetable view read) wins over the campus-wide schedule
 * already loaded by the kiosk, exactly like `ScanPage`'s own phone-scan flow.
 */
export async function loadPersonalizedDay(
  kioskDb: Firestore, studentId: string, weekday: Weekday,
  fallbackTimetable: ClassTimetable, fallbackElectives: ElectiveSchedule,
): Promise<{ periods: TimetablePeriod[]; timed: TimedPeriod[] }> {
  const [overrideTimetableSnap, overrideElectivesSnap] = await Promise.all([
    getDoc(doc(kioskDb, 'student_timetables', studentId)),
    getDoc(doc(kioskDb, 'student_electives', studentId)),
  ])
  const timetable = overrideTimetableSnap.exists() ? normalizeTimetable(overrideTimetableSnap.data()) : fallbackTimetable
  const electives = overrideElectivesSnap.exists() ? normalizeElectives(overrideElectivesSnap.data()) : fallbackElectives

  const periods = todaysPeriods(timetable, weekday)
  const sessions = electives.days[weekday]?.sessions ?? []
  return { periods, timed: buildTimedPeriods(periods, sessions) }
}
