import { useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { mapUserDoc } from '../../lib/userUtils'
import { mapCourseDoc } from '../../lib/courses'
import { readTopicsFromSessionDoc } from '../../lib/topics'
import { StudentSelect } from '../../components/StudentSelect'
import { WeekDaySelect, type WeekDayOption } from '../../components/WeekDaySelect'
import { LandscapePrompt } from '../../components/LandscapePrompt'
import { useLandscapeFullscreen } from '../../hooks/useLandscapeFullscreen'
import { PriorityScheduler } from '../../components/manager/PriorityScheduler'
import {
  WEEKDAYS, DAY_COLORS, formatTime,
  todayStr, addDays, mondayOf, formatDayName, formatDayFullName, formatDayDate, formatWeekRangeLabel,
  createDefaultTimetable, normalizeTimetable, createDefaultElectives, normalizeElectives,
} from '../../components/manager/schedulerShared'
import type {
  ClassTimetable, Course, DailyPlan, DailyPlanItem, ElectiveSchedule, Session, Topic, UserProfile, Weekday,
} from '../../types'

/**
 * Name for the student picker. Staff identify students by name, so the email stays
 * out of the list — it's still shown on the panel header once a student is picked.
 * Legacy docs with no `name` fall back to email, then id, so a row is never blank.
 */
function studentLabel(s: UserProfile): string {
  return s.name || s.email || s.id
}

/** The grid is Mon–Sat only — no Sunday column — so `formatDayName()`'s own output
 *  ("Sun" included) can't be trusted as a `Weekday` outright. Returns null on a
 *  Sunday date instead of a value the grid has no row for. */
function toWeekday(name: string): Weekday | null {
  return (WEEKDAYS as string[]).includes(name) ? (name as Weekday) : null
}

/**
 * One grid, two modes, picked by the student dropdown:
 *  - No student selected → "edit mode": the shared class timetable (Priority 1,
 *    locked) plus the elective-session board (Priority 2, flexible) — both
 *    clickable, via `<PriorityScheduler />`.
 *  - A student selected → "view mode": that student's actual logged activities
 *    (the old read-only "Diary"), shown as full-color cards layered on top of the
 *    same shared schedule rendered as a faded, non-interactive backdrop. Nothing
 *    is editable in this mode — the two modes are never interactive at once, so
 *    there's never a competing click target.
 * See docs/superpowers/specs/2026-10-15-timetable-planner-design.md for the
 * original Timetable Planner spec this merges with the former StudentDiaryPage.
 */
export function SchedulePage({ initialStudentId = null }: { initialStudentId?: string | null } = {}) {
  const [students, setStudents] = useState<UserProfile[]>([])
  const [loadingStudents, setLoadingStudents] = useState(true)
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(initialStudentId)
  // Student-view only (see `editingAllowed` below) — defaults to "Today", a single
  // day's row on the grid, rather than the full week. The manager's own edit mode
  // always shows the full week (it's one shared schedule, not a per-day thing), so
  // this toggle only ever renders once a student is selected.
  const [weekView, setWeekView] = useState(false)
  const [date, setDate] = useState(todayStr())
  const [weekPlans, setWeekPlans] = useState<Record<string, DailyPlan | null>>({})
  const [loadingPlans, setLoadingPlans] = useState(false)

  const [timetable, setTimetable] = useState<ClassTimetable | null>(null)
  const [loadingTimetable, setLoadingTimetable] = useState(true)
  const [electives, setElectives] = useState<ElectiveSchedule | null>(null)
  const [loadingElectives, setLoadingElectives] = useState(true)
  const [saving, setSaving] = useState(false)

  const [error, setError] = useState('')

  // Syllabus data (Priority 2's "Add elective" title autocomplete draws suggestions
  // from here) — loaded once, independent of the student/week selection above.
  const [syllabusCourses, setSyllabusCourses] = useState<Course[]>([])
  const [syllabusSessions, setSyllabusSessions] = useState<Session[]>([])

  const weekStart = mondayOf(date)
  // Mon–Sat only — no Sunday column. Index-aligned with WEEKDAYS (both start Monday),
  // so weekDates[i] is the real calendar date for WEEKDAYS[i] in the shown week.
  const weekDates = Array.from({ length: 6 }, (_, i) => addDays(weekStart, i))
  const editingAllowed = selectedStudentId == null

  useEffect(() => {
    void (async () => {
      try {
        // Fetch the whole collection and filter with the same `normalizeRoles()` the rest
        // of the app uses (AuthContext, ReportsPage, MentorDashboard) — a Firestore
        // `array-contains` query only matches when `roles` is literally an array, so it
        // silently drops any legacy doc that stores a single string role instead.
        const snap = await getDocs(collection(db, 'users'))
        const list: UserProfile[] = []
        snap.forEach((d) => {
          const profile = mapUserDoc(d)
          if (profile.roles.includes('student')) list.push(profile)
        })
        list.sort((a, b) => a.name.localeCompare(b.name))
        setStudents(list)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load students')
      } finally {
        setLoadingStudents(false)
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'class_timetable', 'master'))
        setTimetable(normalizeTimetable(snap.exists() ? snap.data() : undefined))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load the class timetable')
        setTimetable(createDefaultTimetable())
      } finally {
        setLoadingTimetable(false)
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'elective_sessions', 'master'))
        setElectives(normalizeElectives(snap.exists() ? snap.data() : undefined))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load elective sessions')
        setElectives(createDefaultElectives())
      } finally {
        setLoadingElectives(false)
      }
    })()
  }, [])

  async function loadSyllabus() {
    try {
      const [coursesSnap, sessionsSnap] = await Promise.all([
        getDocs(collection(db, 'courses')),
        getDocs(collection(db, 'sessions')),
      ])
      setSyllabusCourses(coursesSnap.docs.map(mapCourseDoc))
      const sl: Session[] = []
      sessionsSnap.forEach((d) => {
        const x = d.data()
        sl.push({
          id: d.id,
          title: (x.title as string) ?? '',
          subtitle: (x.subtitle as string) ?? '',
          courseId: (x.courseId as string) ?? null,
          courseName: (x.courseName as string) ?? '',
          order: Number(x.order ?? 0),
          activities: readTopicsFromSessionDoc(x.activities),
        })
      })
      setSyllabusSessions(sl)
    } catch {
      // Non-critical — the "Add elective" title field just falls back to free text.
    }
  }

  useEffect(() => { void loadSyllabus() }, [])

  /** Appends one topic to a syllabus session's activity list — used by the "+ Add
   *  activity" quick action inside the "Add elective" modal's title autocomplete,
   *  same write `<SyllabusPage>` itself makes when adding a topic to a session. */
  async function addSyllabusActivity(sessionId: string, topic: Topic) {
    const session = syllabusSessions.find((s) => s.id === sessionId)
    if (!session) return
    const next = [...session.activities, topic]
    await updateDoc(doc(db, 'sessions', sessionId), { activities: next, updatedAt: serverTimestamp() })
    setSyllabusSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, activities: next } : s)))
  }

  useEffect(() => {
    if (!selectedStudentId) { setWeekPlans({}); return }
    void (async () => {
      setLoadingPlans(true); setError('')
      try {
        // Kept as a separate local array (rather than closing over `weekDates`) so it
        // isn't an unstable effect dependency that would refetch on every render.
        const days = Array.from({ length: 6 }, (_, i) => addDays(weekStart, i))
        const snaps = await Promise.all(days.map((d) => getDoc(doc(db, 'student_daily_plans', `${selectedStudentId}_${d}`))))
        const map: Record<string, DailyPlan | null> = {}
        snaps.forEach((snap, i) => {
          const d = days[i]!
          if (snap.exists()) {
            const x = snap.data()
            map[d] = {
              id: snap.id,
              studentId: (x.studentId as string) ?? selectedStudentId,
              date: (x.date as string) ?? d,
              startTime: (x.startTime as string) ?? null,
              items: (x.items as DailyPlanItem[]) ?? [],
            }
          } else {
            map[d] = null
          }
        })
        setWeekPlans(map)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load diary entries')
      } finally {
        setLoadingPlans(false)
      }
    })()
  }, [selectedStudentId, weekStart])

  async function saveTimetable(next: ClassTimetable) {
    setSaving(true); setError('')
    setTimetable(next) // optimistic — the grid should never flicker while saving
    try {
      await setDoc(doc(db, 'class_timetable', 'master'), next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the class timetable')
    } finally {
      setSaving(false)
    }
  }

  async function saveElectives(next: ElectiveSchedule) {
    setSaving(true); setError('')
    setElectives(next) // optimistic, same as saveTimetable
    try {
      await setDoc(doc(db, 'elective_sessions', 'master'), next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save elective sessions')
    } finally {
      setSaving(false)
    }
  }

  function updateWindow(patch: Partial<Pick<ClassTimetable, 'windowStart' | 'windowEnd'>>) {
    if (!timetable) return
    void saveTimetable({ ...timetable, ...patch })
  }

  if (loadingTimetable || loadingElectives || !timetable || !electives) return <p className="muted">Loading…</p>

  const selectedStudent = students.find((s) => s.id === selectedStudentId) ?? null
  const studentOptions = students.map((s) => ({ id: s.id, name: studentLabel(s) }))
  const today = todayStr()
  const dayOptions: WeekDayOption[] = weekDates.map((d) => ({
    date: d,
    dayName: formatDayFullName(d),
    dateLabel: formatDayDate(d),
    color: DAY_COLORS[formatDayName(d) as Weekday] ?? { bg: 'var(--surface-soft)', text: 'var(--text)' },
    isToday: d === today,
  }))

  // Student-view day/week toggle — "Today" (the default) narrows every stat and the
  // grid itself down to just `date`; "Full Week" is the original, unfiltered range.
  const showingSingleDay = !editingAllowed && !weekView
  const focusDay = showingSingleDay ? toWeekday(formatDayName(date)) : null
  // Sunday has no column on the grid at all — nothing to narrow down to, so the
  // day view has nothing to render until the student/staff member picks a real
  // school day (or switches to Full Week).
  const noScheduleToday = showingSingleDay && focusDay === null
  const itemDates = showingSingleDay ? [date] : weekDates

  const allItems = editingAllowed ? [] : itemDates.flatMap((d) => weekPlans[d]?.items ?? [])
  const totalItems = allItems.length
  const doneItems = allItems.filter((i) => i.done).length
  const pct = totalItems === 0 ? 0 : Math.round((doneItems / totalItems) * 100)
  const totalPlannedMin = allItems.reduce((s, i) => s + i.plannedMinutes, 0)
  const totalSpentMs = allItems.reduce((s, i) => s + i.timeSpentMs, 0)
  const hasAnyEntry = itemDates.some((d) => weekPlans[d] != null)
  const noStartTimeDays = itemDates.filter((d) => {
    const p = weekPlans[d]
    return !!p && p.items.length > 0 && !p.startTime
  })

  return (
    <div className="schedule-page">
      <div className="diary-toolbar">
        <h1 style={{ margin: 0 }}>🗓️ Schedule</h1>
        <div className="diary-toolbar-controls">
          <StudentSelect students={studentOptions} value={selectedStudentId} onChange={setSelectedStudentId} loading={loadingStudents} />
          {/* Always visible, not just once a student is picked — the shared schedule
              is the same every week, but staff still want day/date context on screen
              (e.g. to know what "today" is) while authoring it, not just while viewing
              a student's diary. */}
          <div className="diary-week-nav">
            <button type="button" className="btn small ghost" onClick={() => setDate(addDays(weekStart, -7))} aria-label="Previous week">‹</button>
            <span className="muted small diary-week-label">{formatWeekRangeLabel(weekStart)}</span>
            <button type="button" className="btn small ghost" onClick={() => setDate(addDays(weekStart, 7))} aria-label="Next week">›</button>
          </div>
          <WeekDaySelect options={dayOptions} value={date} onChange={setDate} />
          {!editingAllowed && (
            <div className="row" style={{ gap: '0.4rem' }}>
              <button
                type="button"
                className={`btn small ${showingSingleDay ? 'primary' : 'secondary'}`}
                onClick={() => { setWeekView(false); setDate(todayStr()) }}
              >
                Today
              </button>
              <button
                type="button"
                className={`btn small ${showingSingleDay ? 'secondary' : 'primary'}`}
                onClick={() => setWeekView(true)}
              >
                Full Week
              </button>
            </div>
          )}
        </div>
      </div>

      {editingAllowed && (
        <div className="panel" style={{ marginBottom: '1.25rem' }}>
          <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <strong style={{ fontSize: '0.88rem' }}>Grid time range</strong>
            <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              Start
              <input type="time" className="date-picker" min="10:00" max="18:00" value={timetable.windowStart} onChange={(e) => updateWindow({ windowStart: e.target.value })} />
            </label>
            <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              End
              <input type="time" className="date-picker" min="10:00" max="18:00" value={timetable.windowEnd} onChange={(e) => updateWindow({ windowEnd: e.target.value })} />
            </label>
          </div>
        </div>
      )}

      {error ? <p className="error">{error}</p> : null}

      {!editingAllowed && selectedStudent && totalItems > 0 && (
        <div className="planner-stats" style={{ marginBottom: '0.75rem' }}>
          <div className="planner-stat"><span className="planner-stat-value">{doneItems}/{totalItems}</span><span className="muted small">Tasks</span></div>
          <div className="planner-stat"><span className="planner-stat-value">{pct}%</span><span className="muted small">Done</span></div>
          <div className="planner-stat"><span className="planner-stat-value">{totalPlannedMin}m</span><span className="muted small">Planned</span></div>
          <div className="planner-stat"><span className="planner-stat-value">{formatTime(totalSpentMs)}</span><span className="muted small">Spent</span></div>
          <div style={{ flex: 1, minWidth: 120 }}><div className="planner-progress-bar"><div className="planner-progress-fill" style={{ width: `${pct}%` }} /></div></div>
        </div>
      )}

      {!editingAllowed && !loadingPlans && !hasAnyEntry && (
        <p className="muted" style={{ marginBottom: '0.75rem' }}>
          No entries logged {showingSingleDay ? 'today' : 'this week'} for {selectedStudent?.name ?? 'this student'}.
        </p>
      )}
      {!editingAllowed && noStartTimeDays.length > 0 && (
        <p className="muted small" style={{ margin: '0 0 0.75rem' }}>
          ⚠ No start time logged: {noStartTimeDays.map(formatDayDate).join(', ')}.
        </p>
      )}

      {noScheduleToday ? (
        <p className="muted" style={{ marginBottom: '0.75rem' }}>
          No school day scheduled for Sunday — switch to <strong>Full Week</strong> or pick another day above.
        </p>
      ) : (
        <PriorityScheduler
          timetable={timetable}
          electives={electives}
          editingAllowed={editingAllowed}
          saving={saving}
          onSaveTimetable={saveTimetable}
          onSaveElectives={saveElectives}
          weekDates={weekDates}
          weekPlans={weekPlans}
          focusDay={focusDay}
          syllabusCourses={syllabusCourses}
          syllabusSessions={syllabusSessions}
          onAddSyllabusActivity={addSyllabusActivity}
        />
      )}
    </div>
  )
}
