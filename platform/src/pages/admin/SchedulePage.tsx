import { useEffect, useState, type FormEvent } from 'react'
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { mapUserDoc } from '../../lib/userUtils'
import { mapCourseDoc } from '../../lib/courses'
import { mapActivityTypeDoc, ACTIVITY_TYPE_COLOR_PRESETS } from '../../lib/activityTypes'
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
  computeSubjectWeeklyHours,
} from '../../components/manager/schedulerShared'
import type {
  ActivityType, ClassTimetable, Course, ElectiveSchedule, UserProfile, Weekday,
} from '../../types'

/**
 * Name for the student picker. Staff identify students by name, so the email stays
 * out of the list — it's still shown on the panel header once a student is picked.
 * Legacy docs with no `name` fall back to email, then id, so a row is never blank.
 */
function studentLabel(s: UserProfile): string {
  return s.name || s.email || s.id
}

/** Minutes → hours, rounded to 1 decimal for display (e.g. "4.5 hrs"). */
function fmtHrs(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10
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

  // Syllabus data (the Title field's Subject dropdown draws its items from
  // here) — loaded once, independent of the student/week selection above.
  const [syllabusCourses, setSyllabusCourses] = useState<Course[]>([])
  // Custom non-subject activities (Lunch, Assembly, …) — the Title field's
  // Activity dropdown, managed from the "Manage Activity Types" panel below.
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([])
  const [showActivityTypesModal, setShowActivityTypesModal] = useState(false)

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

  // `class_timetable`/`elective_sessions` are now one doc per week (keyed by
  // `weekStart`, that week's Monday) rather than a single static `master` doc —
  // re-fetches whenever the week changes. `weekHasOwnDoc` tracks whether *this*
  // week has ever been explicitly saved — false shows the "no schedule for this
  // week yet" prompt (with "Copy from Previous Week") below, instead of silently
  // falling back to some other week's data without saying so.
  const [weekHasOwnDoc, setWeekHasOwnDoc] = useState(false)
  const [copyingWeek, setCopyingWeek] = useState(false)

  useEffect(() => {
    setLoadingTimetable(true); setLoadingElectives(true)
    void (async () => {
      try {
        const [weekTT, weekEL] = await Promise.all([
          getDoc(doc(db, 'class_timetable', weekStart)),
          getDoc(doc(db, 'elective_sessions', weekStart)),
        ])
        setWeekHasOwnDoc(weekTT.exists() || weekEL.exists())
        setTimetable(normalizeTimetable(weekTT.exists() ? weekTT.data() : undefined))
        setElectives(normalizeElectives(weekEL.exists() ? weekEL.data() : undefined))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load this week\'s schedule')
        setTimetable(createDefaultTimetable())
        setElectives(createDefaultElectives())
      } finally {
        setLoadingTimetable(false); setLoadingElectives(false)
      }
    })()
  }, [weekStart])

  /** Copies the previous week's schedule into this one — the nearest of: last
   *  week's own saved doc, or (first time anyone uses this on a fresh project)
   *  the legacy `master` doc every pre-migration week effectively was. IDs are
   *  regenerated, same as every other copy action in this file. */
  async function copyFromPreviousWeek() {
    setCopyingWeek(true); setError('')
    try {
      const previousWeek = addDays(weekStart, -7)
      const [prevTT, prevEL, masterTT, masterEL] = await Promise.all([
        getDoc(doc(db, 'class_timetable', previousWeek)),
        getDoc(doc(db, 'elective_sessions', previousWeek)),
        getDoc(doc(db, 'class_timetable', 'master')),
        getDoc(doc(db, 'elective_sessions', 'master')),
      ])
      const sourceTimetable = normalizeTimetable(
        (prevTT.exists() ? prevTT.data() : undefined) ?? (masterTT.exists() ? masterTT.data() : undefined),
      )
      const sourceElectives = normalizeElectives(
        (prevEL.exists() ? prevEL.data() : undefined) ?? (masterEL.exists() ? masterEL.data() : undefined),
      )
      const nextDays = {} as ClassTimetable['days']
      const nextElectiveDays = {} as ElectiveSchedule['days']
      for (const d of WEEKDAYS) {
        nextDays[d] = { periods: sourceTimetable.days[d].periods.map((p) => ({ ...p, id: crypto.randomUUID() })) }
        nextElectiveDays[d] = { sessions: (sourceElectives.days[d]?.sessions ?? []).map((s) => ({ ...s, id: crypto.randomUUID() })) }
      }
      const nextTimetable: ClassTimetable = { windowStart: sourceTimetable.windowStart, windowEnd: sourceTimetable.windowEnd, days: nextDays }
      const nextElectives: ElectiveSchedule = { days: nextElectiveDays }
      await Promise.all([
        setDoc(doc(db, 'class_timetable', weekStart), nextTimetable),
        setDoc(doc(db, 'elective_sessions', weekStart), nextElectives),
      ])
      setTimetable(nextTimetable)
      setElectives(nextElectives)
      setWeekHasOwnDoc(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to copy last week\'s schedule')
    } finally {
      setCopyingWeek(false)
    }
  }

  async function loadSyllabus() {
    try {
      const coursesSnap = await getDocs(collection(db, 'courses'))
      setSyllabusCourses(coursesSnap.docs.map(mapCourseDoc))
    } catch {
      // Non-critical — the Title field's Subject dropdown just comes up empty.
    }
  }

  useEffect(() => { void loadSyllabus() }, [])

  useEffect(() => {
    void (async () => {
      try {
        const snap = await getDocs(collection(db, 'activity_types'))
        setActivityTypes(snap.docs.map(mapActivityTypeDoc))
      } catch {
        // Non-critical, same as the syllabus load above — the title field just
        // falls back to syllabus-only suggestions.
      }
    })()
  }, [])

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
    setWeekHasOwnDoc(true) // any save makes this week an explicitly-saved one
    try {
      await setDoc(doc(db, 'class_timetable', weekStart), next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the class timetable')
    } finally {
      setSaving(false)
    }
  }

  async function saveElectives(next: ElectiveSchedule) {
    setSaving(true); setError('')
    setElectives(next) // optimistic, same as saveTimetable
    setWeekHasOwnDoc(true)
    try {
      await setDoc(doc(db, 'elective_sessions', weekStart), next)
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

      {/* Only the shared schedule is week-scoped — a student override has no
          "which week" dimension of its own, so this prompt is irrelevant there. */}
      {!isOverrideMode && !loadingTimetable && !loadingElectives && !weekHasOwnDoc && (
        <div className="panel" style={{ marginBottom: '1.25rem', background: '#fff8e1', borderColor: '#ffe08a' }}>
          <p style={{ margin: '0 0 0.6rem', fontWeight: 600 }}>
            📭 No schedule for this week. Would you like to copy from last week or create a new one?
          </p>
          <div className="row">
            <button type="button" className="btn small primary" disabled={copyingWeek} onClick={() => void copyFromPreviousWeek()}>
              {copyingWeek ? 'Copying…' : '📋 Copy from Previous Week'}
            </button>
            <span className="muted small">Or just start adding school periods/electives below — that creates this week's schedule too.</span>
          </div>
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

      {(() => {
        const subjectHours = computeSubjectWeeklyHours(effectiveTimetable, effectiveElectives, syllabusCourses)
        if (subjectHours.length === 0) return null
        const weeklyTotal = subjectHours.reduce((sum, s) => sum + s.scheduledMinutes, 0)
        return (
          <div className="panel" style={{ marginBottom: '1.25rem' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.6rem' }}>
              <strong style={{ fontSize: '0.88rem' }}>📊 Subject Hours{isOverrideMode ? ` — ${selectedStudent?.name ?? 'this student'}` : ''}</strong>
              <span className="muted small">Weekly Total: {fmtHrs(weeklyTotal)} hrs</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {subjectHours.map((s) => (
                <span key={s.courseId} className="tag" title="Completed = hours already elapsed so far this week, not an attendance-confirmed count">
                  {s.courseTitle}: {fmtHrs(s.completedMinutes)} / {fmtHrs(s.scheduledMinutes)} hrs this wk
                </span>
              ))}
            </div>
          </div>
        )
      })()}

      <div className="row" style={{ marginBottom: '1.25rem' }}>
        <button type="button" className="btn small secondary" onClick={() => setShowActivityTypesModal(true)}>
          ⚙️ Manage Activity Types
        </button>
      </div>

      {showActivityTypesModal && (
        <ActivityTypesPanel
          activityTypes={activityTypes}
          setActivityTypes={setActivityTypes}
          onClose={() => setShowActivityTypesModal(false)}
        />
      )}

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
          activityTypes={activityTypes}
          onManageActivityTypes={() => setShowActivityTypesModal(true)}
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
 * so staff can generate (once) and copy/open it without touching Firestore by hand. The kiosk
 * page itself never reads this doc — only the `resolveLiveClassKiosk` Cloud
 * Function checks it (with the Admin SDK), server-side, before minting anything.
 */
/**
 * Collapsed to a single button by default — clicking it slides out a side
 * drawer with the actual link, Copy/Open actions, and rotation control. Kept
 * as one component (rather than splitting trigger/drawer) since the token
 * state and actions are only ever needed together.
 */
function LiveClassLinkPanel() {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)

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

  async function generate(confirmMessage: string | null) {
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
    <>
      <div className="row" style={{ marginBottom: '1.25rem' }}>
        <button type="button" className="btn small secondary" onClick={() => setOpen(true)}>
          🟢 Live Class Link
        </button>
      </div>

      {open && (
        <>
          <div className="side-drawer-backdrop open" onClick={() => setOpen(false)} />
          <aside className="side-drawer open">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>🟢 Live Class Link</h3>
              <button type="button" className="btn small ghost" onClick={() => setOpen(false)}>✕</button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              No login needed — open this on a classroom TV/projector to run the class and see who's checked in, live.
            </p>
            {error ? <p className="error small" style={{ margin: 0 }}>{error}</p> : null}
            {loading ? (
              <p className="muted small" style={{ margin: 0 }}>Loading…</p>
            ) : token ? (
              <>
                <label>Link
                  <input readOnly value={liveClassKioskUrl(token)} onFocus={(e) => e.currentTarget.select()} />
                </label>
                <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                  <button type="button" className="btn small secondary" onClick={() => void copyLink()}>{copied ? '✓ Copied' : 'Copy'}</button>
                  <a className="btn small secondary" href={liveClassKioskUrl(token)} target="_blank" rel="noreferrer">Open ↗</a>
                </div>
                <button
                  type="button" className="btn small ghost" disabled={saving}
                  onClick={() => void generate('Rotate the Live Class link? The old link stops working immediately — anyone with it open will need the new one.')}
                >
                  {saving ? 'Rotating…' : '🔄 Rotate link'}
                </button>
              </>
            ) : (
              <button type="button" className="btn small primary" disabled={saving} onClick={() => void generate(null)}>
                {saving ? 'Generating…' : '+ Generate link'}
              </button>
            )}
          </aside>
        </>
      )}
    </>
  )
}

/**
 * CRUD for custom non-subject Activity Types (Lunch, Break, Assembly, Travel,
 * Library, Sports, Chores, …) — `activity_types/{id}`, one flat collection, no
 * per-day/per-week structure (unlike the timetable itself) since these are
 * reusable categories, not bookings. Deleting one doesn't touch any period/
 * elective that already used it — those just keep rendering with the color
 * they were saved with (`activityTypeId` on the item, not a live join).
 */
function ActivityTypesPanel({ activityTypes, setActivityTypes, onClose }: {
  activityTypes: ActivityType[]
  setActivityTypes: (next: ActivityType[]) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📌')
  const [color, setColor] = useState(ACTIVITY_TYPE_COLOR_PRESETS[0]!)
  const [duration, setDuration] = useState(30)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function addType(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true); setError('')
    try {
      const data = { name: trimmed, icon: icon.trim() || '📌', color, defaultDurationMinutes: duration }
      const ref = await addDoc(collection(db, 'activity_types'), data)
      setActivityTypes([...activityTypes, { id: ref.id, ...data }])
      setName(''); setIcon('📌'); setColor(ACTIVITY_TYPE_COLOR_PRESETS[0]!); setDuration(30)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add this activity type')
    } finally {
      setSaving(false)
    }
  }

  async function removeType(a: ActivityType) {
    if (!window.confirm(`Delete "${a.name}"? Periods/electives already using it keep their own color — it just won't show up in search anymore.`)) return
    setError('')
    try {
      await deleteDoc(doc(db, 'activity_types', a.id))
      setActivityTypes(activityTypes.filter((x) => x.id !== a.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete this activity type')
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>⚙️ Manage Activity Types</h3>
          <button type="button" className="btn small ghost" onClick={onClose}>✕</button>
        </div>
        <p className="muted small" style={{ margin: '0 0 1rem' }}>
          Non-subject activities (Lunch, Break, Assembly, Travel, …) — these show up
          alongside syllabus subjects when searching a period's or elective's title,
          and picking one auto-fills its duration and card color.
        </p>

        {error ? <p className="error small" style={{ margin: '0 0 0.75rem' }}>{error}</p> : null}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem', maxHeight: 220, overflowY: 'auto' }}>
          {activityTypes.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No activity types yet — add one below.</p> : null}
          {activityTypes.map((a) => (
            <div key={a.id} className="row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
              <span className="tag" style={{ background: a.color.bg, color: a.color.text, borderColor: a.color.text }}>
                {a.icon} {a.name} · {a.defaultDurationMinutes}m
              </span>
              <button type="button" className="btn small ghost" title={`Delete ${a.name}`} aria-label={`Delete ${a.name}`} onClick={() => void removeType(a)}>🗑️</button>
            </div>
          ))}
        </div>

        <form className="form" onSubmit={(e) => void addType(e)}>
          <div className="row">
            <label style={{ flex: '0 0 64px' }}>Icon
              <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🍽️" maxLength={4} />
            </label>
            <label style={{ flex: 1 }}>Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lunch" required />
            </label>
            <label style={{ flex: '0 0 120px' }}>Duration (min)
              <input type="number" min={5} max={240} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </label>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}>Color</div>
            <div className="row" style={{ gap: '0.4rem' }}>
              {ACTIVITY_TYPE_COLOR_PRESETS.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color option ${i + 1}`}
                  aria-pressed={color.bg === c.bg}
                  style={{
                    width: 28, height: 28, borderRadius: '50%', background: c.bg, cursor: 'pointer',
                    border: color.bg === c.bg ? `2px solid ${c.text}` : '2px solid transparent',
                  }}
                />
              ))}
            </div>
          </div>
          <div className="full">
            <button type="submit" className="btn primary small" disabled={saving}>
              {saving ? 'Adding…' : '+ Add Activity Type'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
