import React, { useEffect, useState, type FormEvent } from 'react'
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs,
  query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { ExamAttempt, ExamConfig, ExamQuestion, UserProfile } from '../../types'

interface Props { courseId: string }

type MgrTab = 'bank' | 'settings' | 'results'
type Difficulty = 'easy' | 'medium' | 'hard'

interface QForm {
  question: string
  options: [string, string, string, string]
  correctAnswer: string
  explanation: string
  difficulty: Difficulty
  topic: string
  marks: number
}

function blankForm(): QForm {
  return { question: '', options: ['', '', '', ''], correctAnswer: '', explanation: '', difficulty: 'medium', topic: '', marks: 1 }
}

const DIFF_COLORS: Record<Difficulty, { bg: string; text: string }> = {
  easy: { bg: '#dcfce7', text: '#166534' },
  medium: { bg: '#fef9c3', text: '#854d0e' },
  hard: { bg: '#fee2e2', text: '#991b1b' },
}

export default function ExamManager({ courseId }: Props) {
  const [tab, setTab] = useState<MgrTab>('bank')
  const [questions, setQuestions] = useState<ExamQuestion[]>([])
  const [config, setConfig] = useState<ExamConfig | null>(null)
  const [attempts, setAttempts] = useState<ExamAttempt[]>([])
  const [studentMap, setStudentMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Question bank state
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [qForm, setQForm] = useState<QForm>(blankForm())
  const [filterTopic, setFilterTopic] = useState('')
  const [filterDiff, setFilterDiff] = useState('')

  // Settings form
  const [cfgForm, setCfgForm] = useState<Omit<ExamConfig, 'createdBy'>>({
    duration: 30, totalMarks: 20, questionsPerExam: 20, isActive: false,
  })

  // Results expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => { void load() }, [courseId])

  async function load() {
    setLoading(true); setError('')
    try {
      const [cfgSnap, qSnap, attSnap] = await Promise.all([
        getDoc(doc(db, 'courses', courseId, 'exam', 'config')),
        getDocs(collection(db, 'courses', courseId, 'questionBank')),
        getDocs(query(collection(db, 'examAttempts'), where('courseId', '==', courseId))),
      ])
      if (cfgSnap.exists()) {
        const c = cfgSnap.data() as ExamConfig
        setConfig(c)
        setCfgForm({ duration: c.duration, totalMarks: c.totalMarks, questionsPerExam: c.questionsPerExam, isActive: c.isActive })
      }
      const qs: ExamQuestion[] = []
      qSnap.forEach((d) => qs.push({ id: d.id, ...(d.data() as Omit<ExamQuestion, 'id'>) }))
      qs.sort((a, b) => a.topic.localeCompare(b.topic) || a.question.localeCompare(b.question))
      setQuestions(qs)

      const atts: ExamAttempt[] = []
      attSnap.forEach((d) => atts.push({ id: d.id, ...(d.data() as Omit<ExamAttempt, 'id'>) }))
      atts.sort((a, b) => (b.submittedAt ?? b.startedAt).localeCompare(a.submittedAt ?? a.startedAt))
      setAttempts(atts)

      // Fetch student names for the results table
      const uids = [...new Set(atts.map((a) => a.studentId))]
      if (uids.length > 0) {
        const userSnaps = await Promise.all(uids.map((uid) => getDoc(doc(db, 'users', uid))))
        const map: Record<string, string> = {}
        userSnaps.forEach((s) => { if (s.exists()) map[s.id] = (s.data() as UserProfile).name })
        setStudentMap(map)
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }

  // ─── Question Bank ─────────────────────────────────────────────────────────

  function openNewQuestion() {
    setEditingId(null); setQForm(blankForm()); setFormOpen(true); setError('')
  }

  function openEditQuestion(q: ExamQuestion) {
    setEditingId(q.id)
    setQForm({
      question: q.question,
      options: [q.options[0] ?? '', q.options[1] ?? '', q.options[2] ?? '', q.options[3] ?? ''],
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      difficulty: q.difficulty,
      topic: q.topic,
      marks: q.marks,
    })
    setFormOpen(true); setError('')
  }

  async function saveQuestion(e: FormEvent) {
    e.preventDefault()
    const opts = qForm.options.map((o) => o.trim())
    if (opts.some((o) => !o)) { setError('All 4 options are required.'); return }
    if (!qForm.correctAnswer) { setError('Select the correct answer.'); return }
    if (!opts.includes(qForm.correctAnswer)) { setError('Correct answer must match one of the options.'); return }
    setSaving(true); setError('')
    try {
      const data = {
        question: qForm.question.trim(),
        options: opts,
        correctAnswer: qForm.correctAnswer,
        explanation: qForm.explanation.trim(),
        difficulty: qForm.difficulty,
        topic: qForm.topic.trim(),
        marks: qForm.marks,
        updatedAt: serverTimestamp(),
      }
      if (editingId) {
        await updateDoc(doc(db, 'courses', courseId, 'questionBank', editingId), data)
      } else {
        await addDoc(collection(db, 'courses', courseId, 'questionBank'), { ...data, usageCount: 0, createdAt: serverTimestamp() })
      }
      setFormOpen(false); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function deleteQuestion(id: string, questionText: string) {
    if (!window.confirm(`Delete question: "${questionText.slice(0, 60)}…"?`)) return
    try { await deleteDoc(doc(db, 'courses', courseId, 'questionBank', id)); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed') }
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  async function saveConfig(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError(''); setSuccess('')
    try {
      await setDoc(doc(db, 'courses', courseId, 'exam', 'config'), {
        ...cfgForm,
        createdBy: config?.createdBy ?? '',
        updatedAt: serverTimestamp(),
      })
      setSuccess('Settings saved.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed') }
    finally { setSaving(false) }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const topics = [...new Set(questions.map((q) => q.topic).filter(Boolean))].sort()

  const filteredQs = questions.filter((q) => {
    if (filterTopic && q.topic !== filterTopic) return false
    if (filterDiff && q.difficulty !== filterDiff) return false
    return true
  })

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

  if (loading) return <p className="muted" style={{ padding: '1rem' }}>Loading exam data…</p>

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0' }}>
        {([['bank', '📋 Question Bank'], ['settings', '⚙️ Settings'], ['results', '📊 Results']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              padding: '0.45rem 0.9rem',
              border: 'none',
              borderBottom: tab === key ? '2px solid var(--primary)' : '2px solid transparent',
              background: 'none',
              color: tab === key ? 'var(--primary)' : 'var(--muted-2)',
              fontWeight: tab === key ? 700 : 400,
              cursor: 'pointer',
              fontSize: '0.88rem',
              marginBottom: '-2px',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="error" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      {success && <p className="notice" style={{ marginBottom: '0.75rem' }}>{success}</p>}

      {/* ── Question Bank ── */}
      {tab === 'bank' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={filterTopic} onChange={(e) => setFilterTopic(e.target.value)} style={{ fontSize: '0.85rem' }}>
                <option value="">All topics</option>
                {topics.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={filterDiff} onChange={(e) => setFilterDiff(e.target.value)} style={{ fontSize: '0.85rem' }}>
                <option value="">All difficulties</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
              <span className="muted small">{filteredQs.length} of {questions.length} questions</span>
            </div>
            <button type="button" className="btn small primary" onClick={openNewQuestion}>+ Add Question</button>
          </div>

          {formOpen && (
            <div className="panel" style={{ marginBottom: '1rem' }}>
              <h3 style={{ marginBottom: '0.75rem' }}>{editingId ? '✏️ Edit Question' : '✨ New Question'}</h3>
              <form onSubmit={(e) => void saveQuestion(e)} className="form">
                <label>Question *<textarea value={qForm.question} onChange={(e) => setQForm((f) => ({ ...f, question: e.target.value }))} rows={3} required /></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {([0, 1, 2, 3] as const).map((i) => (
                    <label key={i}>
                      Option {String.fromCharCode(65 + i)} *
                      <input
                        value={qForm.options[i]}
                        onChange={(e) => {
                          const opts = [...qForm.options] as [string, string, string, string]
                          opts[i] = e.target.value
                          setQForm((f) => ({ ...f, options: opts }))
                        }}
                        placeholder={`Option ${String.fromCharCode(65 + i)}`}
                        required
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Correct Answer *
                  <select value={qForm.correctAnswer} onChange={(e) => setQForm((f) => ({ ...f, correctAnswer: e.target.value }))} required>
                    <option value="">Select correct option…</option>
                    {qForm.options.map((o, i) => o.trim() ? <option key={i} value={o.trim()}>{String.fromCharCode(65 + i)}: {o.trim()}</option> : null)}
                  </select>
                </label>
                <label>Explanation<textarea value={qForm.explanation} onChange={(e) => setQForm((f) => ({ ...f, explanation: e.target.value }))} rows={2} /></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: '0.5rem' }}>
                  <label>Topic *<input value={qForm.topic} onChange={(e) => setQForm((f) => ({ ...f, topic: e.target.value }))} required /></label>
                  <label>Difficulty
                    <select value={qForm.difficulty} onChange={(e) => setQForm((f) => ({ ...f, difficulty: e.target.value as Difficulty }))}>
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </label>
                  <label>Marks<input type="number" min={1} value={qForm.marks} onChange={(e) => setQForm((f) => ({ ...f, marks: Number(e.target.value) }))} /></label>
                </div>
                <div className="row">
                  <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Update' : 'Add Question'}</button>
                  <button type="button" className="btn ghost" onClick={() => setFormOpen(false)}>Cancel</button>
                </div>
              </form>
            </div>
          )}

          {filteredQs.length === 0 ? (
            <p className="muted small">No questions yet. Click "+ Add Question" to start building the bank.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {filteredQs.map((q, idx) => {
                const dc = DIFF_COLORS[q.difficulty]
                return (
                  <div key={q.id} className="panel" style={{ padding: '0.75rem 1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                          <span className="muted small">Q{idx + 1}</span>
                          <span style={{ background: dc.bg, color: dc.text, borderRadius: 99, padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 700 }}>{q.difficulty}</span>
                          {q.topic && <span style={{ background: 'var(--surface-soft)', color: 'var(--muted)', borderRadius: 99, padding: '0.1rem 0.5rem', fontSize: '0.72rem' }}>{q.topic}</span>}
                          <span className="muted small">{q.marks} mark{q.marks !== 1 ? 's' : ''} · used {q.usageCount}×</span>
                        </div>
                        <div style={{ fontWeight: 500, marginBottom: '0.35rem', fontSize: '0.9rem' }}>{q.question}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.2rem 0.75rem' }}>
                          {q.options.map((o, i) => (
                            <span key={i} style={{ fontSize: '0.83rem', color: o === q.correctAnswer ? '#059669' : 'var(--muted)', fontWeight: o === q.correctAnswer ? 700 : 400 }}>
                              {String.fromCharCode(65 + i)}. {o} {o === q.correctAnswer ? '✓' : ''}
                            </span>
                          ))}
                        </div>
                        {q.explanation && <p className="muted small" style={{ margin: '0.35rem 0 0', fontStyle: 'italic' }}>💡 {q.explanation}</p>}
                      </div>
                      <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                        <button type="button" className="btn small ghost" onClick={() => openEditQuestion(q)}>Edit</button>
                        <button type="button" className="btn small ghost" onClick={() => void deleteQuestion(q.id, q.question)}>Delete</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Settings ── */}
      {tab === 'settings' && (
        <div>
          {!config && (
            <p className="notice" style={{ marginBottom: '0.75rem' }}>No exam configured yet. Save settings to create the exam for this course.</p>
          )}
          <form onSubmit={(e) => void saveConfig(e)} className="form" style={{ maxWidth: 400 }}>
            <label>
              Duration (minutes)
              <input type="number" min={5} max={180} value={cfgForm.duration} onChange={(e) => setCfgForm((f) => ({ ...f, duration: Number(e.target.value) }))} required />
            </label>
            <label>
              Questions per exam
              <input type="number" min={1} value={cfgForm.questionsPerExam} onChange={(e) => setCfgForm((f) => ({ ...f, questionsPerExam: Number(e.target.value) }))} required />
              <span className="muted small">Bank has {questions.length} question{questions.length !== 1 ? 's' : ''}.</span>
            </label>
            <label>
              Total marks
              <input type="number" min={1} value={cfgForm.totalMarks} onChange={(e) => setCfgForm((f) => ({ ...f, totalMarks: Number(e.target.value) }))} required />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={cfgForm.isActive}
                onChange={(e) => setCfgForm((f) => ({ ...f, isActive: e.target.checked }))}
                style={{ width: 16, height: 16 }}
              />
              <span>Exam active — students can see and start this exam</span>
            </label>
            {cfgForm.isActive && questions.length < cfgForm.questionsPerExam && (
              <p className="error">⚠️ Question bank ({questions.length}) has fewer questions than the exam requires ({cfgForm.questionsPerExam}). Add more questions before activating.</p>
            )}
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</button>
          </form>
        </div>
      )}

      {/* ── Results ── */}
      {tab === 'results' && (
        <div>
          {attempts.length === 0 ? (
            <p className="muted">No attempts yet.</p>
          ) : (
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
                      <tr
                        style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                        onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                      >
                        <td style={{ padding: '0.6rem 0.75rem', fontWeight: 500 }}>{studentMap[a.studentId] ?? a.studentId.slice(0, 8)}</td>
                        <td style={{ padding: '0.6rem 0.75rem' }}>{a.submittedAt ? `${a.score} / ${a.totalMarks}` : '—'}</td>
                        <td style={{ padding: '0.6rem 0.75rem', color: a.submittedAt ? (pct(a.score, a.totalMarks) >= 50 ? '#059669' : '#dc2626') : 'var(--muted-2)' }}>
                          {a.submittedAt ? `${pct(a.score, a.totalMarks)}%` : 'In progress'}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem' }}>{a.timeSpentSeconds > 0 ? fmtTime(a.timeSpentSeconds) : '—'}</td>
                        <td style={{ padding: '0.6rem 0.75rem' }}>{fmtDate(a.submittedAt)}</td>
                        <td style={{ padding: '0.6rem 0.75rem', color: 'var(--muted-2)' }}>{expandedId === a.id ? '▲' : '▼'}</td>
                      </tr>
                      {expandedId === a.id && (
                        <tr>
                          <td colSpan={6} style={{ padding: '0.75rem', background: 'var(--surface-soft)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              {a.questions.map((q, qi) => {
                                const studentAns = a.answers[q.id]
                                const correct = studentAns === q.correctAnswer
                                return (
                                  <div key={q.id} style={{ padding: '0.6rem', background: 'var(--bg)', borderRadius: 8, border: `1px solid ${correct ? '#bbf7d0' : '#fecaca'}` }}>
                                    <div style={{ fontWeight: 600, marginBottom: '0.25rem', fontSize: '0.85rem' }}>
                                      {correct ? '✅' : '❌'} Q{qi + 1}: {q.question}
                                    </div>
                                    <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                                      Student: <span style={{ color: correct ? '#059669' : '#dc2626', fontWeight: 600 }}>{studentAns ?? '(not answered)'}</span>
                                      {!correct && <> · Correct: <span style={{ color: '#059669', fontWeight: 600 }}>{q.correctAnswer}</span></>}
                                    </div>
                                    {q.explanation && <div style={{ fontSize: '0.8rem', color: 'var(--muted)', fontStyle: 'italic', marginTop: '0.2rem' }}>💡 {q.explanation}</div>}
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
      )}
    </div>
  )
}
