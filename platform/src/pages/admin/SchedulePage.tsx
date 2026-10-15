import { useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { mapUserDoc } from '../../lib/userUtils'
import { StudentSelect } from '../../components/StudentSelect'
import { WeekDaySelect, type WeekDayOption } from '../../components/WeekDaySelect'
import { PriorityScheduler } from '../../components/manager/PriorityScheduler'
import { WEEKDAYS, DAY_COLORS, timeStrToMinutes, formatTime } from '../../components/manager/schedulerShared'
import type {
  ClassTimetable, DailyPlan, DailyPlanItem, ElectiveSchedule,
  TimetableDay, TimetablePeriod, UserProfile, Weekday,
} from '../../types'

/**
 * Name for the student picker. Staff identify students by name, so the email stays
 * out of the list — it's still shown on the panel header once a student is picked.
 * Legacy docs with no `name` fall back to email, then id, so a row is never blank.
 */
function studentLabel(s: UserProfile): string {
  return s.name || s.email || s.id
}

function todayStr() { return new Date().toISOString().slice(0, 10) }

// ─── Week date helpers (UTC-anchored so day math never drifts with local TZ) ──

function parseDateStr(s: string): Date {
  const [y, mo, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y!, (mo ?? 1) - 1, d ?? 1))
}
function formatDateStr(d: Date): string { return d.toISOString().slice(0, 10) }
function addDays(s: string, days: number): string {
  const d = parseDateStr(s)
  d.setUTCDate(d.getUTCDate() + days)
  return formatDateStr(d)
}
/** Monday of the week containing `s`. */
function mondayOf(s: string): string {
  const d = parseDateStr(s)
  const dow = d.getUTCDay() // 0=Sun..6=Sat
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  return formatDateStr(d)
}
function formatDayName(s: string): string {
  return parseDateStr(s).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}
function formatDayFullName(s: string): string {
  return parseDateStr(s).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}
function formatDayDate(s: string): string {
  return parseDateStr(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
/** Label covers Mon–Sat only — the grid doesn't show Sunday. */
function formatWeekRangeLabel(monday: string): string {
  const saturday = addDays(monday, 5)
  return `${formatDayDate(monday)} – ${formatDayDate(saturday)}, ${parseDateStr(saturday).getUTCFullYear()}`
}

// ─── Shared class timetable (Priority 1) ───────────────────────────────────────

function createDefaultTimetable(): ClassTimetable {
  const days = {} as Record<Weekday, TimetableDay>
  for (const d of WEEKDAYS) days[d] = { periods: [] }
  return { windowStart: '10:00', windowEnd: '18:00', days }
}

/** Defensive merge so a partially-shaped (or missing) Firestore doc never crashes the UI. */
function normalizeTimetable(data: Record<string, unknown> | undefined): ClassTimetable {
  const fallback = createDefaultTimetable()
  if (!data) return fallback
  const rawDays = (data.days as Record<string, unknown>) ?? {}
  const days = {} as Record<Weekday, TimetableDay>
  for (const d of WEEKDAYS) {
    const rd = rawDays[d] as Record<string, unknown> | undefined
    const rawPeriods = Array.isArray(rd?.periods) ? (rd!.periods as Record<string, unknown>[]) : []
    const periods: TimetablePeriod[] = rawPeriods
      .map((p) => ({
        id: typeof p.id === 'string' ? p.id : crypto.randomUUID(),
        title: typeof p.title === 'string' ? p.title : '',
        startTime: typeof p.startTime === 'string' ? p.startTime : '',
        durationMinutes: Number(p.durationMinutes ?? 0),
      }))
      .filter((p) => p.title && timeStrToMinutes(p.startTime) != null && p.durationMinutes > 0)
    days[d] = { periods }
  }
  return {
    windowStart: (data.windowStart as string) ?? fallback.windowStart,
    windowEnd: (data.windowEnd as string) ?? fallback.windowEnd,
    days,
  }
}

// ─── Elective-session board (Priority 2) ───────────────────────────────────────

function createDefaultElectives(): ElectiveSchedule {
  const days = {} as ElectiveSchedule['days']
  for (const d of WEEKDAYS) days[d] = { sessions: [] }
  return { days }
}

/** Same defensive-merge treatment as `normalizeTimetable`, for the sibling collection. */
function normalizeElectives(data: Record<string, unknown> | undefined): ElectiveSchedule {
  const fallback = createDefaultElectives()
  if (!data) return fallback
  const rawDays = (data.days as Record<string, unknown>) ?? {}
  const days = {} as ElectiveSchedule['days']
  for (const d of WEEKDAYS) {
    const rd = rawDays[d] as Record<string, unknown> | undefined
    const rawSessions = Array.isArray(rd?.sessions) ? (rd!.sessions as Record<string, unknown>[]) : []
    const sessions = rawSessions
      .map((s) => ({
        id: typeof s.id === 'string' ? s.id : crypto.randomUUID(),
        title: typeof s.title === 'string' ? s.title : '',
        startTime: typeof s.startTime === 'string' ? s.startTime : '',
        durationMinutes: Number(s.durationMinutes ?? 0),
        mentorName: typeof s.mentorName === 'string' ? s.mentorName : null,
      }))
      .filter((s) => s.title && timeStrToMinutes(s.startTime) != null && s.durationMinutes > 0)
    days[d] = { sessions }
  }
  return { days }
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
export function SchedulePage() {
  const [students, setStudents] = useState<UserProfile[]>([])
  const [loadingStudents, setLoadingStudents] = useState(true)
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [date, setDate] = useState(todayStr())
  const [weekPlans, setWeekPlans] = useState<Record<string, DailyPlan | null>>({})
  const [loadingPlans, setLoadingPlans] = useState(false)

  const [timetable, setTimetable] = useState<ClassTimetable | null>(null)
  const [loadingTimetable, setLoadingTimetable] = useState(true)
  const [electives, setElectives] = useState<ElectiveSchedule | null>(null)
  const [loadingElectives, setLoadingElectives] = useState(true)
  const [saving, setSaving] = useState(false)

  const [error, setError] = useState('')

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

  const allItems = editingAllowed ? [] : weekDates.flatMap((d) => weekPlans[d]?.items ?? [])
  const totalItems = allItems.length
  const doneItems = allItems.filter((i) => i.done).length
  const pct = totalItems === 0 ? 0 : Math.round((doneItems / totalItems) * 100)
  const totalPlannedMin = allItems.reduce((s, i) => s + i.plannedMinutes, 0)
  const totalSpentMs = allItems.reduce((s, i) => s + i.timeSpentMs, 0)
  const hasAnyEntry = weekDates.some((d) => weekPlans[d] != null)
  const noStartTimeDays = weekDates.filter((d) => {
    const p = weekPlans[d]
    return !!p && p.items.length > 0 && !p.startTime
  })

  return (
    <div className="kid-theme">
      <div className="diary-toolbar">
        <h1 style={{ margin: 0 }}>🗓️ Schedule</h1>
        <div className="diary-toolbar-controls">
          <StudentSelect students={studentOptions} value={selectedStudentId} onChange={setSelectedStudentId} loading={loadingStudents} />
          {!editingAllowed && <>
            <div className="diary-week-nav">
              <button type="button" className="btn small ghost" onClick={() => setDate(addDays(weekStart, -7))} aria-label="Previous week">‹</button>
              <span className="muted small diary-week-label">{formatWeekRangeLabel(weekStart)}</span>
              <button type="button" className="btn small ghost" onClick={() => setDate(addDays(weekStart, 7))} aria-label="Next week">›</button>
            </div>
            <WeekDaySelect options={dayOptions} value={date} onChange={setDate} />
            <input type="date" className="date-picker" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Jump to date" />
          </>}
        </div>
      </div>

      {editingAllowed && (
        <div className="panel" style={{ marginBottom: '1.25rem' }}>
          <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <strong style={{ fontSize: '0.88rem' }}>Grid time range</strong>
            <span className="muted small">(default view only — periods and electives can be any time, the grid expands to fit)</span>
            <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              Start
              <input type="time" className="date-picker" value={timetable.windowStart} onChange={(e) => updateWindow({ windowStart: e.target.value })} />
            </label>
            <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              End
              <input type="time" className="date-picker" value={timetable.windowEnd} onChange={(e) => updateWindow({ windowEnd: e.target.value })} />
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

      <p className="muted" style={{ marginBottom: '0.75rem' }}>
        {editingAllowed
          ? 'Green, locked blocks are mandatory school periods — add one with the button below. The lighter, open slots are free: click one to book an elective session there, with an end time calculated for you. Pick a student above to see their actual logged activities on top of this schedule.'
          : !loadingPlans && !hasAnyEntry
            ? `No entries logged this week for ${selectedStudent?.name ?? 'this student'}.`
            : `Showing ${selectedStudent?.name ?? 'this student'}'s logged activities (bright cards) over the shared schedule (faded, read-only here).`}
      </p>
      {!editingAllowed && noStartTimeDays.length > 0 && (
        <p className="muted small" style={{ margin: '0 0 0.75rem' }}>
          ⚠ No start time logged: {noStartTimeDays.map(formatDayDate).join(', ')}.
        </p>
      )}

      <PriorityScheduler
        timetable={timetable}
        electives={electives}
        editingAllowed={editingAllowed}
        saving={saving}
        onSaveTimetable={saveTimetable}
        onSaveElectives={saveElectives}
        weekDates={weekDates}
        weekPlans={weekPlans}
      />
    </div>
  )
}
