import { useState, type FormEvent } from 'react'
import { LockIcon, FlexIcon } from './StatIcons'
import { WEEKDAYS, DAY_COLORS, timeStrToMinutes, formatTime } from './schedulerShared'
import type {
  ClassTimetable, DailyPlan, DailyPlanItem, ElectiveSchedule, ElectiveSession,
  LessonItemType, TimetableDay, TimetablePeriod, Weekday,
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
const DEFAULT_MIN_HOUR = 7
const DEFAULT_MAX_HOUR = 21
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

type ModalState =
  | { kind: 'locked'; mode: 'add'; day: Weekday; title: string; startTime: string; durationMinutes: number }
  | { kind: 'locked'; mode: 'edit'; day: Weekday; periodId: string; title: string; startTime: string; durationMinutes: number }
  | { kind: 'elective'; mode: 'add'; day: Weekday; title: string; startTime: string; durationMinutes: number; mentorName: string }
  | { kind: 'elective'; mode: 'edit'; day: Weekday; sessionId: string; title: string; startTime: string; durationMinutes: number; mentorName: string }

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
}: PrioritySchedulerProps) {
  const [modal, setModal] = useState<ModalState | null>(null)
  const [modalError, setModalError] = useState('')

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
    setModal({ kind: 'elective', mode: 'add', day, title: '', startTime: minutesToTimeStr(startMin), durationMinutes: Math.max(5, Math.min(240, gapMinutes)), mentorName: '' })
  }
  function openElectiveEditModal(day: Weekday, session: ElectiveSession) {
    setModalError('')
    setModal({ kind: 'elective', mode: 'edit', day, sessionId: session.id, title: session.title, startTime: session.startTime, durationMinutes: session.durationMinutes, mentorName: session.mentorName ?? '' })
  }
  function closeModal() { setModal(null); setModalError('') }

  function submitModal(e: FormEvent) {
    e.preventDefault()
    if (!modal) return
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
      const clash = overlapsAny(startMin, endMin, timedElectivesOf(sessions), (t) => modal.mode === 'edit' && t.session.id === modal.sessionId)
      if (clash) { setModalError(`Overlaps the elective "${clash.session.title}" (${minutesToTimeStr(clash.startMin)}–${minutesToTimeStr(clash.endMin)}).`); return }

      const mentorName = modal.mentorName.trim() || null
      const nextSessions = modal.mode === 'add'
        ? [...sessions, { id: crypto.randomUUID(), title, startTime: modal.startTime, durationMinutes: modal.durationMinutes, mentorName }]
        : sessions.map((s) => (s.id === modal.sessionId ? { ...s, title, startTime: modal.startTime, durationMinutes: modal.durationMinutes, mentorName } : s))
      onSaveElectives({ ...electives, days: { ...electives.days, [modal.day]: { sessions: nextSessions } } })
    }
    closeModal()
  }

  function deleteModalEntry() {
    if (!modal || modal.mode !== 'edit') return
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

  // ─── Grid bounds — widen for whatever's actually scheduled (locked periods,
  // electives, or in view mode, logged diary items), so nothing real ever clips. ──
  const windowStartMin = timeStrToMinutes(timetable.windowStart) ?? 10 * 60
  const windowEndMin = timeStrToMinutes(timetable.windowEnd) ?? 18 * 60
  let minHour = editingAllowed ? Math.floor(windowStartMin / 60) : Math.min(DEFAULT_MIN_HOUR, Math.floor(windowStartMin / 60))
  let maxHour = editingAllowed ? Math.ceil(windowEndMin / 60) - 1 : Math.max(DEFAULT_MAX_HOUR, Math.ceil(windowEndMin / 60) - 1)

  const lockedByDay = {} as Record<Weekday, TimedPeriod[]>
  const electiveByDay = {} as Record<Weekday, TimedElective[]>
  for (const d of WEEKDAYS) {
    const locked = timedPeriodsOf(timetable.days[d])
    lockedByDay[d] = locked
    for (const t of locked) {
      minHour = Math.min(minHour, Math.floor(t.startMin / 60))
      maxHour = Math.max(maxHour, Math.floor((t.endMin - 1) / 60))
    }
    const elective = timedElectivesOf(electives.days[d]?.sessions ?? [])
    electiveByDay[d] = elective
    for (const t of elective) {
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
          <span className="muted small">Open slots below are click-to-book electives (Priority 2).</span>
          {saving ? <span className="muted small">Saving…</span> : null}
        </div>
      )}

      <div className="timetable-grid-wrap">
        <div
          className="timetable-grid transposed"
          style={{ gridTemplateColumns: `${DAY_LABEL_COL_PX}px repeat(${totalSlots}, ${SLOT_PX}px)`, gridTemplateRows: `auto repeat(${WEEKDAYS.length}, ${DAY_ROW_PX}px)` }}
        >
          <div className="timetable-grid-corner" style={{ gridColumn: 1, gridRow: 1 }} />
          {WEEKDAYS.map((d, di) => {
            const colors = DAY_COLORS[d]
            return (
              <div key={d} className="timetable-grid-day-header" style={{ gridColumn: 1, gridRow: di + 2, background: colors.bg, color: colors.text }}>
                {d}
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
          {editingAllowed && WEEKDAYS.map((d, di) =>
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
          {WEEKDAYS.map((d, di) =>
            lockedByDay[d].map(({ period, startMin, endMin }) => {
              const startSlot = Math.round((startMin - gridTopMin) / slotMin)
              const span = Math.max(1, Math.round((endMin - startMin) / slotMin))
              const gridPos = { gridRow: di + 2, gridColumn: `${2 + startSlot} / span ${span}` }
              if (editingAllowed) {
                return (
                  <button key={period.id} type="button" className="timetable-grid-card" style={{ ...gridPos, background: PERIOD_COLOR.bg, borderLeftColor: PERIOD_COLOR.text, color: PERIOD_COLOR.text }} onClick={() => openLockedEditModal(d, period)}>
                    <span className="timetable-grid-card-lock"><LockIcon color={PERIOD_COLOR.text} />School period</span>
                    <strong className="timetable-grid-card-title">{period.title}</strong>
                    <span className="timetable-grid-card-meta">{minutesToTimeStr(startMin)}–{minutesToTimeStr(endMin)}</span>
                  </button>
                )
              }
              return (
                <div key={period.id} className="timetable-grid-card ghost" style={{ ...gridPos, background: PERIOD_COLOR.bg, borderLeftColor: PERIOD_COLOR.text, color: PERIOD_COLOR.text }}>
                  <span className="timetable-grid-card-lock"><LockIcon color={PERIOD_COLOR.text} />School period</span>
                  <strong className="timetable-grid-card-title">{period.title}</strong>
                  <span className="timetable-grid-card-meta">{minutesToTimeStr(startMin)}–{minutesToTimeStr(endMin)}</span>
                </div>
              )
            }),
          )}

          {/* Priority 2 — elective sessions, in their own hue so they never read as mandatory. */}
          {WEEKDAYS.map((d, di) =>
            electiveByDay[d].map(({ session, startMin, endMin }) => {
              const startSlot = Math.round((startMin - gridTopMin) / slotMin)
              const span = Math.max(1, Math.round((endMin - startMin) / slotMin))
              const gridPos = { gridRow: di + 2, gridColumn: `${2 + startSlot} / span ${span}` }
              const badge = (
                <span className="timetable-grid-card-lock">
                  <FlexIcon color={ELECTIVE_COLOR.text} />
                  <span className="timetable-grid-card-lock-text">Elective{session.mentorName ? ` · ${session.mentorName}` : ''}</span>
                </span>
              )
              if (editingAllowed) {
                return (
                  <button key={session.id} type="button" className="timetable-grid-card" style={{ ...gridPos, background: ELECTIVE_COLOR.bg, borderLeftColor: ELECTIVE_COLOR.text, color: ELECTIVE_COLOR.text }} onClick={() => openElectiveEditModal(d, session)}>
                    {badge}
                    <strong className="timetable-grid-card-title">{session.title}</strong>
                    <span className="timetable-grid-card-meta">{minutesToTimeStr(startMin)}–{minutesToTimeStr(endMin)}</span>
                  </button>
                )
              }
              return (
                <div key={session.id} className="timetable-grid-card ghost" style={{ ...gridPos, background: ELECTIVE_COLOR.bg, borderLeftColor: ELECTIVE_COLOR.text, color: ELECTIVE_COLOR.text }}>
                  {badge}
                  <strong className="timetable-grid-card-title">{session.title}</strong>
                  <span className="timetable-grid-card-meta">{minutesToTimeStr(startMin)}–{minutesToTimeStr(endMin)}</span>
                </div>
              )
            }),
          )}

          {/* Student's logged activities — view mode only, layered on top of everything above. */}
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
            <h3 style={{ margin: '0 0 1rem' }}>
              {modal.kind === 'locked'
                ? (modal.mode === 'add' ? 'Add school period' : `Edit school period — ${modal.day}`)
                : (modal.mode === 'add' ? `Add elective — ${modal.day}` : `Edit elective — ${modal.day}`)}
            </h3>
            <form className="form" onSubmit={submitModal}>
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
              {modalError ? <p className="error" style={{ margin: 0 }}>⚠ {modalError}</p> : null}
              <div className="row">
                <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                <button type="button" className="btn secondary" onClick={closeModal}>Cancel</button>
                {modal.mode === 'edit' && (
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
