import { collection, doc, getDoc, getDocs, query, where, type Firestore } from 'firebase/firestore'
import { normalizeElectives, normalizeTimetable } from '../components/manager/schedulerShared'
import { todaysPeriods, buildTimedPeriods, type TimedPeriod } from './attendance'
import { readTopicsFromSessionDoc } from './topics'
import { computeStreak } from './streak'
import type { ClassTimetable, ElectiveSchedule, Topic, TimetablePeriod, Weekday } from '../types'

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
): Promise<{ periods: TimetablePeriod[]; timed: TimedPeriod[]; timetable: ClassTimetable; electives: ElectiveSchedule }> {
  const [overrideTimetableSnap, overrideElectivesSnap] = await Promise.all([
    getDoc(doc(kioskDb, 'student_timetables', studentId)),
    getDoc(doc(kioskDb, 'student_electives', studentId)),
  ])
  const timetable = overrideTimetableSnap.exists() ? normalizeTimetable(overrideTimetableSnap.data()) : fallbackTimetable
  const electives = overrideElectivesSnap.exists() ? normalizeElectives(overrideElectivesSnap.data()) : fallbackElectives

  const periods = todaysPeriods(timetable, weekday)
  const sessions = electives.days[weekday]?.sessions ?? []
  // Handed back too — `computeSubjectWeeklyHours` needs this student's own
  // resolved (override-or-shared) week, not just today's slice of it.
  return { periods, timed: buildTimedPeriods(periods, sessions), timetable, electives }
}

/** One subject's topics (first few, for a quick tap-to-preview) plus whether it
 *  has any exam configured — loaded lazily, one course at a time, only once a
 *  student taps that subject's card on their personalized timeline. */
export async function loadCoursePreview(
  kioskDb: Firestore, courseId: string,
): Promise<{ topics: Topic[]; hasExam: boolean }> {
  const [sessionsSnap, examsSnap] = await Promise.all([
    getDocs(query(collection(kioskDb, 'sessions'), where('courseId', '==', courseId))),
    getDocs(collection(kioskDb, 'courses', courseId, 'exams')),
  ])
  const sessions = sessionsSnap.docs
    .map((d) => ({ order: Number(d.data().order ?? 0), topics: readTopicsFromSessionDoc(d.data().activities) }))
    .sort((a, b) => a.order - b.order)
  const topics = sessions.flatMap((s) => s.topics)
  return { topics, hasExam: examsSnap.size > 0 }
}

/** School-days-in-a-row streak for the scanned student — same `computeStreak`
 *  the student's own Dashboard/History and Mentor's progress view use, just
 *  queried through the kiosk's own signed-in session for this one student. */
export async function loadStreak(kioskDb: Firestore, studentId: string, today: string): Promise<number> {
  const snap = await getDocs(query(collection(kioskDb, 'student_daily_plans'), where('studentId', '==', studentId)))
  const kept = new Set<string>()
  snap.forEach((d) => {
    const x = d.data()
    const items = (x.items as { done?: boolean }[] | undefined) ?? []
    if (typeof x.date === 'string' && items.some((i) => i.done)) kept.add(x.date)
  })
  return computeStreak(kept, today)
}
