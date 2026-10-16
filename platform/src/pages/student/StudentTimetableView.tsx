import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { PriorityScheduler } from '../../components/manager/PriorityScheduler'
import {
  todayStr, addDays, mondayOf,
  createDefaultTimetable, normalizeTimetable, createDefaultElectives, normalizeElectives,
} from '../../components/manager/schedulerShared'
import type { ClassTimetable, DailyPlan, DailyPlanItem, ElectiveSchedule } from '../../types'

/**
 * A student's own read-only view of the shared weekly class timetable + elective
 * board, with their own logged daily-plan activities layered on top — exactly the
 * "diary" view a manager already sees when picking a student in `SchedulePage`,
 * just pointed at the signed-in student instead. `PriorityScheduler` itself needs
 * no changes: every edit affordance is already gated behind `editingAllowed`.
 */
export function StudentTimetableView() {
  const { firebaseUser } = useAuth()
  const uid = firebaseUser?.uid

  const [timetable, setTimetable] = useState<ClassTimetable | null>(null)
  const [electives, setElectives] = useState<ElectiveSchedule | null>(null)
  const [weekPlans, setWeekPlans] = useState<Record<string, DailyPlan | null>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const weekStart = mondayOf(todayStr())
  const weekDates = Array.from({ length: 6 }, (_, i) => addDays(weekStart, i))

  useEffect(() => {
    if (!uid) return
    void (async () => {
      try {
        const [timetableSnap, electivesSnap, ...planSnaps] = await Promise.all([
          getDoc(doc(db, 'class_timetable', 'master')),
          getDoc(doc(db, 'elective_sessions', 'master')),
          ...weekDates.map((d) => getDoc(doc(db, 'student_daily_plans', `${uid}_${d}`))),
        ])
        setTimetable(normalizeTimetable(timetableSnap.exists() ? timetableSnap.data() : undefined))
        setElectives(normalizeElectives(electivesSnap.exists() ? electivesSnap.data() : undefined))

        const map: Record<string, DailyPlan | null> = {}
        planSnaps.forEach((snap, i) => {
          const d = weekDates[i]!
          if (snap.exists()) {
            const x = snap.data()
            map[d] = {
              id: snap.id,
              studentId: (x.studentId as string) ?? uid,
              date: (x.date as string) ?? d,
              items: (x.items as DailyPlanItem[]) ?? [],
            }
          } else {
            map[d] = null
          }
        })
        setWeekPlans(map)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load your schedule')
        setTimetable(createDefaultTimetable())
        setElectives(createDefaultElectives())
      } finally {
        setLoading(false)
      }
    })()
    // weekDates is derived fresh from today() each render but is stable in value for
    // the current week, so keying off weekStart (not the array) avoids refetching every render.
  }, [uid, weekStart]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !timetable || !electives) return <p className="muted">Loading…</p>

  return (
    <div className="schedule-page">
      {error ? <p className="error">{error}</p> : null}
      <PriorityScheduler
        timetable={timetable}
        electives={electives}
        editingAllowed={false}
        saving={false}
        onSaveTimetable={() => {}}
        onSaveElectives={() => {}}
        weekDates={weekDates}
        weekPlans={weekPlans}
      />
    </div>
  )
}
