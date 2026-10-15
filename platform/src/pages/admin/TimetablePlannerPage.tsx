import { useEffect, useState, type FormEvent } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { ClassTimetable, TimetableDay, TimetablePeriod, Weekday } from '../../types'

const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const DAY_COLORS: Record<Weekday, { bg: string; text: string }> = {
  Mon: { bg: '#eef2ff', text: '#4338ca' },
  Tue: { bg: '#ecfdf5', text: '#047857' },
  Wed: { bg: '#fff7ed', text: '#c2410c' },
  Thu: { bg: '#fdf4ff', text: '#a21caf' },
  Fri: { bg: '#eff6ff', text: '#1d4ed8' },
  Sat: { bg: '#fdf2f8', text: '#be185d' },
  Sun: { bg: '#fffbeb', text: '#b45309' },
}

const PERIOD_COLOR = { bg: '#dbeafe', text: '#1d4ed8' }
const ROW_PX = 64

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

type ModalState =
  | { mode: 'add'; day: Weekday; title: string; startTime: string; durationMinutes: number }
  | { mode: 'edit'; day: Weekday; periodId: string; title: string; startTime: string; durationMinutes: number }

const DURATION_PRESETS = [30, 45, 60]

/**
 * Manager-only: author the single shared, platform-wide weekly class timetable as a
 * clickable grid — click an empty slot to add a mandatory period (pick a duration, the
 * end time and grid span are computed automatically); click an existing period to edit
 * or delete it. Periods carry their own start time, so gaps between periods are fine.
 * Display-only beyond that — StudentDailyPlanner isn't modified to block overlaps yet;
 * see docs/superpowers/specs/2026-10-15-timetable-planner-design.md.
 */
export function TimetablePlannerPage() {
  const [timetable, setTimetable] = useState<ClassTimetable | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [modal, setModal] = useState<ModalState | null>(null)
  const [modalError, setModalError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'class_timetable', 'master'))
        setTimetable(normalizeTimetable(snap.exists() ? snap.data() : undefined))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load timetable')
        setTimetable(createDefaultTimetable())
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function save(next: ClassTimetable) {
    setSaving(true); setError('')
    setTimetable(next) // optimistic — the grid should never flicker while saving
    try {
      await setDoc(doc(db, 'class_timetable', 'master'), next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save timetable')
    } finally {
      setSaving(false)
    }
  }

  function updateWindow(patch: Partial<Pick<ClassTimetable, 'windowStart' | 'windowEnd'>>) {
    if (!timetable) return
    void save({ ...timetable, ...patch })
  }

  function openAddModal(day: Weekday, hour: number) {
    setModalError('')
    setModal({ mode: 'add', day, title: '', startTime: `${String(hour).padStart(2, '0')}:00`, durationMinutes: 45 })
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

    void save({ ...timetable, days: { ...timetable.days, [modal.day]: { periods: nextPeriods } } })
    closeModal()
  }

  function deleteModalPeriod() {
    if (!modal || modal.mode !== 'edit' || !timetable) return
    if (!window.confirm('Delete this period?')) return
    const day = timetable.days[modal.day]
    void save({ ...timetable, days: { ...timetable.days, [modal.day]: { periods: day.periods.filter((p) => p.id !== modal.periodId) } } })
    closeModal()
  }

  if (loading || !timetable) return <p className="muted">Loading…</p>

  const windowStartMin = timeStrToMinutes(timetable.windowStart) ?? 10 * 60
  const windowEndMin = timeStrToMinutes(timetable.windowEnd) ?? 18 * 60

  let minHour = Math.floor(windowStartMin / 60)
  let maxHour = Math.ceil(windowEndMin / 60) - 1
  const timedByDay = {} as Record<Weekday, TimedPeriod[]>
  for (const d of WEEKDAYS) {
    const timed = timedPeriodsOf(timetable.days[d])
    timedByDay[d] = timed
    for (const t of timed) {
      minHour = Math.min(minHour, Math.floor(t.startMin / 60))
      maxHour = Math.max(maxHour, Math.floor((t.endMin - 1) / 60))
    }
  }
  const hours = Array.from({ length: Math.max(1, maxHour - minHour + 1) }, (_, i) => minHour + i)
  const gridTopMin = minHour * 60

  return (
    <div>
      <h1 style={{ margin: '0 0 0.2rem' }}>🗓️ Timetable Planner</h1>
      <p className="muted" style={{ marginBottom: '1.25rem' }}>
        Click an empty slot to add a mandatory period. Click an existing period to edit or remove it.
      </p>
      {error ? <p className="error">{error}</p> : null}

      <div className="panel" style={{ marginBottom: '1.25rem' }}>
        <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <strong style={{ fontSize: '0.88rem' }}>Grid time range</strong>
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

      <div className="timetable-grid-wrap">
        <div
          className="timetable-grid"
          style={{ gridTemplateColumns: `72px repeat(7, minmax(130px, 1fr))`, gridTemplateRows: `auto repeat(${hours.length}, ${ROW_PX}px)` }}
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
            <div key={`t_${h}`} className="timetable-grid-time-cell" style={{ gridColumn: 1, gridRow: hi + 2 }}>
              <span className="timetable-grid-time-tag">{formatHourLabel(h)}</span>
            </div>
          ))}

          {hours.map((h, hi) =>
            WEEKDAYS.map((d, di) => (
              <button
                key={`${d}_${h}`}
                type="button"
                className="timetable-grid-cell"
                style={{ gridColumn: di + 2, gridRow: hi + 2 }}
                onClick={() => openAddModal(d, h)}
                aria-label={`Add period — ${d} ${formatHourLabel(h)}`}
              >
                <span className="timetable-grid-cell-plus" aria-hidden>＋</span>
              </button>
            )),
          )}

          {WEEKDAYS.map((d, di) => (
            <div key={`overlay_${d}`} className="timetable-grid-overlay" style={{ gridColumn: di + 2, gridRow: `2 / span ${hours.length}` }}>
              {timedByDay[d].map(({ period, startMin, endMin }) => {
                const top = ((startMin - gridTopMin) / 60) * ROW_PX
                const height = Math.max(20, ((endMin - startMin) / 60) * ROW_PX - 2)
                return (
                  <button
                    key={period.id}
                    type="button"
                    className="timetable-grid-card"
                    style={{ top, height, background: PERIOD_COLOR.bg, borderLeftColor: PERIOD_COLOR.text, color: PERIOD_COLOR.text }}
                    onClick={() => openEditModal(d, period)}
                  >
                    <strong className="timetable-grid-card-title">{period.title}</strong>
                    <span className="timetable-grid-card-meta">{minutesToTimeStr(startMin)}–{minutesToTimeStr(endMin)}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {modal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem' }}>{modal.mode === 'add' ? `Add period — ${modal.day}` : `Edit period — ${modal.day}`}</h3>
            <form className="form" onSubmit={submitModal}>
              <label>Title<input value={modal.title} onChange={(e) => setModal({ ...modal, title: e.target.value })} placeholder="e.g. Math" required autoFocus /></label>
              <label>Start time<input type="time" value={modal.startTime} onChange={(e) => setModal({ ...modal, startTime: e.target.value })} required /></label>
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
