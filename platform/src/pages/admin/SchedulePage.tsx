import { useEffect, useState, type FormEvent } from 'react'
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { mapUserDoc } from '../../lib/userUtils'
import { StudentSelect } from '../../components/StudentSelect'
import { WeekDaySelect, type WeekDayOption } from '../../components/WeekDaySelect'
import { LockIcon } from '../../components/manager/StatIcons'
import type {
  ClassTimetable, DailyPlan, DailyPlanItem, LessonItemType,
  TimetableDay, TimetablePeriod, UserProfile, Weekday,
} from '../../types'

const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Name for the student picker. Staff identify students by name, so the email stays
 * out of the list — it's still shown on the panel header once a student is picked.
 * Legacy docs with no `name` fall back to email, then id, so a row is never blank.
 */
function studentLabel(s: UserProfile): string {
  return s.name || s.email || s.id
}

function todayStr() { return new Date().toISOString().slice(0, 10) }
function formatTime(ms: number) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${String(sec).padStart(2, '0')}s`
}
function itemTypeLabel(t: LessonItemType | string): string {
  if (t === 'concept') return 'Concept'
  if (t === 'custom') return 'Custom'
  return 'Exercise'
}
function itemTypeColors(t: LessonItemType | string): { bg: string; text: string } {
  if (t === 'concept') return { bg: '#ede9fe', text: '#5b21b6' }
  if (t === 'custom') return { bg: '#f3f4f6', text: '#374151' }
  return { bg: '#dcfce7', text: '#166534' }
}
function timeStrToMinutes(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const hh = Number(m[1]); const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}
function minutesToTimeStr(min: number): string {
  const m = ((min % (24 * 60)) + (24 * 60)) % (24 * 60)
  const hh = Math.floor(m / 60)
  const mm = m % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
function formatClockLabel(min: number): string {
  const h = Math.floor(min / 60); const m = min % 60
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${display} ${period}` : `${display}:${String(m).padStart(2, '0')} ${period}`
}

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
function formatHourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display} ${period}`
}

/** Rainbow-bright, one hue per weekday — reads as a kid-friendly weekly chart. */
const DAY_COLORS: Record<Weekday, { bg: string; text: string }> = {
  Mon: { bg: '#ffe3e3', text: '#e03131' },
  Tue: { bg: '#ffe8cc', text: '#e8590c' },
  Wed: { bg: '#fff3bf', text: '#f08c00' },
  Thu: { bg: '#d3f9d8', text: '#2b8a3e' },
  Fri: { bg: '#d0ebff', text: '#1971c2' },
  Sat: { bg: '#e5dbff', text: '#7048e8' },
}

const PERIOD_COLOR = { bg: '#c3fae8', text: '#087f5b' }
const ROW_PX = 64
const SLOTS_PER_HOUR = 4
const DEFAULT_MIN_HOUR = 7
const DEFAULT_MAX_HOUR = 21

// ─── Shared class timetable helpers ────────────────────────────────────────────

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

interface TimedPeriod { period: TimetablePeriod; startMin: number; endMin: number }

function timedPeriodsOf(day: TimetableDay): TimedPeriod[] {
  return day.periods.map((period) => {
    const startMin = timeStrToMinutes(period.startTime) ?? 0
    return { period, startMin, endMin: startMin + period.durationMinutes }
  })
}

function overlapsAny(startMin: number, endMin: number, timed: TimedPeriod[], excludePeriodId?: string): TimetablePeriod | null {
  for (const t of timed) {
    if (t.period.id === excludePeriodId) continue
    if (startMin < t.endMin && t.startMin < endMin) return t.period
  }
  return null
}

interface Gap { startMin: number; endMin: number }

/**
 * Open/flexible time left in the schedule's own window (e.g. 10:00–18:00) once that
 * day's periods are carved out — each gap's `startMin` is, by construction, exactly
 * the end of the period right before it (or the window start if it's the first gap
 * of the day), and `endMin` is exactly the start of the next period (or the window
 * end). That's what makes a gap's own bounds the correct auto-fill defaults.
 */
function computeGaps(windowStartMin: number, windowEndMin: number, timed: TimedPeriod[]): Gap[] {
  const sorted = [...timed].sort((a, b) => a.startMin - b.startMin)
  const gaps: Gap[] = []
  let cursor = windowStartMin
  for (const t of sorted) {
    const start = Math.max(t.startMin, windowStartMin)
    const end = Math.min(t.endMin, windowEndMin)
    if (start > cursor) gaps.push({ startMin: cursor, endMin: Math.min(start, windowEndMin) })
    cursor = Math.max(cursor, end)
  }
  if (cursor < windowEndMin) gaps.push({ startMin: cursor, endMin: windowEndMin })
  return gaps.filter((g) => g.endMin > g.startMin)
}

// ─── Student daily-plan ("diary") helpers ──────────────────────────────────────

interface TimedItem { item: DailyPlanItem; startMin: number; endMin: number }

function timedItemsOf(plan: DailyPlan | null | undefined): TimedItem[] {
  const planStartMin = plan?.startTime ? timeStrToMinutes(plan.startTime) : null
  if (!plan || planStartMin == null) return []
  return plan.items.map((item, idx) => {
    const startMin = planStartMin + plan.items.slice(0, idx).reduce((s, it) => s + (it.plannedMinutes ?? 0), 0)
    return { item, startMin, endMin: startMin + (item.plannedMinutes ?? 0) }
  })
}

type ModalState =
  | { mode: 'add'; day: Weekday; title: string; startTime: string; durationMinutes: number }
  | { mode: 'edit'; day: Weekday; periodId: string; title: string; startTime: string; durationMinutes: number }

const DURATION_PRESETS = [30, 45, 60]

/**
 * One grid, two modes, picked by the student dropdown:
 *  - No student selected → "edit mode": the shared class timetable (one mandatory
 *    weekly schedule for everyone) in full color, clickable — click an empty slot
 *    to add a period, click a period to edit/delete it.
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
  const [saving, setSaving] = useState(false)

  const [error, setError] = useState('')

  const [modal, setModal] = useState<ModalState | null>(null)
  const [modalError, setModalError] = useState('')

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

  function updateWindow(patch: Partial<Pick<ClassTimetable, 'windowStart' | 'windowEnd'>>) {
    if (!timetable) return
    void saveTimetable({ ...timetable, ...patch })
  }

  /**
   * `startMin` is the gap's own start (= end of the previous period that day, or the
   * schedule's start time if there isn't one yet — see `computeGaps`). `gapMinutes`
   * is how much open time is actually there; the suggested duration fills all of it,
   * capped to the duration field's own 5–240 min range.
   */
  function openAddModal(day: Weekday, startMin: number, gapMinutes: number) {
    setModalError('')
    setModal({ mode: 'add', day, title: '', startTime: minutesToTimeStr(startMin), durationMinutes: Math.max(5, Math.min(240, gapMinutes)) })
  }
  function openEditModal(day: Weekday, period: TimetablePeriod) {
    setModalError('')
    setModal({ mode: 'edit', day, periodId: period.id, title: period.title, startTime: period.startTime, durationMinutes: period.durationMinutes })
  }
  function closeModal() { setModal(null); setModalError('') }

  function submitModal(e: FormEvent) {
    e.preventDefault()
    if (!modal || !timetable) return
    const title = modal.title.trim()
    if (!title) { setModalError('Title is required.'); return }
    const startMin = timeStrToMinutes(modal.startTime)
    if (startMin == null) { setModalError('Enter a valid start time.'); return }
    if (!Number.isFinite(modal.durationMinutes) || modal.durationMinutes < 5) { setModalError('Duration must be at least 5 minutes.'); return }
    const endMin = startMin + modal.durationMinutes

    const day = timetable.days[modal.day]
    const timed = timedPeriodsOf(day)
    const clash = overlapsAny(startMin, endMin, timed, modal.mode === 'edit' ? modal.periodId : undefined)
    if (clash) { setModalError(`Overlaps "${clash.title}" (${minutesToTimeStr(timeStrToMinutes(clash.startTime) ?? 0)}–${minutesToTimeStr((timeStrToMinutes(clash.startTime) ?? 0) + clash.durationMinutes)}).`); return }

    const nextPeriods = modal.mode === 'add'
      ? [...day.periods, { id: crypto.randomUUID(), title, startTime: modal.startTime, durationMinutes: modal.durationMinutes }]
      : day.periods.map((p) => (p.id === modal.periodId ? { ...p, title, startTime: modal.startTime, durationMinutes: modal.durationMinutes } : p))

    void saveTimetable({ ...timetable, days: { ...timetable.days, [modal.day]: { periods: nextPeriods } } })
    closeModal()
  }

  function deleteModalPeriod() {
    if (!modal || modal.mode !== 'edit' || !timetable) return
    if (!window.confirm('Delete this period?')) return
    const day = timetable.days[modal.day]
    void saveTimetable({ ...timetable, days: { ...timetable.days, [modal.day]: { periods: day.periods.filter((p) => p.id !== modal.periodId) } } })
    closeModal()
  }

  if (loadingTimetable || !timetable) return <p className="muted">Loading…</p>

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

  // ─── Grid bounds: the shared schedule's window, widened to the old Diary default
  // (7 AM–9 PM) once a student is selected (logged activities can fall outside school
  // hours), then expanded further to fit whatever's actually there — same defensive
  // technique both source pages already used. ──────────────────────────────────────
  const windowStartMin = timeStrToMinutes(timetable.windowStart) ?? 10 * 60
  const windowEndMin = timeStrToMinutes(timetable.windowEnd) ?? 18 * 60
  let minHour = editingAllowed ? Math.floor(windowStartMin / 60) : Math.min(DEFAULT_MIN_HOUR, Math.floor(windowStartMin / 60))
  let maxHour = editingAllowed ? Math.ceil(windowEndMin / 60) - 1 : Math.max(DEFAULT_MAX_HOUR, Math.ceil(windowEndMin / 60) - 1)

  const timedByDay = {} as Record<Weekday, TimedPeriod[]>
  for (const d of WEEKDAYS) {
    const timed = timedPeriodsOf(timetable.days[d])
    timedByDay[d] = timed
    for (const t of timed) {
      minHour = Math.min(minHour, Math.floor(t.startMin / 60))
      maxHour = Math.max(maxHour, Math.floor((t.endMin - 1) / 60))
    }
  }
  const timedByDate: Record<string, TimedItem[]> = {}
  if (!editingAllowed) {
    for (const d of weekDates) {
      const timed = timedItemsOf(weekPlans[d])
      timedByDate[d] = timed
      for (const t of timed) {
        minHour = Math.min(minHour, Math.floor(t.startMin / 60))
        maxHour = Math.max(maxHour, Math.floor((t.endMin - 1) / 60))
      }
    }
  }

  const hours = Array.from({ length: Math.max(1, maxHour - minHour + 1) }, (_, i) => minHour + i)
  const gridTopMin = minHour * 60
  const totalSlots = hours.length * SLOTS_PER_HOUR
  const slotMin = 60 / SLOTS_PER_HOUR

  // Which hours each day has ANY shared-schedule period touching — those hours don't
  // get an "add" button in edit mode, since the period's own card occupies that space.
  const touchedHours = {} as Record<Weekday, Set<number>>
  for (const d of WEEKDAYS) {
    const set = new Set<number>()
    for (const t of timedByDay[d]) {
      for (let h = Math.floor(t.startMin / 60); h <= Math.floor((t.endMin - 1) / 60); h++) set.add(h)
    }
    touchedHours[d] = set
  }

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
            <span className="muted small">(default view only — periods can be any time, the grid expands to fit)</span>
            <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              Start
              <input type="time" className="date-picker" value={timetable.windowStart} onChange={(e) => updateWindow({ windowStart: e.target.value })} />
            </label>
            <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              End
              <input type="time" className="date-picker" value={timetable.windowEnd} onChange={(e) => updateWindow({ windowEnd: e.target.value })} />
            </label>
            {saving ? <span className="muted small">Saving…</span> : null}
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
          ? 'Click an empty slot to add a mandatory period. Click an existing period to edit or remove it. The faded blocks are the shared class schedule — pick a student above to see their actual logged activities on top of it.'
          : !loadingPlans && !hasAnyEntry
            ? `No entries logged this week for ${selectedStudent?.name ?? 'this student'}.`
            : `Showing ${selectedStudent?.name ?? 'this student'}'s logged activities (bright cards) over the shared class schedule (faded, read-only here).`}
      </p>
      {!editingAllowed && noStartTimeDays.length > 0 && (
        <p className="muted small" style={{ margin: '0 0 0.75rem' }}>
          ⚠ No start time logged: {noStartTimeDays.map(formatDayDate).join(', ')}.
        </p>
      )}

      <div className="timetable-grid-wrap">
        <div
          className="timetable-grid"
          style={{ gridTemplateColumns: `72px repeat(${WEEKDAYS.length}, minmax(130px, 1fr))`, gridTemplateRows: `auto repeat(${totalSlots}, ${ROW_PX / SLOTS_PER_HOUR}px)` }}
        >
          <div className="timetable-grid-corner" style={{ gridColumn: 1, gridRow: 1 }} />
          {WEEKDAYS.map((d, di) => {
            const colors = DAY_COLORS[d]
            return (
              <div key={d} className="timetable-grid-day-header" style={{ gridColumn: di + 2, gridRow: 1, background: colors.bg, color: colors.text }}>
                {d}
              </div>
            )
          })}

          {hours.map((h, hi) => (
            <div key={`t_${h}`} className="timetable-grid-time-cell" style={{ gridColumn: 1, gridRow: `${2 + hi * SLOTS_PER_HOUR} / span ${SLOTS_PER_HOUR}` }}>
              <span className="timetable-grid-time-tag">{formatHourLabel(h)}</span>
            </div>
          ))}

          {/* Empty-slot "add" button — edit mode only, one per hour with no period touching it. */}
          {editingAllowed && hours.map((h, hi) =>
            WEEKDAYS.map((d, di) => {
              if (touchedHours[d].has(h)) return null
              return (
                <button
                  key={`${d}_${h}`}
                  type="button"
                  className="timetable-grid-cell"
                  style={{ gridColumn: di + 2, gridRow: `${2 + hi * SLOTS_PER_HOUR} / span ${SLOTS_PER_HOUR}` }}
                  onClick={() => openAddModal(d, h)}
                  aria-label={`Add period — ${d} ${formatHourLabel(h)}`}
                >
                  <span className="timetable-grid-cell-plus" aria-hidden>＋</span>
                </button>
              )
            }),
          )}

          {/* Shared schedule periods — clickable cards in edit mode, faded backdrop in view mode. */}
          {WEEKDAYS.map((d, di) =>
            timedByDay[d].map(({ period, startMin, endMin }) => {
              const startSlot = Math.round((startMin - gridTopMin) / slotMin)
              const span = Math.max(1, Math.round((endMin - startMin) / slotMin))
              const gridPos = { gridColumn: di + 2, gridRow: `${2 + startSlot} / span ${span}` }
              if (editingAllowed) {
                return (
                  <button
                    key={period.id}
                    type="button"
                    className="timetable-grid-card"
                    style={{ ...gridPos, background: PERIOD_COLOR.bg, borderLeftColor: PERIOD_COLOR.text, color: PERIOD_COLOR.text }}
                    onClick={() => openEditModal(d, period)}
                  >
                    <span className="timetable-grid-card-lock"><LockIcon color={PERIOD_COLOR.text} />School period</span>
                    <strong className="timetable-grid-card-title">{period.title}</strong>
                    <span className="timetable-grid-card-meta">{minutesToTimeStr(startMin)}–{minutesToTimeStr(endMin)}</span>
                  </button>
                )
              }
              return (
                <div
                  key={period.id}
                  className="timetable-grid-card ghost"
                  style={{ ...gridPos, background: PERIOD_COLOR.bg, borderLeftColor: PERIOD_COLOR.text, color: PERIOD_COLOR.text }}
                >
                  <span className="timetable-grid-card-lock"><LockIcon color={PERIOD_COLOR.text} />School period</span>
                  <strong className="timetable-grid-card-title">{period.title}</strong>
                  <span className="timetable-grid-card-meta">{minutesToTimeStr(startMin)}–{minutesToTimeStr(endMin)}</span>
                </div>
              )
            }),
          )}

          {/* Student's logged activities — view mode only, layered on top of the schedule. */}
          {!editingAllowed && weekDates.map((d, di) =>
            (timedByDate[d] ?? []).map(({ item, startMin, endMin }) => {
              const colors = itemTypeColors(item.activityType)
              const overTime = item.timeSpentMs > item.plannedMinutes * 60000
              const startSlot = Math.round((startMin - gridTopMin) / slotMin)
              const span = Math.max(1, Math.round((endMin - startMin) / slotMin))
              return (
                <div
                  key={item.id}
                  className="timetable-grid-card"
                  style={{
                    gridColumn: di + 2, gridRow: `${2 + startSlot} / span ${span}`,
                    background: colors.bg, borderLeftColor: colors.text, color: colors.text,
                    opacity: item.done ? 0.65 : 1,
                  }}
                >
                  <div className="timetable-grid-card-head">
                    <span className="tag" style={{ background: 'rgba(255,255,255,0.6)', color: colors.text, border: 'none', fontSize: '0.65rem' }}>
                      {itemTypeLabel(item.activityType)}
                    </span>
                    {item.done ? <span aria-hidden>✓</span> : null}
                  </div>
                  <strong className="timetable-grid-card-title" style={{ textDecoration: item.done ? 'line-through' : 'none' }}>
                    {item.activityTitle}
                  </strong>
                  <span className="timetable-grid-card-meta">
                    {minutesToTimeStr(startMin)}–{minutesToTimeStr(endMin)} · {formatTime(item.timeSpentMs)}
                    {overTime ? ' ⚠' : ''}
                  </span>
                </div>
              )
            }),
          )}
        </div>
      </div>

      {modal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem' }}>{modal.mode === 'add' ? `Add period — ${modal.day}` : `Edit period — ${modal.day}`}</h3>
            <form className="form" onSubmit={submitModal}>
              <label>Start time<input type="time" value={modal.startTime} onChange={(e) => setModal({ ...modal, startTime: e.target.value })} required autoFocus /></label>
              <label>Title<input value={modal.title} onChange={(e) => setModal({ ...modal, title: e.target.value })} placeholder="e.g. Math" required /></label>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.35rem' }}>Duration</div>
                <div className="row" style={{ marginBottom: '0.5rem' }}>
                  {DURATION_PRESETS.map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      className={`btn small ${modal.durationMinutes === mins ? 'primary' : 'secondary'}`}
                      onClick={() => setModal({ ...modal, durationMinutes: mins })}
                    >
                      {mins < 60 ? `${mins} mins` : `${mins / 60} hour${mins > 60 ? 's' : ''}`}
                    </button>
                  ))}
                </div>
                <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  Custom (minutes)
                  <input
                    type="number" min={5} max={240} step={5}
                    value={modal.durationMinutes}
                    onChange={(e) => setModal({ ...modal, durationMinutes: Number(e.target.value) })}
                    style={{ width: 90 }}
                  />
                </label>
              </div>
              {timeStrToMinutes(modal.startTime) != null && (
                <p className="muted small" style={{ margin: 0 }}>
                  Ends at <strong style={{ color: 'var(--text)' }}>{formatClockLabel((timeStrToMinutes(modal.startTime) ?? 0) + modal.durationMinutes)}</strong>
                </p>
              )}
              {modalError ? <p className="error" style={{ margin: 0 }}>⚠ {modalError}</p> : null}
              <div className="row">
                <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                <button type="button" className="btn secondary" onClick={closeModal}>Cancel</button>
                {modal.mode === 'edit' && (
                  <button type="button" className="btn secondary" style={{ color: 'var(--danger)', marginLeft: 'auto' }} onClick={deleteModalPeriod}>Delete</button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
