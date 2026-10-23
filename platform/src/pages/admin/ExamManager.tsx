import React, { useCallback, useEffect, useState } from 'react'
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs,
  query, serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { parseMcqPaste, parseWrittenPaste } from '../../lib/examUtils'
import type { Exam, ExamAttempt, ExamQuestionItem, ExamSection, ExamType, SectionTemplate, UserProfile } from '../../types'

interface Props { courseId: string }

type View = 'list' | 'edit' | 'templates'

function blankTemplateForm(): { id: string | null; title: string; caption: string; marksPerQuestion: number } {
  return { id: null, title: '', caption: '', marksPerQuestion: 1 }
}

function newId(): string {
  return crypto.randomUUID()
}

/** Short label for compact action buttons/badges — "Paper Exm" (written,
 *  printable) vs "Dig Exm" (digital, in-app MCQ). Used everywhere an exam's
 *  type is shown outside the one-time creation choice. */
function examTypeLabel(type: ExamType): string {
  return type === 'written' ? 'Paper Exm' : 'Dig Exm'
}

function blankDraft(type: ExamType, courseId: string): Exam {
  return {
    id: '',
    courseId,
    type,
    title: '',
    sections: [],
    questions: [],
    totalQuestions: 0,
    totalMarks: 0,
    durationMinutes: 30,
    isActive: false,
    createdBy: '',
  }
}

export default function ExamManager({ courseId }: Props) {
  const { firebaseUser, profile } = useAuth()
  const printPrefix = profile?.roles.includes('admin') ? 'admin' : 'mentor'
  const [view, setView] = useState<View>('list')
  const [exams, setExams] = useState<Exam[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [draft, setDraft] = useState<Exam | null>(null)
  const [pasteText, setPasteText] = useState<Record<string, string>>({})
  const [parseErrors, setParseErrors] = useState<Record<string, string[]>>({})

  const [resultsForExamId, setResultsForExamId] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<ExamAttempt[]>([])
  const [studentMap, setStudentMap] = useState<Record<string, string>>({})
  const [expandedAttemptId, setExpandedAttemptId] = useState<string | null>(null)

  // Reusable sub-section designs — global across courses, not scoped to this one.
  const [templates, setTemplates] = useState<SectionTemplate[]>([])
  const [templateForm, setTemplateForm] = useState(blankTemplateForm())
  const [templateSaving, setTemplateSaving] = useState(false)

  const loadTemplates = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'sectionTemplates'))
      const list: SectionTemplate[] = []
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<SectionTemplate, 'id'>) }))
      list.sort((a, b) => a.title.localeCompare(b.title))
      setTemplates(list)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load sub-section templates') }
  }, [])

  useEffect(() => { void loadTemplates() }, [loadTemplates])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const snap = await getDocs(collection(db, 'courses', courseId, 'exams'))
      const list: Exam[] = []
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Exam, 'id'>) }))
      list.sort((a, b) => a.title.localeCompare(b.title))
      setExams(list)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }, [courseId])

  useEffect(() => { void load() }, [load])

  // ─── Create / Edit ──────────────────────────────────────────────────────

  function openNew(type: ExamType) {
    setDraft(blankDraft(type, courseId))
    setPasteText({}); setParseErrors({}); setError('')
    setView('edit')
  }

  function openEdit(exam: Exam) {
    setDraft({ ...exam, sections: exam.sections.map((s) => ({ ...s })), questions: exam.questions.map((q) => ({ ...q })) })
    setPasteText({}); setParseErrors({}); setError('')
    setView('edit')
  }

  function addSection() {
    if (!draft) return
    const section: ExamSection = { id: newId(), label: `Part ${String.fromCharCode(65 + draft.sections.length)}`, questionCount: 5, marksPerQuestion: 1 }
    setDraft({ ...draft, sections: [...draft.sections, section] })
  }

  function addSectionFromTemplate(templateId: string) {
    if (!draft) return
    const t = templates.find((tt) => tt.id === templateId)
    if (!t) return
    const section: ExamSection = { id: newId(), label: t.title, caption: t.caption, questionCount: 5, marksPerQuestion: t.marksPerQuestion }
    setDraft({ ...draft, sections: [...draft.sections, section] })
  }

  function updateSection(id: string, patch: Partial<ExamSection>) {
    if (!draft) return
    setDraft({ ...draft, sections: draft.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  }

  function removeSection(id: string) {
    if (!draft) return
    if (draft.questions.some((q) => q.sectionId === id) && !window.confirm('This section has pasted questions — remove it and its questions?')) return
    setDraft({ ...draft, sections: draft.sections.filter((s) => s.id !== id), questions: draft.questions.filter((q) => q.sectionId !== id) })
  }

  function parseSection(sectionId: string) {
    if (!draft) return
    const text = pasteText[sectionId] ?? ''
    if (!text.trim()) return
    if (draft.type === 'written') {
      const blocks = parseWrittenPaste(text)
      const items: ExamQuestionItem[] = blocks.map((t) => ({ id: newId(), sectionId, text: t }))
      setDraft({ ...draft, questions: [...draft.questions, ...items] })
      setParseErrors((pe) => ({ ...pe, [sectionId]: [] }))
    } else {
      const parsed = parseMcqPaste(text)
      const ok = parsed.filter((p) => !p.error)
      const bad = parsed.filter((p) => p.error)
      const items: ExamQuestionItem[] = ok.map((p) => ({ id: newId(), sectionId, text: p.text, options: p.options, correctAnswer: p.correctAnswer }))
      setDraft({ ...draft, questions: [...draft.questions, ...items] })
      setParseErrors((pe) => ({ ...pe, [sectionId]: bad.map((b, i) => `Block ${i + 1}: ${b.error}`) }))
    }
    setPasteText((pt) => ({ ...pt, [sectionId]: '' }))
  }

  function updateQuestion(id: string, patch: Partial<ExamQuestionItem>) {
    if (!draft) return
    setDraft({ ...draft, questions: draft.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) })
  }

  function updateOption(id: string, idx: number, value: string) {
    if (!draft) return
    const q = draft.questions.find((qq) => qq.id === id)
    if (!q?.options) return
    const options = [...q.options]
    options[idx] = value
    const correctAnswer = q.correctAnswer === q.options[idx] ? value : q.correctAnswer
    updateQuestion(id, { options, correctAnswer })
  }

  function removeQuestion(id: string) {
    if (!draft) return
    setDraft({ ...draft, questions: draft.questions.filter((q) => q.id !== id) })
  }

  function addBlankQuestion(sectionId: string) {
    if (!draft) return
    const item: ExamQuestionItem = draft.type === 'mcq'
      ? { id: newId(), sectionId, text: '', options: ['', '', '', ''], correctAnswer: '' }
      : { id: newId(), sectionId, text: '' }
    setDraft({ ...draft, questions: [...draft.questions, item] })
  }

  async function saveExam() {
    if (!draft) return
    const title = draft.title.trim()
    if (!title) { setError('Give the exam a title.'); return }
    if (draft.sections.length === 0) { setError('Add at least one section.'); return }
    if (draft.questions.length === 0) { setError('Paste or add at least one question.'); return }
    for (const q of draft.questions) {
      if (!q.text.trim()) { setError('Every question needs its text filled in.'); return }
      if (draft.type === 'mcq') {
        if (!q.options || q.options.some((o) => !o.trim())) { setError('Every MCQ question needs all 4 options filled in.'); return }
        if (!q.correctAnswer || !q.options.includes(q.correctAnswer)) { setError('Every MCQ question needs a correct option marked.'); return }
      }
    }
    setSaving(true); setError('')
    try {
      const data = {
        courseId: draft.courseId,
        type: draft.type,
        title,
        sections: draft.sections,
        questions: draft.questions,
        totalQuestions: draft.totalQuestions,
        totalMarks: draft.totalMarks,
        durationMinutes: draft.durationMinutes,
        isActive: draft.isActive,
        createdBy: draft.createdBy || firebaseUser?.uid || '',
        updatedAt: serverTimestamp(),
      }
      if (draft.id) {
        await updateDoc(doc(db, 'courses', courseId, 'exams', draft.id), data)
      } else {
        await addDoc(collection(db, 'courses', courseId, 'exams'), data)
      }
      setView('list'); setDraft(null)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function deleteExam(exam: Exam) {
    if (!window.confirm(`Delete "${exam.title}"? This cannot be undone.`)) return
    try {
      await deleteDoc(doc(db, 'courses', courseId, 'exams', exam.id))
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed') }
  }

  async function toggleActive(exam: Exam) {
    try {
      await updateDoc(doc(db, 'courses', courseId, 'exams', exam.id), { isActive: !exam.isActive, updatedAt: serverTimestamp() })
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed') }
  }

  // ─── Sub-Section Templates ─────────────────────────────────────────────

  function openNewTemplate() {
    setTemplateForm(blankTemplateForm()); setError('')
  }

  function openEditTemplate(t: SectionTemplate) {
    setTemplateForm({ id: t.id, title: t.title, caption: t.caption, marksPerQuestion: t.marksPerQuestion }); setError('')
  }

  async function saveTemplate() {
    const title = templateForm.title.trim()
    if (!title) { setError('Give the sub-section a title.'); return }
    setTemplateSaving(true); setError('')
    try {
      const data = { title, caption: templateForm.caption.trim(), marksPerQuestion: templateForm.marksPerQuestion, updatedAt: serverTimestamp() }
      if (templateForm.id) {
        await updateDoc(doc(db, 'sectionTemplates', templateForm.id), data)
      } else {
        await addDoc(collection(db, 'sectionTemplates'), { ...data, createdBy: firebaseUser?.uid || '' })
      }
      setTemplateForm(blankTemplateForm())
      await loadTemplates()
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setTemplateSaving(false) }
  }

  async function deleteTemplate(t: SectionTemplate) {
    if (!window.confirm(`Delete sub-section "${t.title}"? Exams that already used it keep their own copy.`)) return
    try {
      await deleteDoc(doc(db, 'sectionTemplates', t.id))
      if (templateForm.id === t.id) setTemplateForm(blankTemplateForm())
      await loadTemplates()
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed') }
  }

  // ─── Results ────────────────────────────────────────────────────────────

  async function openResults(exam: Exam) {
    setResultsForExamId(exam.id); setExpandedAttemptId(null)
    try {
      const snap = await getDocs(query(collection(db, 'examAttempts'), where('examId', '==', exam.id)))
      const atts: ExamAttempt[] = []
      snap.forEach((d) => atts.push({ id: d.id, ...(d.data() as Omit<ExamAttempt, 'id'>) }))
      atts.sort((a, b) => (b.submittedAt ?? b.startedAt).localeCompare(a.submittedAt ?? a.startedAt))
      setAttempts(atts)
      const uids = [...new Set(atts.map((a) => a.studentId))]
      if (uids.length > 0) {
        const userSnaps = await Promise.all(uids.map((uid) => getDoc(doc(db, 'users', uid))))
        const map: Record<string, string> = {}
        userSnaps.forEach((s) => { if (s.exists()) map[s.id] = (s.data() as UserProfile).name })
        setStudentMap(map)
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load results') }
  }

  function pct(score: number, total: number) {
    return total === 0 ? 0 : Math.round((score / total) * 100)
  }
  function fmtDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  function fmtTime(secs: number) {
    const m = Math.floor(secs / 60), s = secs % 60
    return `${m}m ${s}s`
  }

  if (loading) return <p className="muted" style={{ padding: '1rem' }}>Loading exams…</p>

  // ─── Results panel ──────────────────────────────────────────────────────

  if (resultsForExamId) {
    const exam = exams.find((e) => e.id === resultsForExamId)
    return (
      <div>
        <button type="button" className="btn small ghost" style={{ marginBottom: '0.75rem' }} onClick={() => setResultsForExamId(null)}>← Back to Exams</button>
        <h3 style={{ marginBottom: '0.75rem' }}>📊 Results — {exam?.title}</h3>
        {error && <p className="error">{error}</p>}
        {attempts.length === 0 ? <p className="muted">No attempts yet.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                  {['Student', 'Score', '%', 'Time Spent', 'Date', ''].map((h) => (
                    <th key={h} style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <React.Fragment key={a.id}>
                    <tr style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setExpandedAttemptId(expandedAttemptId === a.id ? null : a.id)}>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 500 }}>{studentMap[a.studentId] ?? a.studentId.slice(0, 8)}</td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>{a.submittedAt ? `${a.score} / ${a.totalMarks}` : '—'}</td>
                      <td style={{ padding: '0.6rem 0.75rem', color: a.submittedAt ? (pct(a.score, a.totalMarks) >= 50 ? '#059669' : '#dc2626') : 'var(--muted-2)' }}>
                        {a.submittedAt ? `${pct(a.score, a.totalMarks)}%` : 'In progress'}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>{a.timeSpentSeconds > 0 ? fmtTime(a.timeSpentSeconds) : '—'}</td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>{fmtDate(a.submittedAt)}</td>
                      <td style={{ padding: '0.6rem 0.75rem', color: 'var(--muted-2)' }}>{expandedAttemptId === a.id ? '▲' : '▼'}</td>
                    </tr>
                    {expandedAttemptId === a.id && exam && (
                      <tr>
                        <td colSpan={6} style={{ padding: '0.75rem', background: 'var(--surface-soft)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {a.questionOrder.map((qid, qi) => {
                              const q = exam.questions.find((qq) => qq.id === qid)
                              if (!q) return null
                              const studentAns = a.answers[qid]
                              const correct = studentAns === q.correctAnswer
                              return (
                                <div key={qid} style={{ padding: '0.6rem', background: 'var(--bg)', borderRadius: 8, border: `1px solid ${correct ? '#bbf7d0' : '#fecaca'}` }}>
                                  <div style={{ fontWeight: 600, marginBottom: '0.25rem', fontSize: '0.85rem' }}>{correct ? '✅' : '❌'} Q{qi + 1}: {q.text}</div>
                                  <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                                    Student: <span style={{ color: correct ? '#059669' : '#dc2626', fontWeight: 600 }}>{studentAns ?? '(not answered)'}</span>
                                    {!correct && <> · Correct: <span style={{ color: '#059669', fontWeight: 600 }}>{q.correctAnswer}</span></>}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // ─── Sub-Section Template Library ──────────────────────────────────────

  if (view === 'templates') {
    return (
      <div>
        <button type="button" className="btn small ghost" style={{ marginBottom: '0.75rem' }} onClick={() => { setView('list'); setTemplateForm(blankTemplateForm()) }}>← Back to Exams</button>
        <h3 style={{ marginBottom: '0.25rem' }}>📑 Sub-Section Library</h3>
        <p className="muted small" style={{ marginBottom: '0.75rem' }}>
          Design a sub-section once — title, explanation for students, and marks per question — then pick it from the list whenever you build an exam paper.
        </p>
        {error && <p className="error" style={{ marginBottom: '0.75rem' }}>{error}</p>}

        <div className="panel" style={{ marginBottom: '1rem' }}>
          <h4 style={{ marginBottom: '0.5rem' }}>{templateForm.id ? '✏️ Edit Sub-Section' : '✨ New Sub-Section'}</h4>
          <div className="form">
            <label>Title *<input value={templateForm.title} onChange={(e) => setTemplateForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Part A — Short Answer" /></label>
            <label>
              Caption / Explanation for students
              <textarea
                value={templateForm.caption}
                onChange={(e) => setTemplateForm((f) => ({ ...f, caption: e.target.value }))}
                rows={2}
                placeholder="e.g. Answer any 5 of the following 8 questions."
              />
            </label>
            <label style={{ maxWidth: 180 }}>Marks per Question<input type="number" min={0} value={templateForm.marksPerQuestion} onChange={(e) => setTemplateForm((f) => ({ ...f, marksPerQuestion: Number(e.target.value) }))} /></label>
            <div className="row">
              <button type="button" className="btn primary" disabled={templateSaving} onClick={() => void saveTemplate()}>{templateSaving ? 'Saving…' : templateForm.id ? 'Update' : 'Add Sub-Section'}</button>
              {templateForm.id && <button type="button" className="btn ghost" onClick={openNewTemplate}>Cancel</button>}
            </div>
          </div>
        </div>

        {templates.length === 0 ? (
          <p className="muted small">No sub-sections designed yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {templates.map((t) => (
              <div key={t.id} className="panel" style={{ padding: '0.65rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{t.title} <span className="muted small">· {t.marksPerQuestion} mark{t.marksPerQuestion !== 1 ? 's' : ''}/question</span></div>
                  {t.caption && <div className="muted small" style={{ marginTop: '0.15rem' }}>{t.caption}</div>}
                </div>
                <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                  <button type="button" className="btn small ghost" onClick={() => openEditTemplate(t)}>Edit</button>
                  <button type="button" className="btn small ghost" onClick={() => void deleteTemplate(t)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ─── Edit / create panel ────────────────────────────────────────────────

  if (view === 'edit' && draft) {
    const sumQuestions = draft.sections.reduce((s, sec) => s + sec.questionCount, 0)
    const sumMarks = draft.sections.reduce((s, sec) => s + sec.questionCount * sec.marksPerQuestion, 0)
    const mismatch = (draft.totalQuestions > 0 && sumQuestions !== draft.totalQuestions) || (draft.totalMarks > 0 && sumMarks !== draft.totalMarks)

    return (
      <div>
        <button type="button" className="btn small ghost" style={{ marginBottom: '0.75rem' }} onClick={() => { setView('list'); setDraft(null) }}>← Back to Exams</button>
        <h3 style={{ marginBottom: '0.75rem' }}>
          {draft.id ? '✏️ Edit' : '✨ New'} {examTypeLabel(draft.type)}
        </h3>
        {error && <p className="error" style={{ marginBottom: '0.75rem' }}>{error}</p>}

        <div className="panel" style={{ marginBottom: '1rem' }}>
          <div className="form">
            <label>Exam Title *<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Mid-Term Exam" /></label>
            <div style={{ display: 'grid', gridTemplateColumns: draft.type === 'mcq' ? '1fr 1fr 1fr' : '1fr 1fr', gap: '0.5rem' }}>
              <label>Total Questions (target)<input type="number" min={0} value={draft.totalQuestions} onChange={(e) => setDraft({ ...draft, totalQuestions: Number(e.target.value) })} /></label>
              <label>Total Marks (target)<input type="number" min={0} value={draft.totalMarks} onChange={(e) => setDraft({ ...draft, totalMarks: Number(e.target.value) })} /></label>
              {draft.type === 'mcq' && (
                <label>Duration (minutes)<input type="number" min={5} max={180} value={draft.durationMinutes} onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })} /></label>
              )}
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h4 style={{ margin: 0 }}>Sections / Sub-divisions</h4>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {templates.length > 0 && (
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) addSectionFromTemplate(e.target.value) }}
                  style={{ maxWidth: 220 }}
                  title="Add a section from the sub-section library"
                >
                  <option value="">+ From Library…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              )}
              <button type="button" className="btn small ghost" onClick={() => setView('templates')}>📑 Manage Library</button>
              <button type="button" className="btn small primary" onClick={addSection}>+ Add Section</button>
            </div>
          </div>
          {draft.sections.length === 0 ? (
            <p className="muted small">No sections yet — e.g. "Part A" = 10 questions × 1 mark, "Part B" = 5 questions × 5 marks.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {draft.sections.map((s) => (
                <div key={s.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr auto auto', gap: '0.5rem', alignItems: 'center' }}>
                    <input value={s.label} onChange={(e) => updateSection(s.id, { label: e.target.value })} placeholder="Section label" />
                    <input type="number" min={0} value={s.questionCount} onChange={(e) => updateSection(s.id, { questionCount: Number(e.target.value) })} placeholder="Questions" title="Question count" />
                    <input type="number" min={0} value={s.marksPerQuestion} onChange={(e) => updateSection(s.id, { marksPerQuestion: Number(e.target.value) })} placeholder="Marks/Q" title="Marks per question" />
                    <span className="muted small">= {s.questionCount * s.marksPerQuestion} marks</span>
                    <button type="button" className="btn small ghost" onClick={() => removeSection(s.id)}>✕</button>
                  </div>
                  <input
                    value={s.caption ?? ''}
                    onChange={(e) => updateSection(s.id, { caption: e.target.value })}
                    placeholder="Explanation for students (optional) — e.g. 'Answer any 5 of the following 8 questions.'"
                  />
                </div>
              ))}
            </div>
          )}
          {draft.sections.length > 0 && (
            <p className={mismatch ? 'error' : 'muted small'} style={{ marginTop: '0.75rem' }}>
              Sections total: {sumQuestions} questions, {sumMarks} marks
              {mismatch ? ' — doesn\'t match the target above.' : ''}
            </p>
          )}
        </div>

        {draft.sections.map((s) => {
          const sectionQs = draft.questions.filter((q) => q.sectionId === s.id)
          const errs = parseErrors[s.id] ?? []
          return (
            <div key={s.id} className="panel" style={{ marginBottom: '1rem' }}>
              <h4 style={{ marginBottom: '0.5rem' }}>{s.label} — {sectionQs.length}/{s.questionCount} questions pasted</h4>
              <textarea
                className="exam-paste-textarea"
                value={pasteText[s.id] ?? ''}
                onChange={(e) => setPasteText((pt) => ({ ...pt, [s.id]: e.target.value }))}
                rows={6}
                placeholder={
                  draft.type === 'written'
                    ? 'Paste multiple questions at once — separate each question with a blank line.'
                    : 'Paste multiple MCQs at once, separated by a blank line. For each:\nQuestion text?\nA) option\nB) option *\nC) option\nD) option\n(mark the correct option with a trailing *)'
                }
              />
              <div className="row" style={{ marginTop: '0.5rem' }}>
                <button type="button" className="btn small primary" onClick={() => parseSection(s.id)}>Parse & Add to Section</button>
                <button type="button" className="btn small ghost" onClick={() => addBlankQuestion(s.id)}>+ Add One Manually</button>
              </div>
              {errs.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  {errs.map((e, i) => <p key={i} className="error small" style={{ margin: 0 }}>{e}</p>)}
                </div>
              )}

              {sectionQs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                  {sectionQs.map((q, qi) => (
                    <div key={q.id} style={{ padding: '0.6rem', background: 'var(--surface-soft)', borderRadius: 8 }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                        <span className="muted small" style={{ paddingTop: '0.4rem' }}>Q{qi + 1}</span>
                        <textarea value={q.text} onChange={(e) => updateQuestion(q.id, { text: e.target.value })} rows={2} style={{ flex: 1 }} />
                        <button type="button" className="btn small ghost" onClick={() => removeQuestion(q.id)}>✕</button>
                      </div>
                      {draft.type === 'mcq' && q.options && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem', marginTop: '0.4rem', paddingLeft: '2rem' }}>
                          {q.options.map((opt, oi) => (
                            <label key={oi} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                              <input
                                type="radio"
                                name={`correct-${q.id}`}
                                checked={q.correctAnswer === opt && opt !== ''}
                                onChange={() => updateQuestion(q.id, { correctAnswer: opt })}
                              />
                              <input value={opt} onChange={(e) => updateOption(q.id, oi, e.target.value)} placeholder={`Option ${String.fromCharCode(65 + oi)}`} style={{ flex: 1 }} />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        <div className="row">
          <button type="button" className="btn primary" disabled={saving} onClick={() => void saveExam()}>{saving ? 'Saving…' : 'Save Exam'}</button>
          <button type="button" className="btn ghost" onClick={() => { setView('list'); setDraft(null) }}>Cancel</button>
        </div>
      </div>
    )
  }

  // ─── List ───────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <button type="button" className="btn small primary" onClick={() => openNew('written')}>+ New {examTypeLabel('written')}</button>
        <button type="button" className="btn small primary" onClick={() => openNew('mcq')}>+ New {examTypeLabel('mcq')}</button>
        <button type="button" className="btn small ghost" onClick={() => { setTemplateForm(blankTemplateForm()); setView('templates') }}>📑 Sub-Section Library</button>
      </div>
      {error && <p className="error">{error}</p>}
      {exams.length === 0 ? (
        <p className="muted small">No exams yet for this course.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {exams.map((exam) => {
            const sumQuestions = exam.sections.reduce((s, sec) => s + sec.questionCount, 0)
            const sumMarks = exam.sections.reduce((s, sec) => s + sec.questionCount * sec.marksPerQuestion, 0)
            return (
              <div key={exam.id} className="panel" style={{ padding: '0.75rem 1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>{exam.title || '(untitled)'}</span>
                      <span style={{ background: exam.type === 'mcq' ? '#ede9fe' : '#fef3c7', color: exam.type === 'mcq' ? '#5b21b6' : '#92400e', borderRadius: 99, padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 700 }}>
                        {examTypeLabel(exam.type)}
                      </span>
                      {exam.type === 'mcq' && (
                        <span style={{ background: exam.isActive ? '#dcfce7' : 'var(--surface-soft)', color: exam.isActive ? '#166534' : 'var(--muted)', borderRadius: 99, padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 700 }}>
                          {exam.isActive ? 'Active' : 'Inactive'}
                        </span>
                      )}
                    </div>
                    <span className="muted small">
                      {exam.sections.length} section{exam.sections.length !== 1 ? 's' : ''} · {sumQuestions} questions · {sumMarks} marks
                      {exam.type === 'mcq' ? ` · ${exam.durationMinutes}min` : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                    {exam.type === 'mcq' && (
                      <>
                        <button type="button" className="btn small ghost" onClick={() => void toggleActive(exam)}>{exam.isActive ? 'Deactivate' : 'Activate'}</button>
                        <button type="button" className="btn small ghost" onClick={() => void openResults(exam)}>📊 Results</button>
                      </>
                    )}
                    {exam.type === 'written' && (
                      <a className="btn small ghost" href={`/${printPrefix}/exam-print/${courseId}/${exam.id}`} target="_blank" rel="noreferrer">🖨 Print / PDF</a>
                    )}
                    <button type="button" className="btn small ghost" onClick={() => openEdit(exam)}>Edit</button>
                    <button type="button" className="btn small ghost" onClick={() => void deleteExam(exam)}>Delete</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
