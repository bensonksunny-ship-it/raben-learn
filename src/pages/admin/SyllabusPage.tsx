import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { normalizeTopicType, type Course, type Session, type Topic, type TopicType } from '../../types'
import { readTopicsFromSessionDoc } from '../../lib/topics'

function newTopic(type: TopicType = 'concept'): Topic {
  return { id: crypto.randomUUID(), type, title: '', remark: '' }
}
function topicTypeLabel(t: TopicType): string {
  return t === 'concept' ? 'Concept' : 'Exercise'
}
function topicTypeColor(t: TopicType): { bg: string; text: string } {
  return t === 'concept'
    ? { bg: '#ede9fe', text: '#5b21b6' }
    : { bg: '#dcfce7', text: '#166534' }
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
  const [sessionTopics, setSessionTopics] = useState<Topic[]>([newTopic()])

  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)

  const xlsxInputRef = useRef<HTMLInputElement>(null)

  const selectedCourse = courses.find((c) => c.id === selectedCourseId) ?? null

  const [addTopicSessionId, setAddTopicSessionId] = useState<string | null>(null)
  const [addTopicTitle, setAddTopicTitle] = useState('')
  const [addTopicType, setAddTopicType] = useState<TopicType>('concept')

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
      const topics = readTopicsFromSessionDoc(x.activities)
      list.push({
        id: d.id,
        title: (x.title as string) ?? '',
        subtitle: (x.subtitle as string) ?? '',
        courseName: (x.courseName as string) ?? '',
        courseId: (x.courseId as string) ?? null,
        order: Number(x.order ?? 0),
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
    setSessionTopics([newTopic()])
    setSessionFormOpen(true)
  }

  function openEditSessionForm(session: Session) {
    setEditingSessionId(session.id)
    setSessionTitle(session.title)
    setSessionOrder(session.order ?? 1)
    setSessionTopics(session.activities.length > 0 ? [...session.activities] : [newTopic()])
    setSessionFormOpen(true)
  }

  async function saveSession(e: FormEvent) {
    e.preventDefault()
    if (!selectedCourseId) return
    const cleaned = sessionTopics
      .map((t) => ({ ...t, title: t.title.trim(), remark: (t.remark ?? '').trim() }))
      .filter((t) => t.title.length > 0)
    if (!sessionTitle.trim()) { setError('Session title is required.'); return }
    if (cleaned.length === 0) { setError('Add at least one topic.'); return }
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

  function openAddTopic(session: Session) {
    setAddTopicSessionId(session.id)
    setAddTopicTitle('')
    setAddTopicType('concept')
  }

  async function saveAddTopic() {
    if (!selectedCourseId || !addTopicSessionId) return
    const session = sessions.find((s) => s.id === addTopicSessionId) ?? null
    if (!session) return
    const title = addTopicTitle.trim()
    if (!title) { setError('Topic title is required.'); return }

    setSaving(true); setError('')
    try {
      const next: Topic[] = [
        ...(session.activities ?? []),
        { id: crypto.randomUUID(), title, type: addTopicType, remark: '' },
      ]
      await updateDoc(doc(db, 'sessions', session.id), { activities: next, updatedAt: serverTimestamp() })
      setAddTopicSessionId(null)
      await loadSessions(selectedCourseId)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed') } finally { setSaving(false) }
  }

  function updateTopic(index: number, patch: Partial<Topic>) {
    setSessionTopics((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }
  function removeTopic(index: number) {
    setSessionTopics((prev) => prev.filter((_, i) => i !== index))
  }
  function moveTopic(index: number, direction: -1 | 1) {
    setSessionTopics((prev) => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item!)
      return next
    })
  }

  async function updateTopicInline(session: Session, topicId: string, patch: Partial<Topic>) {
    if (!selectedCourseId) return
    setSaving(true); setError('')
    try {
      const next = session.activities.map((a) => (a.id === topicId ? { ...a, ...patch } : a))
      await updateDoc(doc(db, 'sessions', session.id), { activities: next, updatedAt: serverTimestamp() })
      await loadSessions(selectedCourseId)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed') } finally { setSaving(false) }
  }

  async function deleteTopicInline(session: Session, topicId: string) {
    if (!selectedCourseId) return
    if (!window.confirm('Delete this topic?')) return
    setSaving(true); setError('')
    try {
      const next = session.activities.filter((a) => a.id !== topicId)
      if (next.length === 0) { setError('A session must have at least one topic.'); return }
      await updateDoc(doc(db, 'sessions', session.id), { activities: next, updatedAt: serverTimestamp() })
      await loadSessions(selectedCourseId)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed') } finally { setSaving(false) }
  }

  async function quickEditTopicTitle(session: Session, t: Topic) {
    const nextTitle = window.prompt('Edit topic title', t.title)
    if (nextTitle == null) return
    const cleaned = nextTitle.trim()
    if (!cleaned) return
    await updateTopicInline(session, t.id, { title: cleaned })
  }

  function parseTopicType(raw: string): TopicType {
    return normalizeTopicType(raw)
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

  interface SessionBlock { name: string; order: number; topics: Topic[] }

  function parseRows(rows: (string | number | null)[][]): SessionBlock[] {
    const sessionsParsed: SessionBlock[] = []
    let sessionCount = 0
    let i = 0

    while (i < rows.length) {
      const titleVal = isTitleRow(rows[i] ?? [])
      if (!titleVal) { i++; continue }

      sessionCount++
      const sessionName = titleVal
      i++

      if (i < rows.length && isTitleRow(rows[i] ?? [])) i++

      let topicIdx = -1, typeIdx = -1, remarkIdx = -1
      while (i < rows.length) {
        const labels = (rows[i] ?? []).map((c) => String(c ?? '').trim().toLowerCase())
        const tp = labels.findIndex((l) => l === 'topic' || l === 'title' || l === 'activity')
        const ty = labels.findIndex((l) => l === 'type')
        if (tp !== -1 && ty !== -1) { topicIdx = tp; typeIdx = ty; remarkIdx = labels.findIndex((l) => l.includes('remark') || l.includes('note')); i++; break }
        i++
      }
      if (topicIdx === -1) continue

      const topics: Topic[] = []
      while (i < rows.length) {
        if (isTitleRow(rows[i] ?? [])) break
        const row = rows[i] ?? []
        const topic = String(row[topicIdx] ?? '').trim()
        const rawType = String(row[typeIdx] ?? '').trim()
        if (topic) {
          const remark = remarkIdx >= 0 ? String(row[remarkIdx] ?? '').trim() : ''
          topics.push({ id: crypto.randomUUID(), title: topic, type: parseTopicType(rawType), remark })
        }
        i++
      }

      if (topics.length > 0) {
        sessionsParsed.push({ name: sessionName, order: sessionCount, topics })
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
          activities: s.topics,
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
                      <h4 style={{ margin: 0 }}>Topics</h4>
                      <div className="row">
                        <button type="button" className="btn small ghost" onClick={() => setSessionTopics((p) => [...p, newTopic('concept')])}>+ Concept</button>
                        <button type="button" className="btn small ghost" onClick={() => setSessionTopics((p) => [...p, newTopic('exercise')])}>+ Exercise</button>
                      </div>
                    </div>
                    <p className="muted small" style={{ margin: '0 0 0.5rem' }}>
                      Topics appear in the student syllabus in this exact order. Mix Concepts and Exercises freely.
                    </p>
                    <ol className="topic-editor-list">
                      {sessionTopics.map((t, i) => {
                        const colors = topicTypeColor(t.type)
                        return (
                          <li key={t.id} className="topic-editor-row" style={{ borderLeftColor: colors.bg }}>
                            <span className="topic-editor-index muted small">{i + 1}</span>
                            <select
                              value={t.type}
                              onChange={(e) => updateTopic(i, { type: e.target.value as TopicType })}
                              aria-label="Topic type"
                            >
                              <option value="concept">Concept</option>
                              <option value="exercise">Exercise</option>
                            </select>
                            <input
                              placeholder={`${topicTypeLabel(t.type)} title *`}
                              value={t.title}
                              onChange={(e) => updateTopic(i, { title: e.target.value })}
                            />
                            <input
                              placeholder="Remark (optional)"
                              value={t.remark ?? ''}
                              onChange={(e) => updateTopic(i, { remark: e.target.value })}
                            />
                            <div className="topic-editor-actions">
                              <button type="button" className="btn small ghost" title="Move up" disabled={i === 0} onClick={() => moveTopic(i, -1)}>↑</button>
                              <button type="button" className="btn small ghost" title="Move down" disabled={i === sessionTopics.length - 1} onClick={() => moveTopic(i, 1)}>↓</button>
                              <button type="button" className="btn small ghost" onClick={() => removeTopic(i)} disabled={sessionTopics.length === 1} title="Remove">✕</button>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
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
                const conceptCount = s.activities.filter((t) => t.type === 'concept').length
                const exerciseCount = s.activities.length - conceptCount
                return (
                  <li key={s.id} className="syllabus-lesson syllabus-session-card">
                    <div className="row syllabus-session-head">
                      <div>
                        <strong className="syllabus-session-title">{s.order}. {s.title}</strong>
                        <span className="muted small syllabus-session-meta">
                          {s.activities.length} topic{s.activities.length === 1 ? '' : 's'}
                          {s.activities.length > 0 ? ` · ${conceptCount} concept${conceptCount === 1 ? '' : 's'}, ${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}` : ''}
                        </span>
                      </div>
                      <div className="actions syllabus-session-actions">
                        <button type="button" className="btn small ghost" onClick={() => openAddTopic(s)} disabled={saving}>+ Topic</button>
                        <button type="button" className="btn small ghost" onClick={() => openEditSessionForm(s)}>Edit</button>
                        <button type="button" className="btn small ghost" onClick={() => void deleteSession(s.id)}>Delete</button>
                      </div>
                    </div>

                    {s.activities.length === 0 ? (
                      <p className="muted small" style={{ margin: '0.25rem 0 0' }}>No topics yet.</p>
                    ) : (
                      <ol className="topic-timeline">
                        {s.activities.map((t, idx) => {
                          const colors = topicTypeColor(t.type)
                          return (
                            <li key={t.id} className="topic-timeline-row">
                              <span className="topic-timeline-index muted small">{idx + 1}</span>
                              <span
                                className="topic-timeline-badge"
                                style={{ background: colors.bg, color: colors.text }}
                              >
                                {topicTypeLabel(t.type)}
                              </span>
                              <span className="topic-timeline-title">
                                {t.title}
                                {t.remark ? <span className="muted"> — {t.remark}</span> : null}
                              </span>
                              <div className="actions topic-timeline-actions">
                                <button
                                  type="button"
                                  className="btn small ghost"
                                  onClick={() =>
                                    void updateTopicInline(s, t.id, {
                                      type: t.type === 'concept' ? 'exercise' : 'concept',
                                    })
                                  }
                                  disabled={saving}
                                  title="Toggle type"
                                >
                                  {t.type === 'concept' ? '→ Exercise' : '→ Concept'}
                                </button>
                                <button type="button" className="btn small ghost" onClick={() => void quickEditTopicTitle(s, t)} disabled={saving}>Edit</button>
                                <button type="button" className="btn small ghost" onClick={() => void deleteTopicInline(s, t.id)} disabled={saving}>Delete</button>
                              </div>
                            </li>
                          )
                        })}
                      </ol>
                    )}
                  </li>
                )
              })}
              {sessions.length === 0 ? <li className="muted small" style={{ padding: '0.5rem 0' }}>No sessions yet.</li> : null}
            </ul>
          </div>
        ) : null}
      </div>

      {addTopicSessionId && (
        <div className="modal-backdrop" onClick={() => setAddTopicSessionId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem' }}>Add Topic</h3>
            <div className="form">
              <label>Title<input value={addTopicTitle} onChange={(e) => setAddTopicTitle(e.target.value)} placeholder="Topic title" autoFocus /></label>
              <label>Type<select value={addTopicType} onChange={(e) => setAddTopicType(e.target.value as TopicType)}>
                <option value="concept">Concept</option>
                <option value="exercise">Exercise</option>
              </select></label>
              <div className="row">
                <button type="button" className="btn primary" disabled={saving} onClick={() => void saveAddTopic()}>Add</button>
                <button type="button" className="btn ghost" onClick={() => setAddTopicSessionId(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
