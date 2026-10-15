import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { mapUserDoc } from '../../lib/userUtils'
import { StudentSelect } from '../../components/StudentSelect'
import type { DailyPlan, DailyPlanItem, LessonItemType, UserProfile } from '../../types'

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
/** Monday of the week containing `s` (week runs Mon–Sun). */
function mondayOf(s: string): string {
  const d = parseDateStr(s)
  const dow = d.getUTCDay() // 0=Sun..6=Sat
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  return formatDateStr(d)
}
function formatDayName(s: string): string {
  return parseDateStr(s).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}
function formatDayDate(s: string): string {
  return parseDateStr(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function formatWeekRangeLabel(monday: string): string {
  const sunday = addDays(monday, 6)
  return `${formatDayDate(monday)} – ${formatDayDate(sunday)}, ${parseDateStr(sunday).getUTCFullYear()}`
}
function formatHourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display} ${period}`
}

/** Pastel header tone per weekday, keyed by short day name. */
const DAY_COLORS: Record<string, { bg: string; text: string }> = {
  Mon: { bg: '#eef2ff', text: '#4338ca' },
  Tue: { bg: '#ecfdf5', text: '#047857' },
  Wed: { bg: '#fff7ed', text: '#c2410c' },
  Thu: { bg: '#fdf4ff', text: '#a21caf' },
  Fri: { bg: '#eff6ff', text: '#1d4ed8' },
  Sat: { bg: '#fdf2f8', text: '#be185d' },
  Sun: { bg: '#fffbeb', text: '#b45309' },
}

const DEFAULT_MIN_HOUR = 7
const DEFAULT_MAX_HOUR = 21

interface TimedItem { item: DailyPlanItem; startMin: number; endMin: number }

function timedItemsOf(plan: DailyPlan | null | undefined): TimedItem[] {
  const planStartMin = plan?.startTime ? timeStrToMinutes(plan.startTime) : null
  if (!plan || planStartMin == null) return []
  return plan.items.map((item, idx) => {
    const startMin = planStartMin + plan.items.slice(0, idx).reduce((s, it) => s + (it.plannedMinutes ?? 0), 0)
    return { item, startMin, endMin: startMin + (item.plannedMinutes ?? 0) }
  })
}

/**
 * Admin-only, read-only view into students' daily plans ("diary") — the same
 * data StudentDailyPlanner writes, shown as a classic weekly schedule grid
 * (days as columns, hours as rows). No editing; this is purely for staff reference.
 */
export function StudentDiaryPage() {
  const [students, setStudents] = useState<UserProfile[]>([])
  const [loadingStudents, setLoadingStudents] = useState(true)
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [date, setDate] = useState(todayStr())
  const [weekPlans, setWeekPlans] = useState<Record<string, DailyPlan | null>>({})
  const [loadingPlans, setLoadingPlans] = useState(false)
  const [error, setError] = useState('')

  const weekStart = mondayOf(date)
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

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
    if (!selectedStudentId) { setWeekPlans({}); return }
    void (async () => {
      setLoadingPlans(true); setError('')
      try {
        const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
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

  const selectedStudent = students.find((s) => s.id === selectedStudentId) ?? null
  const studentOptions = useMemo(() => students.map((s) => ({ id: s.id, name: studentLabel(s) })), [students])

  const allItems = weekDates.flatMap((d) => weekPlans[d]?.items ?? [])
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
    <div className="diary-page">
      <div className="diary-toolbar">
        <div>
          <h1 style={{ margin: '0 0 0.2rem' }}>📔 Student Diary</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Read-only weekly schedule of a student's daily plans — activities, time tracked, and completion.
          </p>
        </div>
        <div className="diary-toolbar-controls">
          <StudentSelect
            students={studentOptions}
            value={selectedStudentId}
            onChange={setSelectedStudentId}
            loading={loadingStudents}
          />
          <div className="diary-week-nav">
            <button type="button" className="btn small ghost" onClick={() => setDate(addDays(weekStart, -7))} aria-label="Previous week">‹</button>
            <span className="muted small diary-week-label">{formatWeekRangeLabel(weekStart)}</span>
            <button type="button" className="btn small ghost" onClick={() => setDate(addDays(weekStart, 7))} aria-label="Next week">›</button>
          </div>
          <input
            type="date"
            className="date-picker"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Jump to date"
          />
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="panel diary-panel">
        {!selectedStudent ? (
          <div style={{ textAlign: 'center', padding: '2.5rem' }}>
            <p style={{ fontSize: '2.5rem', margin: 0 }}>📔</p>
            <h3>Select a student to view their diary</h3>
            <p className="muted">Pick a student from the dropdown above, then browse weeks.</p>
          </div>
        ) : (
          <>
            <div className="diary-panel-header">
              <h2 style={{ margin: 0 }}>{selectedStudent.name}</h2>
              <p className="muted small" style={{ margin: '0.2rem 0 0' }}>{selectedStudent.email}</p>
            </div>

            {totalItems > 0 && (
              <div className="planner-stats">
                <div className="planner-stat"><span className="planner-stat-value">{doneItems}/{totalItems}</span><span className="muted small">Tasks</span></div>
                <div className="planner-stat"><span className="planner-stat-value">{pct}%</span><span className="muted small">Done</span></div>
                <div className="planner-stat"><span className="planner-stat-value">{totalPlannedMin}m</span><span className="muted small">Planned</span></div>
                <div className="planner-stat"><span className="planner-stat-value">{formatTime(totalSpentMs)}</span><span className="muted small">Spent</span></div>
                <div style={{ flex: 1, minWidth: 120 }}><div className="planner-progress-bar"><div className="planner-progress-fill" style={{ width: `${pct}%` }} /></div></div>
              </div>
            )}

            {!loadingPlans && !hasAnyEntry && (
              <p className="muted small" style={{ margin: '0 0 0.75rem' }}>No diary entries logged this week — the grid below is empty.</p>
            )}
            {noStartTimeDays.length > 0 && (
              <p className="muted small" style={{ margin: '0 0 0.75rem' }}>
                ⚠ {noStartTimeDays.map(formatDayDate).join(', ')} {noStartTimeDays.length === 1 ? 'has' : 'have'} activities logged but no start time, so they can't be placed on the grid.
              </p>
            )}

            <WeeklyScheduleGrid weekDates={weekDates} weekPlans={weekPlans} />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Weekly schedule grid ───────────────────────────────────────────────────────

interface WeeklyScheduleGridProps {
  weekDates: string[]
  weekPlans: Record<string, DailyPlan | null>
}

function WeeklyScheduleGrid({ weekDates, weekPlans }: WeeklyScheduleGridProps) {
  const timedByDate: Record<string, TimedItem[]> = {}
  let minHour = DEFAULT_MIN_HOUR
  let maxHour = DEFAULT_MAX_HOUR
  for (const d of weekDates) {
    const timed = timedItemsOf(weekPlans[d])
    timedByDate[d] = timed
    for (const t of timed) {
      minHour = Math.min(minHour, Math.floor(t.startMin / 60))
      maxHour = Math.max(maxHour, Math.floor((t.endMin - 1) / 60))
    }
  }
  const hours = Array.from({ length: maxHour - minHour + 1 }, (_, i) => minHour + i)

  // Bucket each item under the day/hour cell it starts in.
  const cellItems: Record<string, TimedItem[]> = {}
  for (const d of weekDates) {
    for (const t of timedByDate[d]!) {
      const key = `${d}_${Math.floor(t.startMin / 60)}`
      ;(cellItems[key] ??= []).push(t)
    }
  }

  return (
    <div className="week-grid-wrap">
      <div
        className="week-grid"
        style={{ gridTemplateColumns: `72px repeat(7, minmax(150px, 1fr))`, gridTemplateRows: `auto repeat(${hours.length}, minmax(56px, auto))` }}
      >
        <div className="week-grid-corner" style={{ gridColumn: 1, gridRow: 1 }} />
        {weekDates.map((d, di) => {
          const colors = DAY_COLORS[formatDayName(d)] ?? { bg: 'var(--surface-soft)', text: 'var(--text)' }
          return (
            <div
              key={d}
              className="week-grid-day-header"
              style={{ gridColumn: di + 2, gridRow: 1, background: colors.bg, color: colors.text }}
            >
              <span className="week-grid-day-name">{formatDayName(d)}</span>
              <span className="week-grid-day-date">{formatDayDate(d)}</span>
            </div>
          )
        })}

        {hours.map((h, hi) => (
          <div key={`t_${h}`} className="week-grid-time-cell" style={{ gridColumn: 1, gridRow: hi + 2 }}>
            <span className="week-grid-time-tag">{formatHourLabel(h)}</span>
          </div>
        ))}

        {hours.map((h, hi) =>
          weekDates.map((d, di) => {
            const items = cellItems[`${d}_${h}`] ?? []
            return (
              <div key={`${d}_${h}`} className="week-grid-cell" style={{ gridColumn: di + 2, gridRow: hi + 2 }}>
                {items.map(({ item, startMin, endMin }) => {
                  const colors = itemTypeColors(item.activityType)
                  const overTime = item.timeSpentMs > item.plannedMinutes * 60000
                  return (
                    <div key={item.id} className={`week-grid-card${item.done ? ' done' : ''}`} style={{ background: colors.bg, borderLeftColor: colors.text }}>
                      <div className="week-grid-card-head">
                        <span className="tag" style={{ background: 'rgba(255,255,255,0.6)', color: colors.text, border: 'none', fontSize: '0.65rem' }}>
                          {itemTypeLabel(item.activityType)}
                        </span>
                        {item.done ? <span aria-hidden>✓</span> : null}
                      </div>
                      <strong className="week-grid-card-title" style={{ textDecoration: item.done ? 'line-through' : 'none', opacity: item.done ? 0.65 : 1 }}>
                        {item.activityTitle}
                      </strong>
                      <span className="muted small week-grid-card-meta">
                        {minutesToTimeStr(startMin)}–{minutesToTimeStr(endMin)} · {formatTime(item.timeSpentMs)}
                        {overTime ? ' ⚠' : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          }),
        )}
      </div>
    </div>
  )
}
