import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { Activity, Course, LessonItemType, Session } from '../../types'

function newActivity(): Activity { return { id: crypto.randomUUID(), type: 'concept', title: '', remark: '' } }
function newActivityOfType(type: LessonItemType): Activity { return { id: crypto.randomUUID(), type, title: '', remark: '' } }
function activityTypeLabel(t: LessonItemType | string) {
  if (t === 'concept') return 'Concept'
  if (t === 'exercise') return 'Exercise'
  if (t === 'custom') return 'Custom'
  return 'Implementation'
}
function activityTypeColor(t: LessonItemType | string) {
  if (t === 'concept') return { bg: '#dbeafe', text: '#1e40af' }
  if (t === 'exercise') return { bg: '#dcfce7', text: '#166534' }
  if (t === 'custom') return { bg: '#f3f4f6', text: '#374151' }
  return { bg: '#fce7f3', text: '#9d174d' }
}

export function SyllabusPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [newCourseTitle, setNewCourseTitle] = useState('')
  const [newCourseDesc, setNewCourseDesc] = useState('')
  const [addingCourse, setAddingCourse] = useState(false)

  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionFormOpen, setSessionFormOpen] = useState(false)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState('')
  const [sessionOrder, setSessionOrder] = useState(1)
  const [sessionActivities, setSessionActivities] = useState<Activity[]>([newActivity()])

  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)

  const xlsxInputRef = useRef<HTMLInputElement>(null)

  const selectedCourse = courses.find((c) => c.id === selectedCourseId) ?? null

  const [addActivitySessionId, setAddActivitySessionId] = useState<string | null>(null)
  const [addActivityTitle, setAddActivityTitle] = useState('')
  const [addActivityType, setAddActivityType] = useState<LessonItemType>('concept')

  async function loadCourses() {
    const snap = await getDocs(collection(db, 'courses'))
    const list: Course[] = []
    snap.forEach((d) => {
      const x = d.data()
      list.push({ id: d.id, title: (x.title as string) ?? '', description: (x.description as string) ?? '' })
    })
    list.sort((a, b) => a.title.localeCompare(b.title))
    setCourses(list)
  }

  async function loadSessions(courseId: string) {
    const snap = await getDocs(query(collection(db, 'sessions'), where('courseId', '==', courseId)))
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
        activities: (x.activities as Session['activities']) ?? [],
      })
    })
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title))
    setSessions(list)
  }

  useEffect(() => { void loadCourses().catch((e) => setError(String(e))) }, [])
  useEffect(() => {
    if (selectedCourseId) { setSessions([]); void loadSessions(selectedCourseId).catch((e) => setError(String(e))) }
  }, [selectedCourseId])

  async function createCourse(e: FormEvent) {
    e.preventDefault()
    if (!newCourseTitle.trim()) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'courses'), { title: newCourseTitle.trim(), description: newCourseDesc.trim(), createdAt: serverTimestamp() })
      setNewCourseTitle(''); setNewCourseDesc(''); setAddingCourse(false)
      await loadCourses()
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed') } finally { setSaving(false) }
  }

  function openNewSessionForm() {
    setEditingSessionId(null)
    setSessionTitle('')
    setSessionOrder(sessions.length + 1)
    setSessionActivities([newActivity()])
    setSessionFormOpen(true)
  }

  function openEditSessionForm(session: Session) {
    setEditingSessionId(session.id)
    setSessionTitle(session.title)
    setSessionOrder(session.order ?? 1)
    setSessionActivities(session.activities.length > 0 ? [...session.activities] : [newActivity()])
    setSessionFormOpen(true)
  }

  async function saveSession(e: FormEvent) {
    e.preventDefault()
    if (!selectedCourseId) return
    const cleaned = sessionActivities.map((a) => ({ ...a, title: a.title.trim(), remark: (a.remark ?? '').trim() })).filter((a) => a.title.length > 0)
    if (!sessionTitle.trim()) { setError('Session title is required.'); return }
    if (cleaned.length === 0) { setError('Add at least one activity.'); return }
    setSaving(true); setError('')
    try {
      const data = { courseId: selectedCourseId, courseName: selectedCourse?.title ?? '', title: sessionTitle.trim(), order: sessionOrder, activities: cleaned, updatedAt: serverTimestamp() }
      if (editingSessionId) await updateDoc(doc(db, 'sessions', editingSessionId), data)
      else await addDoc(collection(db, 'sessions'), { ...data, createdAt: serverTimestamp() })
      setSessionFormOpen(false)
      await loadSessions(selectedCourseId)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to save session') } finally { setSaving(false) }
  }

  async function deleteSession(id: string) {
    if (!selectedCourseId) return
    if (!window.confirm('Delete this session?')) return
    try { await deleteDoc(doc(db, 'sessions', id)); await loadSessions(selectedCourseId) }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed') }
  }

  function openAddActivity(session: Session) {
    setAddActivitySessionId(session.id)
    setAddActivityTitle('')
    setAddActivityType('concept')
  }

  async function saveAddActivity() {
    if (!selectedCourseId || !addActivitySessionId) return
    const session = sessions.find((s) => s.id === addActivitySessionId) ?? null
    if (!session) return
    const title = addActivityTitle.trim()
    if (!title) { setError('Activity title is required.'); return }

    setSaving(true); setError('')
    try {
      const next = [...(session.activities ?? []), { id: crypto.randomUUID(), title, type: addActivityType, remark: '' }]
      await updateDoc(doc(db, 'sessions', session.id), { activities: next, updatedAt: serverTimestamp() })
      setAddActivitySessionId(null)
      await loadSessions(selectedCourseId)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed') } finally { setSaving(false) }
  }

  function updateActivity(index: number, patch: Partial<Activity>) { setSessionActivities((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it))) }
  function removeActivity(index: number) { setSessionActivities((prev) => prev.filter((_, i) => i !== index)) }

  async function updateActivityInline(session: Session, activityId: string, patch: Partial<Activity>) {
    if (!selectedCourseId) return
    setSaving(true); setError('')
    try {
      const next = session.activities.map((a) => (a.id === activityId ? { ...a, ...patch } : a))
      await updateDoc(doc(db, 'sessions', session.id), { activities: next, updatedAt: serverTimestamp() })
      await loadSessions(selectedCourseId)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed') } finally { setSaving(false) }
  }

  async function deleteActivityInline(session: Session, activityId: string) {
    if (!selectedCourseId) return
    if (!window.confirm('Delete this activity?')) return
    setSaving(true); setError('')
    try {
      const next = session.activities.filter((a) => a.id !== activityId)
      if (next.length === 0) { setError('A session must have at least one activity.'); return }
      await updateDoc(doc(db, 'sessions', session.id), { activities: next, updatedAt: serverTimestamp() })
      await loadSessions(selectedCourseId)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed') } finally { setSaving(false) }
  }

  async function quickEditActivityTitle(session: Session, a: Activity) {
    const nextTitle = window.prompt('Edit activity title', a.title)
    if (nextTitle == null) return
    const cleaned = nextTitle.trim()
    if (!cleaned) return
    await updateActivityInline(session, a.id, { title: cleaned })
  }

  function parseActivityType(raw: string): LessonItemType {
    const v = raw.trim().toLowerCase()
    if (v.startsWith('con')) return 'concept'
    if (v.startsWith('ex')) return 'exercise'
    return 'implementation'
  }

  function isTitleRow(row: (string | number | null)[]): string | null {
    const first = String(row[0] ?? '').trim()
    if (!first) return null
    const rest = row.slice(1).filter((c) => String(c ?? '').trim() !== '')
    if (rest.length > 0) return null
    const lower = first.toLowerCase()
    if (lower === 'sl no' || lower === 'sl' || lower === 'topic' || lower === 'type') return null
    return first
  }

  interface SessionBlock { name: string; order: number; activities: Activity[] }

  function parseRows(rows: (string | number | null)[][]): SessionBlock[] {
    const sessionsParsed: SessionBlock[] = []
    let sessionCount = 0
    let i = 0

    while (i < rows.length) {
      const titleVal = isTitleRow(rows[i] ?? [])
      if (!titleVal) { i++; continue }

      // It's a session title
      sessionCount++
      const sessionName = titleVal
      i++

      // skip optional subtitle row
      if (i < rows.length && isTitleRow(rows[i] ?? [])) i++

      // find header row
      let topicIdx = -1, typeIdx = -1, remarkIdx = -1
      while (i < rows.length) {
        const labels = (rows[i] ?? []).map((c) => String(c ?? '').trim().toLowerCase())
        const tp = labels.findIndex((l) => l === 'topic' || l === 'title' || l === 'activity')
        const ty = labels.findIndex((l) => l === 'type')
        if (tp !== -1 && ty !== -1) { topicIdx = tp; typeIdx = ty; remarkIdx = labels.findIndex((l) => l.includes('remark') || l.includes('note')); i++; break }
        i++
      }
      if (topicIdx === -1) continue

      // collect activities
      const activities: Activity[] = []
      while (i < rows.length) {
        if (isTitleRow(rows[i] ?? [])) break
        const row = rows[i] ?? []
        const topic = String(row[topicIdx] ?? '').trim()
        const rawType = String(row[typeIdx] ?? '').trim()
        if (topic) {
          const remark = remarkIdx >= 0 ? String(row[remarkIdx] ?? '').trim() : ''
          activities.push({ id: crypto.randomUUID(), title: topic, type: parseActivityType(rawType), remark })
        }
        i++
      }

      if (activities.length > 0) {
        sessionsParsed.push({ name: sessionName, order: sessionCount, activities })
      }
    }

    return sessionsParsed
  }

  async function onImportCourse(file: File) {
    if (!selectedCourseId) return
    setImporting(true); setImportResult(null); setError('')
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws) { setError('Excel file has no sheet.'); return }
      const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1 })
      const blocks = parseRows(rows)
      if (blocks.length === 0) { setError('No sessions found.'); return }
      let created = 0
      for (const s of blocks) {
        await addDoc(collection(db, 'sessions'), {
          courseId: selectedCourseId,
          courseName: selectedCourse?.title ?? '',
          title: s.name,
          order: s.order,
          activities: s.activities,
          createdAt: serverTimestamp(),
        })
        created++
      }
      setImportResult(`✓ Imported ${created} session${created !== 1 ? 's' : ''}.`)
      if (xlsxInputRef.current) xlsxInputRef.current.value = ''
      await loadSessions(selectedCourseId)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to import') } finally { setImporting(false) }
  }

  return (
    <div>
      <h1>Syllabus Builder</h1>
      <p className="muted">Design your curriculum: Courses → Sessions → Activities.</p>
      <p className="notice" style={{ marginBottom: '0.75rem' }}>
        The <strong>ROL-style syllabus</strong> (modules list + item detail with attempts &amp; notes) is on the{' '}
        <strong>student course screen</strong>, not this builder.{' '}
        {selectedCourseId ? (
          <Link to={`/student/courses/${selectedCourseId}`}>Open student syllabus for this course →</Link>
        ) : (
          <span className="muted">Select a course on the left to preview.</span>
        )}
      </p>
      {error ? <p className="error">{error}</p> : null}

      <div className="syllabus-columns">
        {/* COURSES */}
        <div className="syllabus-col">
          <div className="syllabus-col-header">
            <h2>📘 Courses</h2>
            <button type="button" className="btn small primary" onClick={() => setAddingCourse((v) => !v)}>+ Course</button>
          </div>
          {addingCourse && (
            <form onSubmit={(e) => void createCourse(e)} className="form syllabus-mini-form">
              <input placeholder="Course title *" value={newCourseTitle} onChange={(e) => setNewCourseTitle(e.target.value)} required autoFocus />
              <input placeholder="Description (optional)" value={newCourseDesc} onChange={(e) => setNewCourseDesc(e.target.value)} />
              <div className="row">
                <button type="submit" className="btn small primary" disabled={saving}>Save</button>
                <button type="button" className="btn small ghost" onClick={() => setAddingCourse(false)}>Cancel</button>
              </div>
            </form>
          )}
          <ul className="syllabus-list">
            {courses.map((c) => (
              <li key={c.id} className={`syllabus-item${selectedCourseId === c.id ? ' active' : ''}`}>
                <button type="button" className="syllabus-item-btn" onClick={() => setSelectedCourseId(c.id)}>
                  <span className="syllabus-item-title">{c.title}</span>
                  {c.description ? <span className="muted small syllabus-item-desc">{c.description}</span> : null}
                </button>
              </li>
            ))}
            {courses.length === 0 ? <li className="muted small" style={{ padding: '0.5rem 0' }}>No courses yet.</li> : null}
          </ul>
        </div>

        {/* SESSIONS */}
        {selectedCourseId ? (
          <div className="syllabus-col syllabus-col-wide">
            <div className="syllabus-col-header">
              <h2>📝 Sessions</h2>
              <div className="row">
                <label className="btn small ghost" style={{ cursor: 'pointer' }} title="Import sessions from Excel">
                  {importing ? '⏳…' : '📥 Import Sessions'}
                  <input ref={xlsxInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportCourse(f) }} />
                </label>
                <button type="button" className="btn small primary" onClick={openNewSessionForm}>+ Session</button>
              </div>
            </div>
            <p className="muted small syllabus-breadcrumb">in {selectedCourse?.title}</p>
            <div className="muted small" style={{ marginBottom: '0.75rem', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--text)' }}>Session Excel format:</strong>&nbsp;
              Session title (single cell) → optional subtitle → <code>SL no · Topic · Type · Remark</code> → data rows
            </div>
            {importResult ? <p className="notice" style={{ marginBottom: '0.5rem' }}>{importResult}</p> : null}

            {sessionFormOpen ? (
              <div className="panel" style={{ marginBottom: '1rem' }}>
                <h3 style={{ marginBottom: '0.75rem' }}>{editingSessionId ? '✏️ Edit session' : '✨ New session'}</h3>
                <form onSubmit={(e) => void saveSession(e)} className="form">
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
                    <label style={{ flex: 1 }}>Session title<input value={sessionTitle} onChange={(e) => setSessionTitle(e.target.value)} placeholder="e.g. Session-1" required /></label>
                    <label style={{ width: 90, flexShrink: 0 }}>Order<input type="number" value={sessionOrder} onChange={(e) => setSessionOrder(Number(e.target.value))} min={1} /></label>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <h4 style={{ margin: 0 }}>Activities</h4>
                      <div className="row">
                        <button type="button" className="btn small ghost" onClick={() => setSessionActivities((p) => [...p, newActivityOfType('concept')])}>+ Concept</button>
                        <button type="button" className="btn small ghost" onClick={() => setSessionActivities((p) => [...p, newActivityOfType('exercise')])}>+ Exercise</button>
                        <button type="button" className="btn small ghost" onClick={() => setSessionActivities((p) => [...p, newActivityOfType('implementation')])}>+ Implementation</button>
                      </div>
                    </div>
                    {sessionActivities.map((a, i) => {
                      const colors = activityTypeColor(a.type)
                      return (
                        <div key={a.id} className="lesson-item-editor" style={{ borderLeftColor: colors.bg }}>
                          <select value={a.type} onChange={(e) => updateActivity(i, { type: e.target.value as LessonItemType })}>
                            <option value="concept">Concept</option>
                            <option value="exercise">Exercise</option>
                            <option value="implementation">Implementation</option>
                          </select>
                          <input placeholder={`${activityTypeLabel(a.type)} title *`} value={a.title} onChange={(e) => updateActivity(i, { title: e.target.value })} />
                          <input placeholder="Remark (optional)" value={a.remark ?? ''} onChange={(e) => updateActivity(i, { remark: e.target.value })} />
                          <button type="button" className="btn small ghost" onClick={() => removeActivity(i)} disabled={sessionActivities.length === 1} title="Remove">✕</button>
                        </div>
                      )
                    })}
                  </div>
                  <div className="row">
                    <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : editingSessionId ? 'Update' : 'Create'}</button>
                    <button type="button" className="btn ghost" onClick={() => setSessionFormOpen(false)}>Cancel</button>
                  </div>
                </form>
              </div>
            ) : null}

            <ul className="syllabus-lesson-list">
              {sessions.map((s) => {
                const grouped = {
                  concept: s.activities.filter((a) => a.type === 'concept'),
                  exercise: s.activities.filter((a) => a.type === 'exercise'),
                  implementation: s.activities.filter((a) => a.type === 'implementation' || a.type === 'songsheet'),
                }
                return (
                  <li key={s.id} className="syllabus-lesson syllabus-session-card">
                    <div className="row syllabus-session-head">
                      <div>
                        <strong className="syllabus-session-title">{s.order}. {s.title}</strong>
                        <span className="muted small syllabus-session-meta">{s.activities.length} activit{s.activities.length === 1 ? 'y' : 'ies'}</span>
                      </div>
                      <div className="actions syllabus-session-actions">
                        <button type="button" className="btn small ghost" onClick={() => openAddActivity(s)} disabled={saving}>+ Activity</button>
                        <button type="button" className="btn small ghost" onClick={() => openEditSessionForm(s)}>Edit</button>
                        <button type="button" className="btn small ghost" onClick={() => void deleteSession(s.id)}>Delete</button>
                      </div>
                    </div>
                    <div className="syllabus-session-body">
                      {(['concept', 'exercise', 'implementation'] as const).map((type) => {
                        const items = grouped[type]
                        if (items.length === 0) return null
                        const colors = activityTypeColor(type)
                        return (
                          <div key={type} className="syllabus-session-col">
                            <span className="tag" style={{ background: colors.bg, color: colors.text, border: 'none', marginBottom: '0.25rem', display: 'inline-block' }}>
                              {activityTypeLabel(type)}s ({items.length})
                            </span>
                            <ul className="syllabus-activity-list">
                              {items.map((a) => (
                                <li key={a.id} className="syllabus-activity-row">
                                  <span className="syllabus-activity-title">
                                    {a.title}{a.remark ? <span className="muted"> — {a.remark}</span> : null}
                                  </span>
                                  <div className="actions syllabus-activity-actions">
                                    <button type="button" className="btn small ghost" onClick={() => void quickEditActivityTitle(s, a)} disabled={saving}>Edit</button>
                                    <button type="button" className="btn small ghost" onClick={() => void deleteActivityInline(s, a.id)} disabled={saving}>Delete</button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )
                      })}
                    </div>
                  </li>
                )
              })}
              {sessions.length === 0 ? <li className="muted small" style={{ padding: '0.5rem 0' }}>No sessions yet.</li> : null}
            </ul>
          </div>
        ) : null}
      </div>

      {addActivitySessionId && (
        <div className="modal-backdrop" onClick={() => setAddActivitySessionId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem' }}>Add Activity</h3>
            <div className="form">
              <label>Title<input value={addActivityTitle} onChange={(e) => setAddActivityTitle(e.target.value)} placeholder="Activity title" autoFocus /></label>
              <label>Type<select value={addActivityType} onChange={(e) => setAddActivityType(e.target.value as LessonItemType)}>
                <option value="concept">Concept</option>
                <option value="exercise">Exercise</option>
                <option value="implementation">Implementation</option>
              </select></label>
              <div className="row">
                <button type="button" className="btn primary" disabled={saving} onClick={() => void saveAddActivity()}>Add</button>
                <button type="button" className="btn ghost" onClick={() => setAddActivitySessionId(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
