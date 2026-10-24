import { useEffect, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { LandscapePrompt } from '../../components/LandscapePrompt'
import { LandscapeExitButton } from '../../components/LandscapeExitButton'
import { useLandscapeFullscreen } from '../../hooks/useLandscapeFullscreen'
import { PriorityScheduler } from '../../components/manager/PriorityScheduler'
import {
  todayStr, addDays, mondayOf,
  createDefaultTimetable, normalizeTimetable, createDefaultElectives, normalizeElectives,
} from '../../components/manager/schedulerShared'
import type { ClassTimetable, DailyPlan, DailyPlanItem, ElectiveSchedule, Weekday } from '../../types'

const JS_DAY_TO_WEEKDAY: (Weekday | null)[] = [null, 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface StudentTimetableViewProps {
  /** Overrides the signed-in user — lets the manager's Student Preview tool reuse
   *  this exact view for any student, not just "myself". */
  studentId?: string
}

/**
 * A student's own Timetable — defaults to "Today", a single-row grid (real hour
 * columns, same as the full week view) rather than a flat agenda list, so an empty
 * day still shows the actual time slots and every slot — filled or empty — is a
 * real `<PriorityScheduler />` cell. Clicking an empty one opens the same "add a
 * class" flow the manager's own Schedule editor uses; it writes straight to the
 * one shared `class_timetable`/`elective_sessions` doc, same as a manager's edit.
 * A toggle switches to the full Mon–Sat grid. Used both by a signed-in student's
 * own Timetable popup and by the manager's Student Preview tool (via `studentId`).
 */
export function StudentTimetableView({ studentId }: StudentTimetableViewProps = {}) {
  const { promptVisible, isLandscapeFullscreen, useCssRotate, enterLandscape, dismissPrompt, exitLandscape } = useLandscapeFullscreen()
  const { firebaseUser } = useAuth()
  const uid = studentId ?? firebaseUser?.uid

  const [mode, setMode] = useState<'today' | 'week'>('today')
  const [timetable, setTimetable] = useState<ClassTimetable | null>(null)
  const [electives, setElectives] = useState<ElectiveSchedule | null>(null)
  // This student's own override, if staff (or the student themself, once one
  // exists) have ever saved one — shown instead of the shared master when present.
  const [timetableOverride, setTimetableOverride] = useState<ClassTimetable | null>(null)
  const [electiveOverride, setElectiveOverride] = useState<ElectiveSchedule | null>(null)
  const [hasOverride, setHasOverride] = useState(false)
  const [weekPlans, setWeekPlans] = useState<Record<string, DailyPlan | null>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const weekStart = mondayOf(todayStr())
  const weekDates = Array.from({ length: 6 }, (_, i) => addDays(weekStart, i))
  // No Sunday column on the grid — see SchedulePage's own `noScheduleToday` guard
  // for the same edge case on the manager side.
  const todayWeekday = JS_DAY_TO_WEEKDAY[new Date().getDay()]

  useEffect(() => {
    if (!uid) return
    void (async () => {
      try {
        const [timetableSnap, electivesSnap, overrideTimetableSnap, overrideElectivesSnap, ...planSnaps] = await Promise.all([
          getDoc(doc(db, 'class_timetable', 'master')),
          getDoc(doc(db, 'elective_sessions', 'master')),
          getDoc(doc(db, 'student_timetables', uid)),
          getDoc(doc(db, 'student_electives', uid)),
          ...weekDates.map((d) => getDoc(doc(db, 'student_daily_plans', `${uid}_${d}`))),
        ])
        setTimetable(normalizeTimetable(timetableSnap.exists() ? timetableSnap.data() : undefined))
        setElectives(normalizeElectives(electivesSnap.exists() ? electivesSnap.data() : undefined))
        setHasOverride(overrideTimetableSnap.exists() || overrideElectivesSnap.exists())
        setTimetableOverride(overrideTimetableSnap.exists() ? normalizeTimetable(overrideTimetableSnap.data()) : null)
        setElectiveOverride(overrideElectivesSnap.exists() ? normalizeElectives(overrideElectivesSnap.data()) : null)

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
        setError(e instanceof Error ? e.message : 'Failed to load the schedule')
        setTimetable(createDefaultTimetable())
        setElectives(createDefaultElectives())
      } finally {
        setLoading(false)
      }
    })()
    // weekDates is derived fresh from today() each render but is stable in value for
    // the current week, so keying off weekStart/uid (not the array) avoids refetching every render.
  }, [uid, weekStart]) // eslint-disable-line react-hooks/exhaustive-deps

  // A student without an override still books straight into the shared master
  // doc, same as always. One with a staff-set (or self-forked) override keeps
  // writing to that instead — writing to master would be invisible to them,
  // since the override is what they're actually shown below.
  async function saveTimetable(next: ClassTimetable) {
    if (!uid) return
    setSaving(true); setError('')
    if (hasOverride) setTimetableOverride(next); else setTimetable(next) // optimistic
    try {
      await setDoc(doc(db, hasOverride ? 'student_timetables' : 'class_timetable', hasOverride ? uid : 'master'), next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the class timetable')
    } finally {
      setSaving(false)
    }
  }

  async function saveElectives(next: ElectiveSchedule) {
    if (!uid) return
    setSaving(true); setError('')
    if (hasOverride) setElectiveOverride(next); else setElectives(next)
    try {
      await setDoc(doc(db, hasOverride ? 'student_electives' : 'elective_sessions', hasOverride ? uid : 'master'), next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save elective sessions')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !timetable || !electives) return <p className="muted">Loading…</p>

  const effectiveTimetable = hasOverride ? (timetableOverride ?? timetable) : timetable
  const effectiveElectives = hasOverride ? (electiveOverride ?? electives) : electives

  const content = (
    <div className="schedule-page">
      {promptVisible && <LandscapePrompt onSwitch={enterLandscape} onStay={dismissPrompt} />}
      {isLandscapeFullscreen && <LandscapeExitButton onExit={exitLandscape} />}
      {error ? <p className="error">{error}</p> : null}

      <div className="row" style={{ marginBottom: '1rem' }}>
        <button type="button" className={`btn small ${mode === 'today' ? 'primary' : 'secondary'}`} onClick={() => setMode('today')}>Today</button>
        <button type="button" className={`btn small ${mode === 'week' ? 'primary' : 'secondary'}`} onClick={() => setMode('week')}>Full Week</button>
      </div>

      {mode === 'today' && todayWeekday === null ? (
        <p className="muted" style={{ marginBottom: '0.75rem' }}>
          No school day scheduled for Sunday — switch to <strong>Full Week</strong> or check back tomorrow.
        </p>
      ) : (
        <PriorityScheduler
          timetable={effectiveTimetable}
          electives={effectiveElectives}
          editingAllowed
          saving={saving}
          onSaveTimetable={saveTimetable}
          onSaveElectives={saveElectives}
          weekDates={weekDates}
          weekPlans={weekPlans}
          focusDay={mode === 'today' ? todayWeekday : null}
        />
      )}
    </div>
  )

  // Pure-CSS fallback for browsers (notably iOS Safari) where neither Fullscreen
  // nor orientation.lock actually rotates the device — see useCssRotate's own doc
  // comment. Self-contained wrapper, independent of whatever ancestor layout
  // (plain /schedule route vs. any of the Timetable popups) this ends up inside.
  return useCssRotate ? <div className="landscape-css-rotate-wrap">{content}</div> : content
}
