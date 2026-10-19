import { useEffect, useState, type FormEvent } from 'react'
import { addDoc, collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { Course, LevelId, Session, Topic, TopicType } from '../../types'
import { LEVELS, levelName } from '../../lib/levels'
import { readTopicsFromSessionDoc } from '../../lib/topics'
import { mapCourseDoc } from '../../lib/courses'
import ExamManager from './ExamManager'
import { useAuth } from '../../context/AuthContext'

/** One row of the flattened SL No./Title grid — a Topic plus which Session doc it
 *  currently lives in (needed only so writes know where to save; the grid itself
 *  shows no session boundaries). */
interface FlatRow {
  sessionId: string
  topic: Topic
}

export function SyllabusPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  type LevelFilter = LevelId | 'unassigned'
  const [selectedLevel, setSelectedLevel] = useState<LevelFilter>(1)
  const [newCourseTitle, setNewCourseTitle] = useState('')
  const [newCourseDesc, setNewCourseDesc] = useState('')
  const [addingCourse, setAddingCourse] = useState(false)

  const [sessions, setSessions] = useState<Session[]>([])
  const [newRowTitle, setNewRowTitle] = useState('')
  const [examModalOpen, setExamModalOpen] = useState(false)
  const [editingCourseInfo, setEditingCourseInfo] = useState(false)
  const [editCourseTitle, setEditCourseTitle] = useState('')
  const [editCourseDesc, setEditCourseDesc] = useState('')
  const [editCourseOutcome, setEditCourseOutcome] = useState('')
  // Pure UI mode — every row already saves to Firestore as you blur it (see
  // `commitRowTitle`/`addRow` below), so "Save Syllabus" has nothing left to write;
  // it just confirms you're done and switches to the clean read-only table. Resets
  // to editable whenever a different course is selected.
  const [editingSyllabus, setEditingSyllabus] = useState(true)

  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const { profile } = useAuth()
  const isAdminOrMentor = profile?.roles.some((r) => r === 'admin' || r === 'mentor') ?? false

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

  useEffect(() => { void loadCourses().catch((e) => setError(String(e))) }, [])
  useEffect(() => {
    if (selectedCourseId) { setSessions([]); void loadSessions(selectedCourseId).catch((e) => setError(String(e))) }
  }, [selectedCourseId])

  useEffect(() => { setSelectedCourseId(null) }, [selectedLevel])
  useEffect(() => { setExamModalOpen(false); setEditingSyllabus(true); setEditingCourseInfo(false) }, [selectedCourseId])

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
      <h1>📚 Syllabus Builder</h1>
      <p className="muted">Design your curriculum: Courses → Syllabus.</p>
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
            <button type="button" className="btn primary course-add-btn" onClick={() => setAddingCourse((v) => !v)}>Add Course</button>
          </div>
          {addingCourse && (
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
                    <h2 className="syllabus-active-title">
                      {selectedCourse?.title}
                      <button type="button" className="syllabus-title-edit-btn" title="Rename course" aria-label="Rename course" onClick={openEditCourseInfo}>✎</button>
                    </h2>
                    {selectedCourse?.description ? <p className="muted small" style={{ margin: '0.2rem 0 0' }}>{selectedCourse.description}</p> : null}
                    {selectedCourse?.coreOutcome ? <p className="muted small" style={{ margin: '0.2rem 0 0' }}>🎯 {selectedCourse.coreOutcome}</p> : null}
                  </>
                )}
              </div>
              {editingSyllabus ? (
                <button type="button" className="btn primary" disabled={saving} onClick={() => void saveSyllabus()} style={{ flexShrink: 0 }}>
                  {saving ? 'Saving…' : 'Save Syllabus'}
                </button>
              ) : (
                <button type="button" className="btn secondary" onClick={() => setEditingSyllabus(true)} style={{ flexShrink: 0 }}>Edit</button>
              )}
            </div>

            {editingSyllabus ? (
              <>
                <p className="muted small" style={{ marginBottom: '0.75rem' }}>
                  Type a title below, or paste a list (one per line, or straight from a spreadsheet) into any row — it fills down from there.
                </p>

                <table className="session-topics-table">
                  <thead>
                    <tr>
                      <th className="session-topics-index">SL No.</th>
                      <th>Title</th>
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
                        <td className="session-topics-actions">
                          <div className="session-topics-actions-inner">
                            {isAdminOrMentor && (
                              <button type="button" className="btn small secondary" title="Open exam configuration for this course" onClick={() => setExamModalOpen(true)}>Exam</button>
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
                  </tr>
                </thead>
                <tbody>
                  {flatRows.length === 0 ? (
                    <tr><td colSpan={2} className="muted small">No topics yet.</td></tr>
                  ) : flatRows.map((row, idx) => (
                    <tr key={row.topic.id}>
                      <td className="session-topics-index muted small">{idx + 1}</td>
                      <td className="session-topics-title">{row.topic.title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </div>


      {examModalOpen && selectedCourseId && (
        <div className="modal-backdrop" onClick={() => setExamModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 960, width: '95%' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>📝 Exam — {selectedCourse?.title}</h3>
              <button type="button" className="btn small ghost" onClick={() => setExamModalOpen(false)}>✕</button>
            </div>
            <ExamManager courseId={selectedCourseId} />
          </div>
        </div>
      )}
    </div>
  )
}
