import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { PriorityScheduler } from '../../components/manager/PriorityScheduler'
import {
  todayStr, addDays, mondayOf, timeStrToMinutes,
  createDefaultTimetable, normalizeTimetable, createDefaultElectives, normalizeElectives,
} from '../../components/manager/schedulerShared'
import type { ClassTimetable, DailyPlan, DailyPlanItem, ElectiveSchedule, Weekday } from '../../types'

const JS_DAY_TO_WEEKDAY: (Weekday | null)[] = [null, 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatClockLabel(min: number): string {
  const h = Math.floor(min / 60); const m = min % 60
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${display} ${period}` : `${display}:${String(m).padStart(2, '0')} ${period}`
}

interface TodayItem { id: string; title: string; startMin: number; endMin: number; mentorName: string | null; kind: 'period' | 'elective' }

/** Today's teacher-assigned schedule, flattened and time-sorted — locked periods
 *  plus any claimed elective sessions, for whichever weekday "today" is. An
 *  unclaimed open elective slot isn't really "assigned" yet, so it's left out. */
function todaysItems(timetable: ClassTimetable, electives: ElectiveSchedule): TodayItem[] {
  const weekday = JS_DAY_TO_WEEKDAY[new Date().getDay()]
  if (!weekday) return []
  const periods: TodayItem[] = (timetable.days[weekday]?.periods ?? []).map((p) => {
    const startMin = timeStrToMinutes(p.startTime) ?? 0
    return { id: p.id, title: p.title, mentorName: null, kind: 'period', startMin, endMin: startMin + p.durationMinutes }
  })
  const sessions: TodayItem[] = (electives.days[weekday]?.sessions ?? [])
    .filter((s) => s.claimed)
    .map((s) => {
      const startMin = timeStrToMinutes(s.startTime) ?? 0
      return { id: s.id, title: s.title, mentorName: s.mentorName ?? null, kind: 'elective', startMin, endMin: startMin + s.durationMinutes }
    })
  return [...periods, ...sessions].sort((a, b) => a.startMin - b.startMin)
}

export interface StudentTimetableViewProps {
  /** Overrides the signed-in user — lets the manager's Student Preview tool reuse
   *  this exact view for any student, not just "myself". */
  studentId?: string
}

/**
 * A student's own read-only view of the shared class timetable + elective board,
 * defaulting to a clean "Today" agenda (what a teacher actually assigned for
 * today) with a toggle to the full Mon–Sat grid. Used both by a signed-in
 * student's own Timetable popup and by the manager's Student Preview tool
 * (via `studentId`) — `PriorityScheduler` itself needs no changes for the Full
 * Week mode: every edit affordance is already gated behind `editingAllowed`.
 */
export function StudentTimetableView({ studentId }: StudentTimetableViewProps = {}) {
  const { firebaseUser } = useAuth()
  const uid = studentId ?? firebaseUser?.uid

  const [mode, setMode] = useState<'today' | 'week'>('today')
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

  if (loading || !timetable || !electives) return <p className="muted">Loading…</p>

  const today = todaysItems(timetable, electives)

  return (
    <div className="schedule-page">
      {error ? <p className="error">{error}</p> : null}

      <div className="row" style={{ marginBottom: '1rem' }}>
        <button type="button" className={`btn small ${mode === 'today' ? 'primary' : 'secondary'}`} onClick={() => setMode('today')}>Today</button>
        <button type="button" className={`btn small ${mode === 'week' ? 'primary' : 'secondary'}`} onClick={() => setMode('week')}>Full Week</button>
      </div>

      {mode === 'today' ? (
        today.length === 0 ? (
          <div className="panel" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <p style={{ fontSize: '2rem', margin: 0 }}>🗓️</p>
            <p className="muted" style={{ margin: 0 }}>No classes scheduled for today.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {today.map((item) => (
              <div key={item.id} className="panel" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.9rem 1.1rem' }}>
                <span
                  style={{
                    fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                    padding: '0.2rem 0.55rem', borderRadius: 999, flexShrink: 0,
                    background: item.kind === 'period' ? '#c3fae8' : '#d0ebff',
                    color: item.kind === 'period' ? '#087f5b' : '#1971c2',
                  }}
                >
                  {item.kind === 'period' ? 'Class' : 'Elective'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: '0.95rem' }}>{item.title}</strong>
                  {item.mentorName && <span className="muted small"> · with {item.mentorName}</span>}
                </div>
                <span className="muted small" style={{ flexShrink: 0 }}>
                  {formatClockLabel(item.startMin)} – {formatClockLabel(item.endMin)}
                </span>
              </div>
            ))}
          </div>
        )
      ) : (
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
      )}
    </div>
  )
}
