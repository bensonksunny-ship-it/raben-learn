import { useEffect, useState, type FormEvent } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { ClassTimetable, Course, ElectiveSchedule, LevelId, Session, Topic, TopicType } from '../../types'
import { LEVELS, levelName } from '../../lib/levels'
import { readTopicsFromSessionDoc } from '../../lib/topics'
import { mapCourseDoc } from '../../lib/courses'
import { computeSubjectWeeklyHours, todayStr, weekKeyOf, loadEffectiveWeekSchedule } from '../../components/manager/schedulerShared'
import ExamManager from './ExamManager'
import { useAuth } from '../../context/AuthContext'

/** One row of the flattened SL No./Title grid — a Topic plus which Session doc it
 *  currently lives in (needed only so writes know where to save; the grid itself
 *  shows no session boundaries). */
interface FlatRow {
  sessionId: string
  topic: Topic
}

/** Minutes → hours, rounded to 1 decimal for display (e.g. "4.5 hrs"). */
function fmtHrs(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10
}

export function SyllabusPage({ readOnly = false }: { readOnly?: boolean } = {}) {
  const { profile } = useAuth()
  // Admin, mentor, and consultant all have exam-question-setup rights — matches
  // canEditSyllabus() in firestore.rules, which the exam write rule now follows too.
  const canManageExams = profile?.roles.some((r) => r === 'admin' || r === 'mentor' || r === 'consultant') ?? false
  const isManager = profile?.roles.includes('manager') ?? false
  // Manager reaches this page to take exam papers for printout and check things
  // over — view + print only, never full edit, even though the shared /syllabus
  // route (unlike /admin/syllabus, /mentor/syllabus) doesn't pass a `readOnly`
  // prop, since that same route is also how the Academic Consultant gets their
  // own full-edit access. Only forces read-only when manager is their sole
  // relevant role here — a manager who's also admin/mentor/consultant keeps
  // that role's full access.
  const effectiveReadOnly = readOnly || (isManager && !canManageExams)
  // Manager can open Exam/Main Exam to view and print, but `canManageExams`
  // alone still gates the create/edit/delete/activate controls inside
  // ExamManager itself (via its own `readOnly` prop below) — rules agree:
  // canEditSyllabus() (the exams write rule) doesn't include manager.
  const canSeeExams = canManageExams || isManager

  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  type LevelFilter = LevelId | 'unassigned'
  const [selectedLevel, setSelectedLevel] = useState<LevelFilter>(1)
  const [newCourseTitle, setNewCourseTitle] = useState('')
  const [newCourseDesc, setNewCourseDesc] = useState('')
  const [addingCourse, setAddingCourse] = useState(false)

  const [sessions, setSessions] = useState<Session[]>([])
  // Every session across every course, loaded once — not filtered to the selected
  // course like `sessions` above. Only used to show each OTHER course's "required
  // hours" total in the course list; the selected course's own total is computed
  // straight from `flatRows` below instead, so it stays live between edits without
  // needing a reload of this.
  const [allSessions, setAllSessions] = useState<Session[]>([])
  // Loaded once for the "completed this week" half of the hours badge — the same
  // shared schedule the Schedule page edits, read here purely to tally scheduled/
  // completed minutes per subject via `computeSubjectWeeklyHours`.
  const [scheduleTimetable, setScheduleTimetable] = useState<ClassTimetable | null>(null)
  const [scheduleElectives, setScheduleElectives] = useState<ElectiveSchedule | null>(null)
  const [newRowTitle, setNewRowTitle] = useState('')
  // null = closed; 'main' = the course's whole-subject exam(s), no topic; an
  // object = scoped to that one topic row's exam(s).
  const [examModalTopic, setExamModalTopic] = useState<'main' | { id: string; title: string } | null>(null)
  const [editingCourseInfo, setEditingCourseInfo] = useState(false)
  const [courseMenuOpen, setCourseMenuOpen] = useState(false)
  const [editCourseTitle, setEditCourseTitle] = useState('')
  const [editCourseDesc, setEditCourseDesc] = useState('')
  const [editCourseOutcome, setEditCourseOutcome] = useState('')
  // Pure UI mode — every row already saves to Firestore as you blur it (see
  // `commitRowTitle`/`addRow` below), so "Save Syllabus" has nothing left to write;
  // it just confirms you're done and switches to the clean read-only table. Resets
  // to editable whenever a different course is selected.
  const [editingSyllabus, setEditingSyllabus] = useState(!effectiveReadOnly)

  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const selectedCourse = courses.find((c) => c.id === selectedCourseId) ?? null

  const visibleCourses = courses.filter((c) =>
    selectedLevel === 'unassigned' ? c.levelId === null : c.levelId === selectedLevel,
  )

  /** Every topic from every session of the selected course, flattened into one
   *  ordered list (session order, then position within that session) — the whole
   *  session concept is invisible past this point; "SL No." is just `index + 1`. */
  const flatRows: FlatRow[] = [...sessions]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .flatMap((s) => s.activities.map((topic) => ({ sessionId: s.id, topic })))

  async function loadCourses() {
    const snap = await getDocs(collection(db, 'courses'))
    const list: Course[] = []
    snap.forEach((d) => list.push(mapCourseDoc(d)))
    list.sort((a, b) => a.title.localeCompare(b.title))
    setCourses(list)
  }

  async function loadSessions(courseId: string) {
    const snap = await getDocs(query(collection(db, 'sessions'), where('courseId', '==', courseId)))
    const list: Session[] = []
    snap.forEach((d) => {
      const x = d.data()
      const topics = readTopicsFromSessionDoc(x.activities)
      list.push({
        id: d.id,
        title: (x.title as string) ?? '',
        subtitle: (x.subtitle as string) ?? '',
        courseName: (x.courseName as string) ?? '',
        courseId: (x.courseId as string) ?? null,
        order: Number(x.order ?? 0),
        durationMinutes: Number(x.durationMinutes ?? 0),
        activities: topics,
      })
    })
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title))
    setSessions(list)
  }

  async function loadAllSessions() {
    const snap = await getDocs(collection(db, 'sessions'))
    const list: Session[] = []
    snap.forEach((d) => {
      const x = d.data()
      list.push({
        id: d.id,
        title: (x.title as string) ?? '',
        subtitle: (x.subtitle as string) ?? '',
        courseName: (x.courseName as string) ?? '',
        courseId: (x.courseId as string) ?? null,
        order: Number(x.order ?? 0),
        durationMinutes: Number(x.durationMinutes ?? 0),
        activities: readTopicsFromSessionDoc(x.activities),
      })
    })
    setAllSessions(list)
  }

  /** Sum of every topic's `durationMinutes` across every session of `courseId`,
   *  in whole hours (rounded to 1 decimal) — the "required hours" badge. */
  function courseHours(courseId: string): number {
    const list = courseId === selectedCourseId ? sessions : allSessions.filter((s) => s.courseId === courseId)
    const minutes = list.reduce((sum, s) => sum + s.activities.reduce((a, t) => a + (t.durationMinutes ?? 0), 0), 0)
    return Math.round((minutes / 60) * 10) / 10
  }

  async function loadScheduleForHours() {
    const { timetable, electives } = await loadEffectiveWeekSchedule(db, weekKeyOf(todayStr()))
    setScheduleTimetable(timetable)
    setScheduleElectives(electives)
  }

  // courseId -> { scheduledMinutes, completedMinutes } this week, from the shared
  // schedule — null entries (not yet loaded, or nothing scheduled) just mean no badge.
  const weeklyHoursByCourse = scheduleTimetable && scheduleElectives
    ? new Map(computeSubjectWeeklyHours(scheduleTimetable, scheduleElectives, courses).map((h) => [h.courseId, h]))
    : new Map<string, ReturnType<typeof computeSubjectWeeklyHours>[number]>()

  useEffect(() => { void loadCourses().catch((e) => setError(String(e))) }, [])
  useEffect(() => { void loadAllSessions().catch((e) => setError(String(e))) }, [])
  useEffect(() => { void loadScheduleForHours().catch(() => { /* non-critical — badge just stays hidden */ }) }, [])
  useEffect(() => {
    if (selectedCourseId) { setSessions([]); void loadSessions(selectedCourseId).catch((e) => setError(String(e))) }
  }, [selectedCourseId])

  useEffect(() => { setSelectedCourseId(null) }, [selectedLevel])
  useEffect(() => { setExamModalTopic(null); setEditingSyllabus(true); setEditingCourseInfo(false); setCourseMenuOpen(false) }, [selectedCourseId])

  async function createCourse(e: FormEvent) {
    e.preventDefault()
    if (!newCourseTitle.trim()) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'courses'), {
        title: newCourseTitle.trim(),
        description: newCourseDesc.trim(),
        levelId: selectedLevel === 'unassigned' ? null : selectedLevel,
        createdAt: serverTimestamp(),
      })
      setNewCourseTitle(''); setNewCourseDesc(''); setAddingCourse(false)
      await loadCourses()
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed') } finally { setSaving(false) }
  }

  function openEditCourseInfo() {
    if (!selectedCourse) return
    setEditCourseTitle(selectedCourse.title)
    setEditCourseDesc(selectedCourse.description ?? '')
    setEditCourseOutcome(selectedCourse.coreOutcome ?? '')
    setEditingCourseInfo(true)
  }

  /** Writes straight to the `courses` doc, then reloads the shared `courses` list —
   *  both the left Courses panel and this view's large title read off that same
   *  state, so one reload updates both at once. Sessions also carry their own
   *  denormalized `courseName` snapshot (that's what Schedule's "Add elective" title
   *  autocomplete shows as a suggestion's detail text — "Session · {courseName}"),
   *  so a rename pushes the new title onto every one of this course's sessions too;
   *  otherwise that one spot would keep showing the old name until each session
   *  doc happened to be rewritten some other way. Core outcome lives here too (not
   *  just title/description) — this is now the only place that edits it, since
   *  Planning was removed. */
  async function saveCourseInfo(e: FormEvent) {
    e.preventDefault()
    if (!selectedCourseId) return
    const title = editCourseTitle.trim()
    if (!title) { setError('Course title is required.'); return }
    setSaving(true); setError('')
    try {
      await updateDoc(doc(db, 'courses', selectedCourseId), { title, description: editCourseDesc.trim(), coreOutcome: editCourseOutcome.trim() })
      await Promise.all(sessions.map((s) => updateDoc(doc(db, 'sessions', s.id), { courseName: title })))
      setEditingCourseInfo(false)
      await loadCourses()
      await loadSessions(selectedCourseId)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to update course') } finally { setSaving(false) }
  }

  /** Deletes the course doc and every session doc under it (its syllabus) — a
   *  course has no content of its own once those are gone, so nothing's left
   *  orphaned. Confirmed once before anything is touched. */
  async function deleteCourse() {
    if (!selectedCourseId) return
    if (!window.confirm('Are you sure you want to delete this course and its syllabus? This cannot be undone.')) return
    setSaving(true); setError('')
    try {
      await Promise.all(sessions.map((s) => deleteDoc(doc(db, 'sessions', s.id))))
      await deleteDoc(doc(db, 'courses', selectedCourseId))
      setSelectedCourseId(null)
      await loadCourses()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete course')
    } finally {
      setSaving(false)
    }
  }

  // ─── Flattened Syllabus grid ────────────────────────────────────────────────
  // All grid mutations fold through `commitFlatTopics`: it writes the complete
  // new topic list onto one canonical session (the course's lowest-order one,
  // created on first use if none exists yet) and empties any other sessions'
  // `activities` the course happens to still have (from the old per-session UI,
  // or a multi-sheet Excel import) — so the grid never has to reason about which
  // session a row "belongs to", and nothing is ever silently lost, just merged.

  async function getOrCreateCanonicalSessionId(): Promise<string> {
    const sorted = [...sessions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    if (sorted.length > 0) return sorted[0]!.id
    const ref = await addDoc(collection(db, 'sessions'), {
      courseId: selectedCourseId,
      courseName: selectedCourse?.title ?? '',
      title: selectedCourse?.title ?? 'Syllabus',
      order: 1,
      durationMinutes: 0,
      activities: [],
      createdAt: serverTimestamp(),
    })
    return ref.id
  }

  async function commitFlatTopics(newTopics: Topic[]) {
    if (!selectedCourseId) return
    setSaving(true); setError('')
    try {
      const otherSessionIds = [...sessions]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .slice(1)
        .map((s) => s.id)
      const canonicalId = await getOrCreateCanonicalSessionId()
      await updateDoc(doc(db, 'sessions', canonicalId), { activities: newTopics, updatedAt: serverTimestamp() })
      await Promise.all(otherSessionIds.map((id) => updateDoc(doc(db, 'sessions', id), { activities: [], updatedAt: serverTimestamp() })))
      await loadSessions(selectedCourseId)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to save') } finally { setSaving(false) }
  }

  /** Local-only edit while typing — keeps the input responsive without a Firestore
   *  round trip per keystroke. `commitRowTitle` below is what actually saves it. */
  function setLocalTopicTitle(topicId: string, title: string) {
    setSessions((prev) => prev.map((s) => ({ ...s, activities: s.activities.map((t) => (t.id === topicId ? { ...t, title } : t)) })))
  }

  function setLocalTopicDuration(topicId: string, durationMinutes: number) {
    setSessions((prev) => prev.map((s) => ({ ...s, activities: s.activities.map((t) => (t.id === topicId ? { ...t, durationMinutes } : t)) })))
  }

  async function commitRowDuration() {
    if (!selectedCourseId) return
    await commitFlatTopics(flatRows.map((r) => r.topic))
  }

  async function commitRowTitle(topicId: string) {
    if (!selectedCourseId) return
    const topic = flatRows.find((r) => r.topic.id === topicId)?.topic
    if (!topic) return
    if (!topic.title.trim()) { await loadSessions(selectedCourseId); return }
    await commitFlatTopics(flatRows.map((r) => r.topic))
  }

  async function addRow(title: string) {
    const trimmed = title.trim()
    if (!trimmed) return
    const next = [...flatRows.map((r) => r.topic), { id: crypto.randomUUID(), title: trimmed, type: 'concept' as TopicType, remark: '' }]
    setNewRowTitle('')
    await commitFlatTopics(next)
  }

  async function deleteRow(topicId: string) {
    if (!window.confirm('Delete this row?')) return
    await commitFlatTopics(flatRows.filter((r) => r.topic.id !== topicId).map((r) => r.topic))
  }

  async function moveRow(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= flatRows.length) return
    const topics = flatRows.map((r) => r.topic)
    const tmp = topics[index]!
    topics[index] = topics[target]!
    topics[target] = tmp
    await commitFlatTopics(topics)
  }

  /** Parses pasted text into an ordered list of titles — plain lines, lines
   *  prefixed with "1." / "1)" / "1 -" (stripped, since SL No. is always
   *  reassigned by position), or tab-separated rows (last non-empty cell wins,
   *  so pasting a two-column "SL No. / Title" block works). A header-looking
   *  first line ("SL No" / "Title") is dropped. */
  function parsePasteLines(text: string): string[] {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
    if (lines.length === 0) return []
    const first = lines[0]!
    const firstCells = first.split('\t').map((c) => c.trim().toLowerCase())
    const looksLikeHeader = firstCells.some((c) => c === 'sl no' || c === 'sl no.' || c === 'sl')
      && (firstCells.includes('title') || firstCells.length === 1)
    const body = looksLikeHeader ? lines.slice(1) : lines
    return body
      .map((line) => {
        let cell = line
        if (cell.includes('\t')) {
          const cells = cell.split('\t').map((c) => c.trim()).filter((c) => c.length > 0)
          cell = cells[cells.length - 1] ?? ''
        }
        return cell.replace(/^\s*\d+\s*[.)-]\s*/, '').trim()
      })
      .filter((t) => t.length > 0)
  }

  /** Spreadsheet-style fill-down: starting at `startIndex`, pasted titles overwrite
   *  that many existing rows' titles and append the rest as new rows — nothing
   *  before `startIndex` is touched. */
  function buildPastedTopics(startIndex: number, titles: string[]): Topic[] {
    const current = flatRows.map((r) => r.topic)
    const before = current.slice(0, startIndex)
    const overwriteCount = Math.min(titles.length, Math.max(0, current.length - startIndex))
    const overwritten = current.slice(startIndex, startIndex + overwriteCount).map((t, i) => ({ ...t, title: titles[i]! }))
    const added: Topic[] = titles.slice(overwriteCount).map((t) => ({ id: crypto.randomUUID(), title: t, type: 'concept', remark: '' }))
    const after = current.slice(startIndex + overwriteCount)
    return [...before, ...overwritten, ...added, ...after]
  }

  async function handleGridPaste(startIndex: number, text: string) {
    const titles = parsePasteLines(text)
    if (titles.length === 0) return
    if (startIndex >= flatRows.length) setNewRowTitle('')
    await commitFlatTopics(buildPastedTopics(startIndex, titles))
  }

  /** "Save Syllabus" — every row already commits on blur, so this just catches
   *  whatever's still sitting in the "add a title" row before switching to the
   *  read-only view. */
  async function saveSyllabus() {
    if (newRowTitle.trim()) await addRow(newRowTitle)
    setEditingSyllabus(false)
  }

  return (
    <div>
      <h1 style={{ marginBottom: '1rem' }}>📚 Syllabus Builder</h1>
      {error ? <p className="error">{error}</p> : null}

      <div className="course-tabs" style={{ marginBottom: '0.85rem' }}>
        {LEVELS.map((lvl) => (
          <button key={lvl} type="button" className={`course-tab${selectedLevel === lvl ? ' active' : ''}`} onClick={() => setSelectedLevel(lvl)}>
            {levelName(lvl)}
          </button>
        ))}
        <button type="button" className={`course-tab${selectedLevel === 'unassigned' ? ' active' : ''}`} onClick={() => setSelectedLevel('unassigned')}>
          Unassigned
        </button>
      </div>

      <div className="syllabus-columns">
        {/* COURSES */}
        <div className="syllabus-col" style={{ flex: '0 0 480px' }}>
          <div className="syllabus-col-header">
            <h2>📖 Courses</h2>
            {!effectiveReadOnly && (
              <button type="button" className="btn primary course-add-btn" onClick={() => setAddingCourse((v) => !v)}>Add Course</button>
            )}
          </div>
          {!effectiveReadOnly && addingCourse && (
            <form onSubmit={(e) => void createCourse(e)} className="form syllabus-mini-form">
              <input placeholder="Course title *" value={newCourseTitle} onChange={(e) => setNewCourseTitle(e.target.value)} required autoFocus />
              <input placeholder="Description (optional)" value={newCourseDesc} onChange={(e) => setNewCourseDesc(e.target.value)} />
              <div className="row">
                <button type="submit" className="btn small primary" disabled={saving}>Save</button>
                <button type="button" className="btn small secondary" onClick={() => setAddingCourse(false)}>Cancel</button>
              </div>
            </form>
          )}
          <div className="course-card-list">
            {visibleCourses.map((c, idx) => (
              <button
                key={c.id}
                type="button"
                className={`course-row-card${selectedCourseId === c.id ? ' active' : ''}`}
                onClick={() => setSelectedCourseId(c.id)}
                aria-pressed={selectedCourseId === c.id}
              >
                <span className="course-row-index">{idx + 1}</span>
                <span className="course-row-body">
                  <span className="course-row-title">{c.title}</span>
                  {c.description ? <span className="course-row-tag">{c.description}</span> : null}
                  {courseHours(c.id) > 0 && <span className="course-row-tag">⏱ {courseHours(c.id)} hrs total</span>}
                  {weeklyHoursByCourse.get(c.id) && (() => {
                    const h = weeklyHoursByCourse.get(c.id)!
                    return (
                      <span className="course-row-tag" title="Completed = hours elapsed this week">
                        📅 {fmtHrs(h.completedMinutes)}/{courseHours(c.id)} hrs completed · Scheduled: {fmtHrs(h.scheduledMinutes)} hrs/wk
                      </span>
                    )
                  })()}
                </span>
              </button>
            ))}
            {visibleCourses.length === 0 ? <p className="muted small course-row-empty">No courses at this level yet.</p> : null}
          </div>
        </div>

        {/* SYLLABUS — flat SL No./Title grid */}
        {selectedCourseId ? (
          <div className="syllabus-col syllabus-col-wide">
            <div className="syllabus-col-header" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {editingCourseInfo ? (
                  <form onSubmit={(e) => void saveCourseInfo(e)} className="form syllabus-mini-form" style={{ marginBottom: 0 }}>
                    <input value={editCourseTitle} onChange={(e) => setEditCourseTitle(e.target.value)} placeholder="Course title *" required autoFocus />
                    <input value={editCourseDesc} onChange={(e) => setEditCourseDesc(e.target.value)} placeholder="Description (optional)" />
                    <textarea
                      value={editCourseOutcome}
                      onChange={(e) => setEditCourseOutcome(e.target.value)}
                      placeholder="Core outcome (optional) — what a student should be able to do after this course"
                      style={{ width: '100%', minHeight: 60, fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '0.5rem' }}
                    />
                    <div className="row">
                      <button type="submit" className="btn small primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                      <button type="button" className="btn small secondary" onClick={() => setEditingCourseInfo(false)}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <>
                    {courseMenuOpen && (
                      <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={() => setCourseMenuOpen(false)} />
                    )}
                    <h2 className="syllabus-active-title">
                      {selectedCourse?.title}
                      {!effectiveReadOnly && (
                        <div className="topic-menu-wrap" style={{ display: 'inline-block', marginLeft: '0.4rem', verticalAlign: 'middle' }}>
                          <button
                            type="button"
                            className="syllabus-title-edit-btn"
                            title="Course options"
                            aria-label="Course options"
                            onClick={() => setCourseMenuOpen((v) => !v)}
                          >
                            ✎
                          </button>
                          {courseMenuOpen && (
                            <div className="topic-menu-dropdown">
                              <button
                                type="button"
                                className="topic-menu-item"
                                onClick={() => { setCourseMenuOpen(false); openEditCourseInfo() }}
                              >
                                ✎ Edit / Rename Course
                              </button>
                              <button
                                type="button"
                                className="topic-menu-item danger"
                                disabled={saving}
                                onClick={() => { setCourseMenuOpen(false); void deleteCourse() }}
                              >
                                🗑️ Delete Course
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </h2>
                    {selectedCourse?.description ? <p className="muted small" style={{ margin: '0.2rem 0 0' }}>{selectedCourse.description}</p> : null}
                    {selectedCourse?.coreOutcome ? <p className="muted small" style={{ margin: '0.2rem 0 0' }}>🎯 {selectedCourse.coreOutcome}</p> : null}
                    {selectedCourseId && courseHours(selectedCourseId) > 0 && (
                      <p className="muted small" style={{ margin: '0.2rem 0 0' }}>⏱ {courseHours(selectedCourseId)} hrs total</p>
                    )}
                    {selectedCourseId && weeklyHoursByCourse.get(selectedCourseId) && (() => {
                      const h = weeklyHoursByCourse.get(selectedCourseId)!
                      return (
                        <p className="muted small" style={{ margin: '0.2rem 0 0' }} title="Completed = hours elapsed this week">
                          📅 {fmtHrs(h.completedMinutes)} / {courseHours(selectedCourseId)} hrs completed · Scheduled: {fmtHrs(h.scheduledMinutes)} hrs/wk
                        </p>
                      )
                    })()}
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                {canSeeExams && (
                  <button type="button" className="btn secondary" title="Whole-course exam(s)" onClick={() => setExamModalTopic('main')}>
                    🎓 Main Exam
                  </button>
                )}
                {!effectiveReadOnly && (editingSyllabus ? (
                  <button type="button" className="btn primary" disabled={saving} onClick={() => void saveSyllabus()}>
                    {saving ? 'Saving…' : 'Save Syllabus'}
                  </button>
                ) : (
                  <button type="button" className="btn secondary" onClick={() => setEditingSyllabus(true)}>Edit</button>
                ))}
              </div>
            </div>

            {editingSyllabus ? (
              <>
                <table className="session-topics-table">
                  <thead>
                    <tr>
                      <th className="session-topics-index">SL No.</th>
                      <th>Title</th>
                      <th style={{ width: 90 }}>Min</th>
                      <th aria-hidden="true" />
                    </tr>
                  </thead>
                  <tbody>
                    {flatRows.map((row, idx) => (
                      <tr key={row.topic.id}>
                        <td className="session-topics-index muted small">{idx + 1}</td>
                        <td className="session-topics-title">
                          <input
                            className="syllabus-grid-input"
                            value={row.topic.title}
                            onChange={(e) => setLocalTopicTitle(row.topic.id, e.target.value)}
                            onBlur={() => void commitRowTitle(row.topic.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            onPaste={(e) => { e.preventDefault(); void handleGridPaste(idx, e.clipboardData.getData('text/plain')) }}
                            disabled={saving}
                          />
                        </td>
                        <td className="session-topics-title">
                          <input
                            type="number" min={0} step={5}
                            className="syllabus-grid-input"
                            value={row.topic.durationMinutes ?? 0}
                            onChange={(e) => setLocalTopicDuration(row.topic.id, Number(e.target.value))}
                            onBlur={() => void commitRowDuration()}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            disabled={saving}
                          />
                        </td>
                        <td className="session-topics-actions">
                          <div className="session-topics-actions-inner">
                            {canSeeExams && (
                              <button
                                type="button"
                                className="btn small secondary"
                                onClick={() => setExamModalTopic({ id: row.topic.id, title: row.topic.title })}
                              >
                                Exam
                              </button>
                            )}
                            <button type="button" className="btn small ghost" title="Move up" disabled={idx === 0 || saving} onClick={() => void moveRow(idx, -1)}>↑</button>
                            <button type="button" className="btn small ghost" title="Move down" disabled={idx === flatRows.length - 1 || saving} onClick={() => void moveRow(idx, 1)}>↓</button>
                            <button type="button" className="btn small ghost" title="Delete" disabled={saving} onClick={() => void deleteRow(row.topic.id)}>✕</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="session-topics-index muted small">{flatRows.length + 1}</td>
                      <td className="session-topics-title">
                        <input
                          className="syllabus-grid-input"
                          placeholder="Type a title, or paste a list…"
                          value={newRowTitle}
                          onChange={(e) => setNewRowTitle(e.target.value)}
                          onBlur={() => void addRow(newRowTitle)}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          onPaste={(e) => { e.preventDefault(); void handleGridPaste(flatRows.length, e.clipboardData.getData('text/plain')) }}
                          disabled={saving}
                        />
                      </td>
                      <td className="session-topics-title" />
                      <td className="session-topics-actions" />
                    </tr>
                  </tbody>
                </table>
              </>
            ) : (
              <table className="session-topics-table readonly">
                <thead>
                  <tr>
                    <th className="session-topics-index">SL No.</th>
                    <th>Title</th>
                    <th style={{ width: 90 }}>Min</th>
                    {canSeeExams && <th aria-hidden="true" />}
                  </tr>
                </thead>
                <tbody>
                  {flatRows.length === 0 ? (
                    <tr><td colSpan={canSeeExams ? 4 : 3} className="muted small">No topics yet.</td></tr>
                  ) : flatRows.map((row, idx) => (
                    <tr key={row.topic.id}>
                      <td className="session-topics-index muted small">{idx + 1}</td>
                      <td className="session-topics-title">{row.topic.title}</td>
                      <td className="session-topics-title muted small">{row.topic.durationMinutes || '—'}</td>
                      {canSeeExams && (
                        <td className="session-topics-actions">
                          <button
                            type="button"
                            className="btn small secondary"
                            title="Open exams for this topic"
                            onClick={() => setExamModalTopic({ id: row.topic.id, title: row.topic.title })}
                          >
                            Exam
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </div>


      {examModalTopic && selectedCourseId && (
        <div className="modal-backdrop" onClick={() => setExamModalTopic(null)}>
          <div className="modal" style={{ maxWidth: 960, width: '95%' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>
                📝 {examModalTopic === 'main' ? `Main Exam — ${selectedCourse?.title}` : `Exam — ${examModalTopic.title}`}
              </h3>
              <button type="button" className="btn small ghost" onClick={() => setExamModalTopic(null)}>✕</button>
            </div>
            <ExamManager courseId={selectedCourseId} topic={examModalTopic === 'main' ? null : examModalTopic} readOnly={!canManageExams} />
          </div>
        </div>
      )}
    </div>
  )
}
