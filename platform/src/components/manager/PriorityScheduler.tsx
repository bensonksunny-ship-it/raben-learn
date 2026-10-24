import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LockIcon, FlexIcon } from './StatIcons'
import { WEEKDAYS, DAY_COLORS, timeStrToMinutes, formatTime } from './schedulerShared'
import type {
  ClassTimetable, Course, DailyPlan, DailyPlanItem, ElectiveSchedule, ElectiveSession,
  LessonItemType, Session, TimetableDay, TimetablePeriod, Topic, TopicType, Weekday,
} from '../../types'

/** Priority 1 — locked school periods (green, matches LockIcon). */
const PERIOD_COLOR = { bg: '#c3fae8', text: '#087f5b' }
/** Priority 2 — elective sessions (sky blue, matches FlexIcon) — deliberately a
 *  different hue from PERIOD_COLOR so the two priorities read apart on sight. */
const ELECTIVE_COLOR = { bg: '#d0ebff', text: '#1971c2' }

/** Width of one 15-minute column — hours run left→right now, days top→bottom, so a
 *  day reads as one long horizontal strip ("lengthier" view of how its day flows). */
const SLOT_PX = 26
/** Height of one day's row. */
const DAY_ROW_PX = 80
const DAY_LABEL_COL_PX = 88
const SLOTS_PER_HOUR = 4
/** Operational hours — the grid always renders exactly this range, never wider. */
const GRID_START_MIN = 10 * 60
const GRID_END_MIN = 18 * 60
const DURATION_PRESETS = [30, 45, 60]

function minutesToTimeStr(min: number): string {
  const m = ((min % (24 * 60)) + (24 * 60)) % (24 * 60)
  const hh = Math.floor(m / 60)
  const mm = m % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
function formatHourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display} ${period}`
}
function formatClockLabel(min: number): string {
  const h = Math.floor(min / 60); const m = min % 60
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${display} ${period}` : `${display}:${String(m).padStart(2, '0')} ${period}`
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

interface TimedPeriod { period: TimetablePeriod; startMin: number; endMin: number }
function timedPeriodsOf(day: TimetableDay): TimedPeriod[] {
  return day.periods.map((period) => {
    const startMin = timeStrToMinutes(period.startTime) ?? 0
    return { period, startMin, endMin: startMin + period.durationMinutes }
  })
}
interface TimedElective { session: ElectiveSession; startMin: number; endMin: number }
function timedElectivesOf(sessions: ElectiveSession[]): TimedElective[] {
  return sessions.map((session) => {
    const startMin = timeStrToMinutes(session.startTime) ?? 0
    return { session, startMin, endMin: startMin + session.durationMinutes }
  })
}
/** Generic over TimedPeriod/TimedElective — both carry startMin/endMin. `isSelf` lets
 *  an edit exclude the entry being edited from its own clash check. */
function overlapsAny<T extends { startMin: number; endMin: number }>(
  startMin: number, endMin: number, timed: T[], isSelf: (t: T) => boolean,
): T | null {
  for (const t of timed) {
    if (isSelf(t)) continue
    if (startMin < t.endMin && t.startMin < endMin) return t
  }
  return null
}

interface Gap { startMin: number; endMin: number }

/**
 * Open/flexible time left in the schedule's own window (e.g. 10:00–18:00) once
 * `occupied` (locked periods, elective sessions, or both) is carved out of it —
 * each gap's `startMin` is, by construction, exactly the end of whatever's right
 * before it (or the window start if it's the first gap of the day), and `endMin`
 * is exactly the start of the next thing (or the window end). That's what makes a
 * gap's own bounds the correct auto-fill defaults for whatever gets booked into it.
 */
function computeGaps(windowStartMin: number, windowEndMin: number, occupied: { startMin: number; endMin: number }[]): Gap[] {
  const sorted = [...occupied].sort((a, b) => a.startMin - b.startMin)
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

interface TimedItem { item: DailyPlanItem; startMin: number; endMin: number }
function timedItemsOf(plan: DailyPlan | null | undefined): TimedItem[] {
  const planStartMin = plan?.startTime ? timeStrToMinutes(plan.startTime) : null
  if (!plan || planStartMin == null) return []
  return plan.items.map((item, idx) => {
    const startMin = planStartMin + plan.items.slice(0, idx).reduce((s, it) => s + (it.plannedMinutes ?? 0), 0)
    return { item, startMin, endMin: startMin + (item.plannedMinutes ?? 0) }
  })
}

/** One block within a multi-section elective-add batch. Title is optional — leave
 *  it blank and the slot saves as open, pending a student or mentor to claim and
 *  fill it in from their own view; give it a title and it saves filled right away.
 *  Mentor name isn't set here either way; it's assigned afterward from the placed
 *  session's own card on the grid. */
interface ElectiveSectionDraft {
  title: string
  startTime: string
  durationMinutes: number
  /** Set when `title` was picked from the syllabus autocomplete and resolved to a
   *  Session — drives the "view & add activities" panel under the Title field.
   *  Cleared whenever the title is hand-edited, so it never points at a session
   *  whose name no longer matches what's actually in the field. */
  linkedSessionId: string | null
}

/** One row in the "Add elective" title autocomplete — a Course, a Session (the
 *  syllabus's "module" unit), or one Session's Topic, all searched together. */
interface SyllabusSuggestion {
  key: string
  title: string
  kind: 'course' | 'session' | 'topic'
  detail: string
  /** Set for 'session' and 'topic' rows — the Session the activities panel should
   *  show when this suggestion is picked. A bare Course has no activities of its
   *  own (only its sessions do), so it's null there. */
  sessionId: string | null
}

/**
 * Only courses actually placed under a Syllabus level feed the autocomplete — a
 * `levelId` of null means the course sits in the Syllabus Builder's "Unassigned"
 * bucket (never properly leveled: leftover test rows, mock seed data, etc.), and
 * those shouldn't surface as elective title suggestions. Sessions/topics inherit
 * the restriction from their parent course.
 */
function buildSyllabusSuggestions(courses: Course[], sessions: Session[]): SyllabusSuggestion[] {
  const leveledCourseIds = new Set(courses.filter((c) => c.levelId !== null).map((c) => c.id))
  const out: SyllabusSuggestion[] = []
  for (const c of courses) {
    if (c.levelId === null) continue
    if (!c.title.trim()) continue
    out.push({ key: `course_${c.id}`, title: c.title, kind: 'course', detail: 'Course', sessionId: null })
  }
  for (const s of sessions) {
    if (!s.courseId || !leveledCourseIds.has(s.courseId)) continue
    if (s.title.trim()) {
      out.push({
        key: `session_${s.id}`, title: s.title, kind: 'session',
        detail: s.courseName ? `Session · ${s.courseName}` : 'Session', sessionId: s.id,
      })
    }
    for (const t of s.activities) {
      if (!t.title.trim()) continue
      out.push({ key: `topic_${s.id}_${t.id}`, title: t.title, kind: 'topic', detail: `Topic · ${s.title}`, sessionId: s.id })
    }
  }
  return out
}

type ModalState =
  | { kind: 'locked'; mode: 'add'; day: Weekday; title: string; startTime: string; durationMinutes: number }
  | { kind: 'locked'; mode: 'edit'; day: Weekday; periodId: string; title: string; startTime: string; durationMinutes: number }
  | { kind: 'elective'; mode: 'add'; day: Weekday; sections: ElectiveSectionDraft[] }
  | { kind: 'elective'; mode: 'edit'; day: Weekday; sessionId: string; title: string; startTime: string; durationMinutes: number; mentorName: string }
  /** The minimal claim form a student/mentor sees on an open slot that's theirs to
   *  fill — just a title (mentors also confirm their name). Nothing else on the grid
   *  is editable in claim mode, so this is the only modal shape claiming ever opens. */
  | { kind: 'claim'; day: Weekday; sessionId: string; title: string; mentorName: string; role: 'student' | 'mentor' }
  /** Duplicates one day's whole schedule (locked periods + electives) onto another
   *  day, or every other day at once — replacing whatever that target already has. */
  | { kind: 'copyDay'; fromDay: Weekday; target: Weekday | 'all' }

export interface PrioritySchedulerProps {
  /** Priority 1 — the shared, mandatory class timetable. */
  timetable: ClassTimetable
  /** Priority 2 — optional elective sessions layered over it. */
  electives: ElectiveSchedule
  /** False once a student is picked — the grid becomes a read-only backdrop for their diary. */
  editingAllowed: boolean
  saving: boolean
  onSaveTimetable: (next: ClassTimetable) => void
  onSaveElectives: (next: ElectiveSchedule) => void
  /** View-mode overlay — a selected student's logged activities for the shown week. */
  weekDates: string[]
  weekPlans: Record<string, DailyPlan | null>
  /** Restricts the grid to just this one weekday's row (used by the student-view
   *  "Today" toggle in SchedulePage) — omitted/null shows the full week, same as before. */
  focusDay?: Weekday | null
  /** Set only on a student's/mentor's own read-only view (never alongside
   *  `editingAllowed`). Any open, unclaimed slot becomes clickable for the viewer
   *  to claim — slots aren't targeted at one role or the other, so a student view
   *  and a mentor view both see every open slot as claimable. Everything else on
   *  the grid (locked periods, already-claimed electives) stays plain and
   *  non-interactive, same as ordinary view mode. */
  claimRole?: 'student' | 'mentor'
  /** Recorded as the elective's `mentorName` when a mentor claims a slot. */
  claimerName?: string | null
  /** Courses and sessions from the Syllabus page — feed the "Add elective" title
   *  field's autocomplete. Only meaningful when `editingAllowed` — omitted (or
   *  empty) elsewhere, which degrades gracefully to a plain text input. */
  syllabusCourses?: Course[]
  syllabusSessions?: Session[]
  /** Appends a topic to a syllabus session — wired to the "+ Add activity" quick
   *  action under a Title field once it's linked to a session. */
  onAddSyllabusActivity?: (sessionId: string, topic: Topic) => Promise<void>
}

/**
 * The weekly scheduler grid: weekdays as rows, hours as columns — each day is one
 * long horizontal strip you read left-to-right, rather than a tall stack of hours.
 *  - Priority 1 (locked): fixed school periods, shown with a lock badge. A manager
 *    creates or moves these via the "＋ Add school period" button — not by clicking
 *    the grid, since open-slot clicks are claimed by Priority 2 below.
 *  - Priority 2 (flexible): the remaining open time per day renders as one "Book
 *    elective" button per open gap, sized to that gap's real span. Clicking it hands
 *    the modal the gap's exact start and a duration that fills the whole gap — pick a
 *    shorter preset (30/45/60m) and the end time recalculates automatically. Electives
 *    never touch or overwrite the locked timetable; they're a separate, optional layer.
 * With a student selected, the whole grid goes read-only and fades into a backdrop
 * for that student's actual logged activities (the "diary"), shown on top in full color.
 */
export function PriorityScheduler({
  timetable, electives, editingAllowed, saving,
  onSaveTimetable, onSaveElectives, weekDates, weekPlans,
  claimRole, claimerName, focusDay = null,
  syllabusCourses = [], syllabusSessions = [], onAddSyllabusActivity,
}: PrioritySchedulerProps) {
  const [modal, setModal] = useState<ModalState | null>(null)
  const [modalError, setModalError] = useState('')
  const syllabusSuggestions = buildSyllabusSuggestions(syllabusCourses, syllabusSessions)

  function openLockedAddModal(day: Weekday = WEEKDAYS[0]) {
    setModalError('')
    setModal({ kind: 'locked', mode: 'add', day, title: '', startTime: '09:00', durationMinutes: 45 })
  }
  function openLockedEditModal(day: Weekday, period: TimetablePeriod) {
    setModalError('')
    setModal({ kind: 'locked', mode: 'edit', day, periodId: period.id, title: period.title, startTime: period.startTime, durationMinutes: period.durationMinutes })
  }
  /** `gapMinutes` suggests a duration that fills the whole gap, capped to the field's 5–240 range. */
  function openElectiveAddModal(day: Weekday, startMin: number, gapMinutes: number) {
    setModalError('')
    setModal({
      kind: 'elective', mode: 'add', day,
      sections: [{ title: '', startTime: minutesToTimeStr(startMin), durationMinutes: Math.max(5, Math.min(240, gapMinutes)), linkedSessionId: null }],
    })
  }
  function openElectiveEditModal(day: Weekday, session: ElectiveSession) {
    setModalError('')
    setModal({ kind: 'elective', mode: 'edit', day, sessionId: session.id, title: session.title, startTime: session.startTime, durationMinutes: session.durationMinutes, mentorName: session.mentorName ?? '' })
  }
  /** The one action available from a student's/mentor's own view — fill in an open
   *  slot that's theirs to claim. Pre-fills the mentor name from `claimerName` so a
   *  mentor doesn't have to retype their own name every time. */
  function openClaimModal(day: Weekday, session: ElectiveSession, role: 'student' | 'mentor') {
    setModalError('')
    setModal({ kind: 'claim', day, sessionId: session.id, title: '', mentorName: role === 'mentor' ? (claimerName ?? '') : '', role })
  }
  function openCopyDayModal(day: Weekday) {
    setModalError('')
    const nextDay = WEEKDAYS[(WEEKDAYS.indexOf(day) + 1) % WEEKDAYS.length]!
    setModal({ kind: 'copyDay', fromDay: day, target: nextDay })
  }
  function closeModal() { setModal(null); setModalError('') }
  /** New section defaults to starting exactly when the previous one ends — the chaining behavior. */
  function addElectiveSection() {
    if (!modal || modal.kind !== 'elective' || modal.mode !== 'add') return
    const last = modal.sections[modal.sections.length - 1]
    const lastStartMin = timeStrToMinutes(last.startTime) ?? 0
    setModal({
      ...modal,
      sections: [...modal.sections, { title: '', startTime: minutesToTimeStr(lastStartMin + last.durationMinutes), durationMinutes: last.durationMinutes, linkedSessionId: null }],
    })
  }
  function removeElectiveSection(index: number) {
    if (!modal || modal.kind !== 'elective' || modal.mode !== 'add' || modal.sections.length <= 1) return
    setModal({ ...modal, sections: modal.sections.filter((_, i) => i !== index) })
  }
  function updateElectiveSection(index: number, patch: Partial<ElectiveSectionDraft>) {
    if (!modal || modal.kind !== 'elective' || modal.mode !== 'add') return
    setModal({ ...modal, sections: modal.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)) })
  }

  function submitModal(e: FormEvent) {
    e.preventDefault()
    if (!modal) return

    if (modal.kind === 'copyDay') {
      const targets = modal.target === 'all' ? WEEKDAYS.filter((d) => d !== modal.fromDay) : [modal.target]
      const label = modal.target === 'all' ? 'every other day' : modal.target
      if (!window.confirm(`Copy ${modal.fromDay}'s schedule to ${label}? This replaces whatever is already scheduled there.`)) return
      const sourcePeriods = timetable.days[modal.fromDay].periods
      const sourceSessions = electives.days[modal.fromDay]?.sessions ?? []
      let nextTimetableDays = timetable.days
      let nextElectiveDays = electives.days
      for (const t of targets) {
        nextTimetableDays = { ...nextTimetableDays, [t]: { periods: sourcePeriods.map((p) => ({ ...p, id: crypto.randomUUID() })) } }
        nextElectiveDays = { ...nextElectiveDays, [t]: { sessions: sourceSessions.map((s) => ({ ...s, id: crypto.randomUUID() })) } }
      }
      onSaveTimetable({ ...timetable, days: nextTimetableDays })
      onSaveElectives({ ...electives, days: nextElectiveDays })
      closeModal()
      return
    }

    if (modal.kind === 'claim') {
      const title = modal.title.trim()
      if (!title) { setModalError('Enter a title for this slot.'); return }
      const sessions = electives.days[modal.day]?.sessions ?? []
      const nextSessions = sessions.map((s) => (s.id === modal.sessionId
        ? { ...s, title, claimed: true, ...(modal.role === 'mentor' ? { mentorName: modal.mentorName.trim() || null } : {}) }
        : s))
      onSaveElectives({ ...electives, days: { ...electives.days, [modal.day]: { sessions: nextSessions } } })
      closeModal()
      return
    }

    if (modal.kind === 'elective' && modal.mode === 'add') {
      const lockedTimed = timedPeriodsOf(timetable.days[modal.day])
      const existingSessions = electives.days[modal.day]?.sessions ?? []
      const existingTimed = timedElectivesOf(existingSessions)
      const placedSoFar: { startMin: number; endMin: number }[] = []
      const newSessions: ElectiveSession[] = []

      for (let i = 0; i < modal.sections.length; i++) {
        const section = modal.sections[i]
        const startMin = timeStrToMinutes(section.startTime)
        if (startMin == null) { setModalError(`Section ${i + 1}: enter a valid start time.`); return }
        if (!Number.isFinite(section.durationMinutes) || section.durationMinutes < 5) { setModalError(`Section ${i + 1}: duration must be at least 5 minutes.`); return }
        const endMin = startMin + section.durationMinutes

        const lockedClash = overlapsAny(startMin, endMin, lockedTimed, () => false)
        if (lockedClash) { setModalError(`Section ${i + 1}: overlaps the locked period "${lockedClash.period.title}" — pick an open slot.`); return }
        const existingClash = overlapsAny(startMin, endMin, existingTimed, () => false)
        if (existingClash) { setModalError(`Section ${i + 1}: overlaps the elective "${existingClash.session.title}" (${minutesToTimeStr(existingClash.startMin)}–${minutesToTimeStr(existingClash.endMin)}).`); return }
        const batchClash = overlapsAny(startMin, endMin, placedSoFar, () => false)
        if (batchClash) { setModalError(`Section ${i + 1}: overlaps another section in this batch.`); return }

        placedSoFar.push({ startMin, endMin })
        const title = section.title.trim()
        // No explicit mode to pick anymore — a blank title alone is what makes a
        // section save as an open slot, pending a student or mentor to claim it.
        const isOpen = !title
        newSessions.push({
          id: crypto.randomUUID(),
          title,
          startTime: section.startTime,
          durationMinutes: section.durationMinutes,
          // Not collected here — assigned afterward from the session's own card on the grid.
          mentorName: null,
          claimed: !isOpen,
        })
      }

      onSaveElectives({ ...electives, days: { ...electives.days, [modal.day]: { sessions: [...existingSessions, ...newSessions] } } })
      closeModal()
      return
    }

    const title = modal.title.trim()
    if (!title) { setModalError('Title is required.'); return }
    const startMin = timeStrToMinutes(modal.startTime)
    if (startMin == null) { setModalError('Enter a valid start time.'); return }
    if (!Number.isFinite(modal.durationMinutes) || modal.durationMinutes < 5) { setModalError('Duration must be at least 5 minutes.'); return }
    const endMin = startMin + modal.durationMinutes

    if (modal.kind === 'locked') {
      const day = timetable.days[modal.day]
      const lockedTimed = timedPeriodsOf(day)
      const clash = overlapsAny(startMin, endMin, lockedTimed, (t) => modal.mode === 'edit' && t.period.id === modal.periodId)
      if (clash) { setModalError(`Overlaps "${clash.period.title}" (${minutesToTimeStr(clash.startMin)}–${minutesToTimeStr(clash.endMin)}).`); return }
      // A new/moved locked period can't silently swallow an elective already booked there.
      const electiveClash = overlapsAny(startMin, endMin, timedElectivesOf(electives.days[modal.day]?.sessions ?? []), () => false)
      if (electiveClash) { setModalError(`Overlaps the elective "${electiveClash.session.title}" (${minutesToTimeStr(electiveClash.startMin)}–${minutesToTimeStr(electiveClash.endMin)}). Move or remove it first.`); return }

      const nextPeriods = modal.mode === 'add'
        ? [...day.periods, { id: crypto.randomUUID(), title, startTime: modal.startTime, durationMinutes: modal.durationMinutes }]
        : day.periods.map((p) => (p.id === modal.periodId ? { ...p, title, startTime: modal.startTime, durationMinutes: modal.durationMinutes } : p))
      onSaveTimetable({ ...timetable, days: { ...timetable.days, [modal.day]: { periods: nextPeriods } } })
    } else {
      const lockedClash = overlapsAny(startMin, endMin, timedPeriodsOf(timetable.days[modal.day]), () => false)
      if (lockedClash) { setModalError(`That overlaps the locked period "${lockedClash.period.title}" — pick an open slot.`); return }
      const sessions = electives.days[modal.day]?.sessions ?? []
      const clash = overlapsAny(startMin, endMin, timedElectivesOf(sessions), (t) => t.session.id === modal.sessionId)
      if (clash) { setModalError(`Overlaps the elective "${clash.session.title}" (${minutesToTimeStr(clash.startMin)}–${minutesToTimeStr(clash.endMin)}).`); return }

      const mentorName = modal.mentorName.trim() || null
      // A manager filling this in via the full edit modal counts as claimed, whether
      // it started out filled or open.
      const nextSessions = sessions.map((s) => (s.id === modal.sessionId ? { ...s, title, startTime: modal.startTime, durationMinutes: modal.durationMinutes, mentorName, claimed: true } : s))
      onSaveElectives({ ...electives, days: { ...electives.days, [modal.day]: { sessions: nextSessions } } })
    }
    closeModal()
  }

  function deleteModalEntry() {
    if (!modal || modal.kind === 'claim' || modal.kind === 'copyDay' || modal.mode !== 'edit') return
    if (!window.confirm(modal.kind === 'locked' ? 'Delete this school period?' : 'Delete this elective session?')) return
    if (modal.kind === 'locked') {
      const day = timetable.days[modal.day]
      onSaveTimetable({ ...timetable, days: { ...timetable.days, [modal.day]: { periods: day.periods.filter((p) => p.id !== modal.periodId) } } })
    } else {
      const sessions = electives.days[modal.day]?.sessions ?? []
      onSaveElectives({ ...electives, days: { ...electives.days, [modal.day]: { sessions: sessions.filter((s) => s.id !== modal.sessionId) } } })
    }
    closeModal()
  }

  // ─── Grid bounds — fixed to operational hours (10 AM–6 PM). The grid no longer
  // widens for whatever's scheduled; locked periods, electives, and logged diary
  // items all render within this window, never outside it. ──
  const windowStartMin = Math.min(Math.max(timeStrToMinutes(timetable.windowStart) ?? GRID_START_MIN, GRID_START_MIN), GRID_END_MIN)
  const windowEndMin = Math.min(Math.max(timeStrToMinutes(timetable.windowEnd) ?? GRID_END_MIN, windowStartMin), GRID_END_MIN)

  const lockedByDay = {} as Record<Weekday, TimedPeriod[]>
  const electiveByDay = {} as Record<Weekday, TimedElective[]>
  for (const d of WEEKDAYS) {
    lockedByDay[d] = timedPeriodsOf(timetable.days[d])
    electiveByDay[d] = timedElectivesOf(electives.days[d]?.sessions ?? [])
  }
  const timedByDate: Record<string, TimedItem[]> = {}
  if (!editingAllowed) {
    for (const d of weekDates) {
      timedByDate[d] = timedItemsOf(weekPlans[d])
    }
  }

  // `focusDay` collapses the grid to just that one weekday's row — WEEKDAYS and
  // weekDates stay index-aligned (both Mon–Sat), so the same index picks the matching
  // real date out of weekDates for the student-item overlay below. Guarded against
  // a `focusDay` the grid has no row for (e.g. a caller passing "Sun" — there's no
  // Sunday column) by falling back to the full week rather than crashing on an
  // undefined `lockedByDay`/`electiveByDay` lookup.
  const validFocusDay = focusDay && WEEKDAYS.includes(focusDay) ? focusDay : null
  const rowDays = validFocusDay ? [validFocusDay] : WEEKDAYS
  const rowDates = validFocusDay ? [weekDates[WEEKDAYS.indexOf(validFocusDay)] ?? weekDates[0]] : weekDates

  const minHour = GRID_START_MIN / 60
  const maxHour = GRID_END_MIN / 60 - 1
  const hours = Array.from({ length: maxHour - minHour + 1 }, (_, i) => minHour + i)
  const gridTopMin = GRID_START_MIN
  const totalSlots = hours.length * SLOTS_PER_HOUR
  const slotMin = 60 / SLOTS_PER_HOUR

  // Open/flexible time per day, within the schedule's own window (not the possibly-
  // wider display range) — edit mode only, nothing to book when just viewing a student.
  // Occupied = locked periods AND existing electives, so a gap never overlaps either.
  const gapsByDay = {} as Record<Weekday, Gap[]>
  if (editingAllowed) {
    for (const d of WEEKDAYS) {
      const occupied = [...lockedByDay[d], ...electiveByDay[d]]
      gapsByDay[d] = computeGaps(windowStartMin, windowEndMin, occupied)
    }
  }

  return (
    <>
      {editingAllowed && (
        <div className="row" style={{ marginBottom: '0.85rem', alignItems: 'center' }}>
          <button type="button" className="btn small secondary" onClick={() => openLockedAddModal()}>
            <LockIcon color="currentColor" /> Add school period
          </button>
          {saving ? <span className="muted small">Saving…</span> : null}
        </div>
      )}

      <div className="timetable-grid-wrap">
        <div
          className="timetable-grid transposed"
          style={{
            gridTemplateColumns: `${DAY_LABEL_COL_PX}px repeat(${totalSlots}, minmax(${SLOT_PX}px, 1fr))`,
            gridTemplateRows: `auto repeat(${rowDays.length}, minmax(${DAY_ROW_PX}px, 1fr))`,
          }}
        >
          <div className="timetable-grid-corner" style={{ gridColumn: 1, gridRow: 1 }} />
          {rowDays.map((d, di) => {
            const colors = DAY_COLORS[d]
            return (
              <div key={d} className="timetable-grid-day-header" style={{ gridColumn: 1, gridRow: di + 2, background: colors.bg, color: colors.text }}>
                {d}
                {editingAllowed && (
                  <button
                    type="button"
                    className="timetable-day-copy-btn"
                    style={{ color: colors.text }}
                    onClick={() => openCopyDayModal(d)}
                    title={`Copy ${d}'s schedule to another day`}
                    aria-label={`Copy ${d}'s schedule to another day`}
                  >
                    📋
                  </button>
                )}
              </div>
            )
          })}

          {hours.map((h, hi) => (
            <div key={`t_${h}`} className="timetable-grid-time-cell" style={{ gridRow: 1, gridColumn: `${2 + hi * SLOTS_PER_HOUR} / span ${SLOTS_PER_HOUR}` }}>
              <span className="timetable-grid-time-tag">{formatHourLabel(h)}</span>
            </div>
          ))}

          {/* Priority 2, open slots — one button per gap (not per hour), sized to the
              gap's real span. Clicking it hands the modal the gap's exact start and a
              duration that fills the whole gap, ready to book an elective there. */}
          {editingAllowed && rowDays.map((d, di) =>
            gapsByDay[d].map((g) => {
              const startSlot = Math.round((g.startMin - gridTopMin) / slotMin)
              const span = Math.max(1, Math.round((g.endMin - g.startMin) / slotMin))
              return (
                <button
                  key={`gap_${d}_${g.startMin}`}
                  type="button"
                  className="timetable-grid-cell gap"
                  style={{ gridRow: di + 2, gridColumn: `${2 + startSlot} / span ${span}` }}
                  onClick={() => openElectiveAddModal(d, g.startMin, g.endMin - g.startMin)}
                  title={`Book an elective — ${minutesToTimeStr(g.startMin)}–${minutesToTimeStr(g.endMin)}`}
                  aria-label={`Book an elective session — ${d} ${minutesToTimeStr(g.startMin)} to ${minutesToTimeStr(g.endMin)}`}
                >
                  <span className="timetable-grid-cell-plus" aria-hidden>＋</span>
                  <span className="timetable-grid-gap-label">Book elective</span>
                </button>
              )
            }),
          )}

          {/* Priority 1 — locked school periods. */}
          {rowDays.map((d, di) =>
            lockedByDay[d].map(({ period, startMin, endMin }) => {
              const startSlot = Math.round((startMin - gridTopMin) / slotMin)
              const span = Math.max(1, Math.round((endMin - startMin) / slotMin))
              const gridPos = { gridRow: di + 2, gridColumn: `${2 + startSlot} / span ${span}` }
              if (editingAllowed) {
                return (
                  <button key={period.id} type="button" className="timetable-grid-card" style={{ ...gridPos, background: PERIOD_COLOR.bg, borderTopColor: PERIOD_COLOR.text, color: PERIOD_COLOR.text }} onClick={() => openLockedEditModal(d, period)}>
                    <span className="timetable-grid-card-lock"><LockIcon color={PERIOD_COLOR.text} />School period</span>
                    <strong className="timetable-grid-card-title">{period.title}</strong>
                    <span className="timetable-grid-card-meta">{minutesToTimeStr(startMin)}–{minutesToTimeStr(endMin)}</span>
                  </button>
                )
              }
              return (
                <div key={period.id} className="timetable-grid-card ghost" style={{ ...gridPos, background: PERIOD_COLOR.bg, borderTopColor: PERIOD_COLOR.text, color: PERIOD_COLOR.text }}>
                  <span className="timetable-grid-card-lock"><LockIcon color={PERIOD_COLOR.text} />School period</span>
                  <strong className="timetable-grid-card-title">{period.title}</strong>
                  <span className="timetable-grid-card-meta">{minutesToTimeStr(startMin)}–{minutesToTimeStr(endMin)}</span>
                </div>
              )
            }),
          )}

          {/* Priority 2 — elective sessions, in their own hue so they never read as mandatory.
              An open, unclaimed slot (blank title) renders as a dashed "pending" card
              instead — no real title to show yet. It's clickable for the manager (full
              edit) or for any viewer with a `claimRole` (student or mentor own-view, the
              minimal claim form) — open slots aren't targeted at one role or the other,
              so either can claim it; otherwise it's just a plain status badge. */}
          {rowDays.map((d, di) =>
            electiveByDay[d].map(({ session, startMin, endMin }) => {
              const startSlot = Math.round((startMin - gridTopMin) / slotMin)
              const span = Math.max(1, Math.round((endMin - startMin) / slotMin))
              const gridPos = { gridRow: di + 2, gridColumn: `${2 + startSlot} / span ${span}` }
              const isPending = !session.claimed

              if (isPending) {
                const content = (
                  <>
                    <span className="timetable-grid-card-lock pending-badge">🔓 Open Slot</span>
                    <span className="timetable-grid-card-meta">{minutesToTimeStr(startMin)}–{minutesToTimeStr(endMin)}</span>
                  </>
                )
                if (editingAllowed) {
                  return (
                    <button key={session.id} type="button" className="timetable-grid-card pending" style={{ ...gridPos, borderColor: ELECTIVE_COLOR.text, color: ELECTIVE_COLOR.text }} onClick={() => openElectiveEditModal(d, session)}>
                      {content}
                    </button>
                  )
                }
                if (claimRole) {
                  return (
                    <button key={session.id} type="button" className="timetable-grid-card pending claimable" style={{ ...gridPos, borderColor: ELECTIVE_COLOR.text, color: ELECTIVE_COLOR.text }} onClick={() => openClaimModal(d, session, claimRole)}>
                      {content}
                      <span className="timetable-grid-gap-label">Tap to claim</span>
                    </button>
                  )
                }
                return (
                  <div key={session.id} className="timetable-grid-card pending ghost" style={{ ...gridPos, borderColor: ELECTIVE_COLOR.text, color: ELECTIVE_COLOR.text }}>
                    {content}
                  </div>
                )
              }

              const badge = (
                <span className="timetable-grid-card-lock">
                  <FlexIcon color={ELECTIVE_COLOR.text} />
                  <span className="timetable-grid-card-lock-text">Elective{session.mentorName ? ` · ${session.mentorName}` : ''}</span>
                </span>
              )
              if (editingAllowed) {
                return (
                  <button key={session.id} type="button" className="timetable-grid-card" style={{ ...gridPos, background: ELECTIVE_COLOR.bg, borderTopColor: ELECTIVE_COLOR.text, color: ELECTIVE_COLOR.text }} onClick={() => openElectiveEditModal(d, session)}>
                    {badge}
                    <strong className="timetable-grid-card-title">{session.title}</strong>
                    <span className="timetable-grid-card-meta">{minutesToTimeStr(startMin)}–{minutesToTimeStr(endMin)}</span>
                  </button>
                )
              }
              return (
                <div key={session.id} className="timetable-grid-card ghost" style={{ ...gridPos, background: ELECTIVE_COLOR.bg, borderTopColor: ELECTIVE_COLOR.text, color: ELECTIVE_COLOR.text }}>
                  {badge}
                  <strong className="timetable-grid-card-title">{session.title}</strong>
                  <span className="timetable-grid-card-meta">{minutesToTimeStr(startMin)}–{minutesToTimeStr(endMin)}</span>
                </div>
              )
            }),
          )}

          {/* Student's logged activities — view mode only, layered on top of everything above. */}
          {!editingAllowed && rowDates.map((d, di) =>
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
                    gridRow: di + 2, gridColumn: `${2 + startSlot} / span ${span}`,
                    background: colors.bg, borderTopColor: colors.text, color: colors.text,
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
            <h3 style={{ margin: '0 0 1rem' }}>
              {modal.kind === 'copyDay'
                ? `Copy ${modal.fromDay}'s Schedule`
                : modal.kind === 'claim'
                  ? (modal.role === 'student' ? 'Claim your slot' : 'Claim this mentor spot')
                  : modal.kind === 'locked'
                    ? (modal.mode === 'add' ? 'Add school period' : `Edit school period — ${modal.day}`)
                    : (modal.mode === 'add' ? `Add elective — ${modal.day}` : `Edit elective — ${modal.day}`)}
            </h3>
            <form className="form" onSubmit={submitModal}>
              {modal.kind === 'copyDay' ? (
                <>
                  <p className="muted small" style={{ margin: '0 0 0.75rem' }}>
                    Copies every school period and elective session from <strong>{modal.fromDay}</strong> onto the day(s) you pick — replacing whatever's already scheduled there.
                  </p>
                  <label>Copy to
                    <select value={modal.target} onChange={(e) => setModal({ ...modal, target: e.target.value as Weekday | 'all' })}>
                      {WEEKDAYS.filter((d) => d !== modal.fromDay).map((d) => <option key={d} value={d}>{d}</option>)}
                      <option value="all">All days (whole week)</option>
                    </select>
                  </label>
                </>
              ) : modal.kind === 'claim' ? (
                <>
                  <p className="muted small" style={{ margin: '0 0 0.75rem' }}>
                    {modal.role === 'student'
                      ? "This slot is yours to fill in — pick what you'd like to work on."
                      : 'This slot is open for a mentor to run — claim it with a title and your name.'}
                  </p>
                  <label>Title<input value={modal.title} onChange={(e) => setModal({ ...modal, title: e.target.value })} placeholder={modal.role === 'student' ? 'e.g. Practice vocabulary' : 'e.g. Chess Club'} required autoFocus /></label>
                  {modal.role === 'mentor' && (
                    <label>Your name
                      <input value={modal.mentorName} onChange={(e) => setModal({ ...modal, mentorName: e.target.value })} placeholder="e.g. Ms. Alvarez" />
                    </label>
                  )}
                </>
              ) : modal.kind === 'elective' && modal.mode === 'add' ? (
                <>
                  {modal.sections.map((section, i) => {
                    const sectionStartMin = timeStrToMinutes(section.startTime)
                    return (
                      <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '0.75rem', marginBottom: '0.75rem' }}>
                        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <strong style={{ fontSize: '0.85rem' }}>Section {i + 1}</strong>
                          {modal.sections.length > 1 && (
                            <button type="button" className="btn small secondary" onClick={() => removeElectiveSection(i)}>✕ Remove</button>
                          )}
                        </div>
                        <label>Start time
                          <input type="time" value={section.startTime} onChange={(e) => updateElectiveSection(i, { startTime: e.target.value })} required autoFocus={i === 0} />
                        </label>
                        <label>Title
                          <SyllabusTitleField
                            value={section.title}
                            suggestions={syllabusSuggestions}
                            placeholder="Search or enter title"
                            onChange={(title) => updateElectiveSection(i, { title, linkedSessionId: null })}
                            onPick={(s) => updateElectiveSection(i, { title: s.title, linkedSessionId: s.sessionId })}
                          />
                        </label>
                        {section.linkedSessionId && (
                          <SessionActivitiesPanel
                            session={syllabusSessions.find((s) => s.id === section.linkedSessionId) ?? null}
                            onAddActivity={(topic) => onAddSyllabusActivity?.(section.linkedSessionId!, topic) ?? Promise.resolve()}
                          />
                        )}
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.35rem' }}>Duration</div>
                          <div className="row" style={{ marginBottom: '0.5rem' }}>
                            {DURATION_PRESETS.map((mins) => (
                              <button
                                key={mins}
                                type="button"
                                className={`btn small ${section.durationMinutes === mins ? 'primary' : 'secondary'}`}
                                onClick={() => updateElectiveSection(i, { durationMinutes: mins })}
                              >
                                {mins < 60 ? `${mins} mins` : `${mins / 60} hour${mins > 60 ? 's' : ''}`}
                              </button>
                            ))}
                          </div>
                          <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            Custom (minutes)
                            <input
                              type="number" min={5} max={240} step={5}
                              value={section.durationMinutes}
                              onChange={(e) => updateElectiveSection(i, { durationMinutes: Number(e.target.value) })}
                              style={{ width: 90 }}
                            />
                          </label>
                        </div>
                        {sectionStartMin != null && (
                          <p className="muted small" style={{ margin: 0 }}>
                            Ends at <strong style={{ color: 'var(--text)' }}>{formatClockLabel(sectionStartMin + section.durationMinutes)}</strong>
                          </p>
                        )}
                      </div>
                    )
                  })}
                  <div className="row" style={{ marginBottom: '0.5rem' }}>
                    <button type="button" className="btn secondary" onClick={addElectiveSection}>+ Add Another Section</button>
                  </div>
                  {(() => {
                    const last = modal.sections[modal.sections.length - 1]
                    const lastStartMin = timeStrToMinutes(last.startTime)
                    return lastStartMin != null ? (
                      <p className="muted small" style={{ margin: '0 0 0.5rem' }}>
                        {modal.sections.length} section{modal.sections.length > 1 ? 's' : ''} · ends at{' '}
                        <strong style={{ color: 'var(--text)' }}>{formatClockLabel(lastStartMin + last.durationMinutes)}</strong>
                      </p>
                    ) : null
                  })()}
                </>
              ) : (
                <>
                  {modal.kind === 'locked' && (
                    <label>Day
                      <select value={modal.day} onChange={(e) => setModal({ ...modal, day: e.target.value as Weekday })}>
                        {WEEKDAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </label>
                  )}
                  <label>Start time<input type="time" value={modal.startTime} onChange={(e) => setModal({ ...modal, startTime: e.target.value })} required autoFocus /></label>
                  <label>Title<input value={modal.title} onChange={(e) => setModal({ ...modal, title: e.target.value })} placeholder={modal.kind === 'locked' ? 'e.g. Math' : 'e.g. Chess Club'} required /></label>
                  {modal.kind === 'elective' && (
                    <label>Mentor <span className="muted small">(optional)</span>
                      <input value={modal.mentorName} onChange={(e) => setModal({ ...modal, mentorName: e.target.value })} placeholder="e.g. Ms. Alvarez" />
                    </label>
                  )}
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
                </>
              )}
              {modalError ? <p className="error" style={{ margin: 0 }}>⚠ {modalError}</p> : null}
              <div className="row">
                <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : modal.kind === 'copyDay' ? 'Copy' : 'Save'}</button>
                <button type="button" className="btn secondary" onClick={closeModal}>Cancel</button>
                {modal.kind !== 'claim' && modal.kind !== 'copyDay' && modal.mode === 'edit' && (
                  <button type="button" className="btn secondary" style={{ color: 'var(--danger)', marginLeft: 'auto' }} onClick={deleteModalEntry}>Delete</button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

interface SyllabusTitleFieldProps {
  value: string
  suggestions: SyllabusSuggestion[]
  placeholder?: string
  onChange: (title: string) => void
  onPick: (suggestion: SyllabusSuggestion) => void
}

const SYLLABUS_KIND_ICON: Record<SyllabusSuggestion['kind'], string> = { course: '📚', session: '🗂️', topic: '📝' }

/**
 * Searchable dropdown over the syllabus (courses, sessions, topics) for an elective's
 * Title field — type to filter, or focus an empty field to browse what's there. Still
 * a plain text input underneath, so typing something that matches nothing just keeps
 * that free text (today's behavior); suggestions sit on top rather than replacing it.
 */
function SyllabusTitleField({ value, suggestions, placeholder, onChange, onPick }: SyllabusTitleFieldProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocPointerDown)
    return () => document.removeEventListener('mousedown', onDocPointerDown)
  }, [open])

  const q = value.trim().toLowerCase()
  const matches = (q ? suggestions.filter((s) => s.title.toLowerCase().includes(q)) : suggestions).slice(0, 8)

  return (
    <div className="syllabus-autocomplete" ref={wrapRef}>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div className="syllabus-autocomplete-list">
          {matches.map((s) => (
            <button
              key={s.key}
              type="button"
              className="syllabus-autocomplete-item"
              onClick={() => { onPick(s); setOpen(false) }}
            >
              <span aria-hidden>{SYLLABUS_KIND_ICON[s.kind]}</span>
              <span className="syllabus-autocomplete-item-text">
                <span className="syllabus-autocomplete-item-title">{s.title}</span>
                <span className="muted small">{s.detail}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface SessionActivitiesPanelProps {
  session: Session | null
  onAddActivity: (topic: Topic) => Promise<void>
}

/**
 * Shown under the Title field once it's linked to a syllabus session — lets a manager
 * glance at that session's existing activities and add a new one on the spot, without
 * leaving the "Add elective" modal for the Syllabus page.
 */
function SessionActivitiesPanel({ session, onAddActivity }: SessionActivitiesPanelProps) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<TopicType>('concept')
  const [saving, setSaving] = useState(false)

  if (!session) return null

  async function save() {
    const t = title.trim()
    if (!t) return
    setSaving(true)
    try {
      await onAddActivity({ id: crypto.randomUUID(), title: t, type, remark: '' })
      setTitle(''); setType('concept'); setAdding(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="syllabus-activities-panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: '0.82rem' }}>Activities — {session.title}</strong>
        <button type="button" className="btn small secondary" onClick={() => setAdding((v) => !v)}>
          {adding ? '✕ Cancel' : '+ Add activity'}
        </button>
      </div>
      {session.activities.length === 0 ? (
        <p className="muted small" style={{ margin: '0.4rem 0 0' }}>No activities yet.</p>
      ) : (
        <ul className="syllabus-activities-list">
          {session.activities.map((t) => {
            const colors = itemTypeColors(t.type)
            return (
              <li key={t.id}>
                <span className="tag" style={{ background: colors.bg, color: colors.text, border: 'none' }}>
                  {itemTypeLabel(t.type)}
                </span>
                {t.title}
              </li>
            )
          })}
        </ul>
      )}
      {adding && (
        <div className="row" style={{ marginTop: '0.5rem', alignItems: 'center' }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New activity title"
            style={{ flex: 1, minWidth: 120 }}
          />
          <select value={type} onChange={(e) => setType(e.target.value as TopicType)}>
            <option value="concept">Concept</option>
            <option value="exercise">Exercise</option>
          </select>
          <button type="button" className="btn small primary" disabled={!title.trim() || saving} onClick={() => void save()}>
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      )}
    </div>
  )
}
