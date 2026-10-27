import { useEffect, useState } from 'react'
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { mapUserDoc } from '../../lib/userUtils'
import { mapCourseDoc } from '../../lib/courses'
import { readTopicsFromSessionDoc } from '../../lib/topics'
import { StudentSelect } from '../../components/StudentSelect'
import { WeekDaySelect, type WeekDayOption } from '../../components/WeekDaySelect'
import { LandscapePrompt } from '../../components/LandscapePrompt'
import { LandscapeExitButton } from '../../components/LandscapeExitButton'
import { useLandscapeFullscreen } from '../../hooks/useLandscapeFullscreen'
import { PriorityScheduler } from '../../components/manager/PriorityScheduler'
import { liveClassKioskUrl } from '../../lib/liveClassKiosk'
import {
  WEEKDAYS, DAY_COLORS,
  todayStr, addDays, mondayOf, formatDayName, formatDayFullName, formatDayDate, formatWeekRangeLabel,
  createDefaultTimetable, normalizeTimetable, createDefaultElectives, normalizeElectives,
} from '../../components/manager/schedulerShared'
import type {
  ClassTimetable, Course, ElectiveSchedule, Session, Topic, UserProfile, Weekday,
} from '../../types'

/**
 * Name for the student picker. Staff identify students by name, so the email stays
 * out of the list — it's still shown on the panel header once a student is picked.
 * Legacy docs with no `name` fall back to email, then id, so a row is never blank.
 */
function studentLabel(s: UserProfile): string {
  return s.name || s.email || s.id
}

/** Sentinel `selectedStudentId` value standing in for "no student" — an explicit,
 *  visible row in the picker rather than a blank/placeholder state, since editing
 *  here always writes *somewhere* (the shared master schedule) and that should
 *  read as a deliberate choice, not the absence of one. */
const DEFAULT_STUDENT_ID = '__ALL__'

/**
 * One grid, two modes, picked by the student dropdown:
 *  - "All Students (Default)" → edits the shared class timetable (Priority 1,
 *    locked) and elective-session board (Priority 2, flexible) everyone sees,
 *    via `<PriorityScheduler />`.
 *  - A specific student → edits that student's own override of the same two
 *    documents (`student_timetables`/`student_electives`, keyed by their uid).
 *    Until they have one, editing shows the master schedule as the starting
 *    point; the first save forks it into a personal copy, independent of the
 *    master from then on. "Reset to Default" deletes the override outright.
 */
export function SchedulePage({ initialStudentId = null }: { initialStudentId?: string | null } = {}) {
  const { promptVisible, isLandscapeFullscreen, useCssRotate, enterLandscape, dismissPrompt, exitLandscape } = useLandscapeFullscreen()
  const [students, setStudents] = useState<UserProfile[]>([])
  const [loadingStudents, setLoadingStudents] = useState(true)
  const [selectedStudentId, setSelectedStudentId] = useState<string>(initialStudentId ?? DEFAULT_STUDENT_ID)
  const [date, setDate] = useState(todayStr())

  const [timetable, setTimetable] = useState<ClassTimetable | null>(null)
  const [loadingTimetable, setLoadingTimetable] = useState(true)
  const [electives, setElectives] = useState<ElectiveSchedule | null>(null)
  const [loadingElectives, setLoadingElectives] = useState(true)
  const [saving, setSaving] = useState(false)

  // A specific student's own override of the two docs above — absent until staff
  // (or the student themself, from their own Timetable view) make a first edit.
  const [studentTimetableOverride, setStudentTimetableOverride] = useState<ClassTimetable | null>(null)
  const [studentElectiveOverride, setStudentElectiveOverride] = useState<ElectiveSchedule | null>(null)
  const [hasOverride, setHasOverride] = useState(false)
  const [loadingOverride, setLoadingOverride] = useState(false)

  // "Copy to Whole Week" — duplicates one day's periods+electives onto every
  // other day of the same shared template (there's no per-calendar-week data
  // to copy "into next week"; every week already renders this one template).
  const [copyWeekOpen, setCopyWeekOpen] = useState(false)
  const [copyWeekSourceDay, setCopyWeekSourceDay] = useState<Weekday>('Mon')

  const [error, setError] = useState('')

  // Syllabus data (Priority 2's "Add elective" title autocomplete draws suggestions
  // from here) — loaded once, independent of the student/week selection above.
  const [syllabusCourses, setSyllabusCourses] = useState<Course[]>([])
  const [syllabusSessions, setSyllabusSessions] = useState<Session[]>([])

  const weekStart = mondayOf(date)
  // Mon–Sat only — no Sunday column. Index-aligned with WEEKDAYS (both start Monday),
  // so weekDates[i] is the real calendar date for WEEKDAYS[i] in the shown week.
  const weekDates = Array.from({ length: 6 }, (_, i) => addDays(weekStart, i))
  const isOverrideMode = selectedStudentId !== DEFAULT_STUDENT_ID

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
    if (!isOverrideMode) { setStudentTimetableOverride(null); setStudentElectiveOverride(null); setHasOverride(false); return }
    void (async () => {
      setLoadingOverride(true); setError('')
      try {
        const [tSnap, eSnap] = await Promise.all([
          getDoc(doc(db, 'student_timetables', selectedStudentId)),
          getDoc(doc(db, 'student_electives', selectedStudentId)),
        ])
        setHasOverride(tSnap.exists() || eSnap.exists())
        setStudentTimetableOverride(tSnap.exists() ? normalizeTimetable(tSnap.data()) : null)
        setStudentElectiveOverride(eSnap.exists() ? normalizeElectives(eSnap.data()) : null)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load this student's schedule")
      } finally {
        setLoadingOverride(false)
      }
    })()
  }, [selectedStudentId, isOverrideMode])

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

  async function saveOverrideTimetable(next: ClassTimetable) {
    setSaving(true); setError('')
    setStudentTimetableOverride(next); setHasOverride(true) // optimistic, same as saveTimetable
    try {
      await setDoc(doc(db, 'student_timetables', selectedStudentId), next)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save this student's timetable")
    } finally {
      setSaving(false)
    }
  }

  async function saveOverrideElectives(next: ElectiveSchedule) {
    setSaving(true); setError('')
    setStudentElectiveOverride(next); setHasOverride(true)
    try {
      await setDoc(doc(db, 'student_electives', selectedStudentId), next)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save this student's electives")
    } finally {
      setSaving(false)
    }
  }

  async function resetToDefault() {
    if (!window.confirm(`Remove ${selectedStudent?.name ?? 'this student'}'s individual schedule and revert to the default?`)) return
    setSaving(true); setError('')
    try {
      await Promise.all([
        deleteDoc(doc(db, 'student_timetables', selectedStudentId)),
        deleteDoc(doc(db, 'student_electives', selectedStudentId)),
      ])
      setStudentTimetableOverride(null); setStudentElectiveOverride(null); setHasOverride(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset to default')
    } finally {
      setSaving(false)
    }
  }

  if (loadingTimetable || loadingElectives || !timetable || !electives) return <p className="muted">Loading…</p>

  const selectedStudent = students.find((s) => s.id === selectedStudentId) ?? null
  const studentOptions = [
    { id: DEFAULT_STUDENT_ID, name: '📋 All Students (Default)' },
    ...students.map((s) => ({ id: s.id, name: studentLabel(s) })),
  ]
  // Until a student has their own saved override, editing shows the master
  // schedule as the starting point — the first save (via saveOverrideTimetable/
  // Electives above) is what actually forks it into a personal copy.
  const effectiveTimetable = isOverrideMode ? (studentTimetableOverride ?? timetable) : timetable
  const effectiveElectives = isOverrideMode ? (studentElectiveOverride ?? electives) : electives

  function confirmCopyWeek() {
    if (!window.confirm(`Copy ${copyWeekSourceDay}'s schedule to every other day this week? This replaces whatever is already scheduled on those days.`)) return
    const sourcePeriods = effectiveTimetable.days[copyWeekSourceDay].periods
    const sourceSessions = effectiveElectives.days[copyWeekSourceDay]?.sessions ?? []
    let nextTimetableDays = effectiveTimetable.days
    let nextElectiveDays = effectiveElectives.days
    for (const d of WEEKDAYS) {
      if (d === copyWeekSourceDay) continue
      nextTimetableDays = { ...nextTimetableDays, [d]: { periods: sourcePeriods.map((p) => ({ ...p, id: crypto.randomUUID() })) } }
      nextElectiveDays = { ...nextElectiveDays, [d]: { sessions: sourceSessions.map((s) => ({ ...s, id: crypto.randomUUID() })) } }
    }
    const saveTT = isOverrideMode ? saveOverrideTimetable : saveTimetable
    const saveEL = isOverrideMode ? saveOverrideElectives : saveElectives
    void saveTT({ ...effectiveTimetable, days: nextTimetableDays })
    void saveEL({ ...effectiveElectives, days: nextElectiveDays })
    setCopyWeekOpen(false)
  }
  const today = todayStr()
  const dayOptions: WeekDayOption[] = weekDates.map((d) => ({
    date: d,
    dayName: formatDayFullName(d),
    dateLabel: formatDayDate(d),
    color: DAY_COLORS[formatDayName(d) as Weekday] ?? { bg: 'var(--surface-soft)', text: 'var(--text)' },
    isToday: d === today,
  }))

  const content = (
    <div className="schedule-page">
      {promptVisible && <LandscapePrompt onSwitch={enterLandscape} onStay={dismissPrompt} />}
      {isLandscapeFullscreen && <LandscapeExitButton onExit={exitLandscape} />}
      {copyWeekOpen && (
        <div className="modal-backdrop" onClick={() => setCopyWeekOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem' }}>Copy to Whole Week</h3>
            <p className="muted small" style={{ margin: '0 0 0.75rem' }}>
              Copies every school period and elective session from the day you pick onto every other day — replacing whatever's already scheduled there.
            </p>
            <div className="form">
              <label>Copy from
                <select value={copyWeekSourceDay} onChange={(e) => setCopyWeekSourceDay(e.target.value as Weekday)}>
                  {WEEKDAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <div className="row">
                <button type="button" className="btn primary" disabled={saving} onClick={confirmCopyWeek}>{saving ? 'Saving…' : 'Copy'}</button>
                <button type="button" className="btn secondary" onClick={() => setCopyWeekOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="diary-toolbar">
        <h1 style={{ margin: 0 }}>🗓️ Schedule</h1>
        <div className="diary-toolbar-controls">
          <StudentSelect students={studentOptions} value={selectedStudentId} onChange={(id) => setSelectedStudentId(id ?? DEFAULT_STUDENT_ID)} loading={loadingStudents} />
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
          <button type="button" className="btn small secondary" onClick={() => { setCopyWeekSourceDay('Mon'); setCopyWeekOpen(true) }}>
            📋 Copy to Whole Week
          </button>
        </div>
      </div>

      {isOverrideMode && (
        <div className="row" style={{ alignItems: 'center', marginBottom: '0.75rem', gap: '0.6rem' }}>
          {loadingOverride ? (
            <span className="muted small">Loading {selectedStudent?.name ?? 'this student'}'s schedule…</span>
          ) : hasOverride ? (
            <>
              <span className="tag" style={{ background: '#fef3c7', borderColor: '#fde68a', color: '#92400e' }}>🏷️ Individual Override</span>
              <button type="button" className="btn small secondary" disabled={saving} onClick={() => void resetToDefault()}>Reset to Default</button>
            </>
          ) : (
            <span className="muted small">
              Editing the default schedule for <strong>{selectedStudent?.name ?? 'this student'}</strong> — the first change creates a personal override.
            </span>
          )}
        </div>
      )}

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
          <span className="muted small">(shared by every student's schedule, including overrides)</span>
        </div>
      </div>

      <LiveClassLinkPanel />

      {error ? <p className="error">{error}</p> : null}

      {!loadingOverride && (
        <PriorityScheduler
          timetable={effectiveTimetable}
          electives={effectiveElectives}
          editingAllowed
          saving={saving}
          onSaveTimetable={isOverrideMode ? saveOverrideTimetable : saveTimetable}
          onSaveElectives={isOverrideMode ? saveOverrideElectives : saveElectives}
          weekDates={weekDates}
          weekPlans={{}}
          syllabusCourses={syllabusCourses}
          syllabusSessions={syllabusSessions}
          onAddSyllabusActivity={addSyllabusActivity}
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

/**
 * Manages the "Live Class" kiosk link's secret token (`settings/liveClassKiosk`)
 * so staff can copy/open/rotate it without touching Firestore by hand. The kiosk
 * page itself never reads this doc — only the `resolveLiveClassKiosk` Cloud
 * Function checks it (with the Admin SDK), server-side, before minting anything.
 */
function LiveClassLinkPanel() {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'liveClassKiosk'))
        setToken(snap.exists() ? ((snap.data().token as string | undefined) ?? null) : null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load the Live Class link')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function rotate(confirmMessage: string | null) {
    if (confirmMessage && !window.confirm(confirmMessage)) return
    setSaving(true)
    setError('')
    try {
      const next = crypto.randomUUID()
      await setDoc(doc(db, 'settings', 'liveClassKiosk'), { token: next, updatedAt: serverTimestamp() })
      setToken(next)
      setCopied(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate the Live Class link')
    } finally {
      setSaving(false)
    }
  }

  async function copyLink() {
    if (!token) return
    try {
      await navigator.clipboard.writeText(liveClassKioskUrl(token))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Could not copy — select and copy the link text manually.')
    }
  }

  return (
    <div className="panel" style={{ marginBottom: '1.25rem' }}>
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between' }}>
        <div>
          <strong style={{ fontSize: '0.88rem' }}>🟢 Live Class link</strong>
          <p className="muted small" style={{ margin: '0.2rem 0 0' }}>
            No login needed — open this on a classroom TV/projector to run the class and see who's checked in, live.
          </p>
        </div>
        {!loading && token && (
          <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
            <input readOnly value={liveClassKioskUrl(token)} style={{ minWidth: 260 }} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn small secondary" onClick={() => void copyLink()}>{copied ? '✓ Copied' : 'Copy'}</button>
            <a className="btn small secondary" href={liveClassKioskUrl(token)} target="_blank" rel="noreferrer">Open ↗</a>
            <button
              type="button"
              className="btn small secondary"
              disabled={saving}
              onClick={() => void rotate('Generate a new link? The old one stops working immediately — update it on any classroom device using it.')}
            >
              🔄 Rotate
            </button>
          </div>
        )}
        {!loading && !token && (
          <button type="button" className="btn small primary" disabled={saving} onClick={() => void rotate(null)}>
            {saving ? 'Generating…' : '+ Generate link'}
          </button>
        )}
      </div>
      {error ? <p className="error small" style={{ margin: '0.5rem 0 0' }}>{error}</p> : null}
    </div>
  )
}
