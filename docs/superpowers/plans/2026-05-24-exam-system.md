# Exam System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete MCQ exam system inside the existing Raben Learn platform — admin/mentor manage question banks and settings inside SyllabusPage; students take exams via a fullscreen runner; results show score, topic breakdown, and answer review.

**Architecture:** Three phases: Foundation (types + utilities + ExamManager in SyllabusPage), Runner (ExamInstructions + ExamRunner with Framer Motion), Results (ExamResults page + student entry point in StudentCourseView). Exams are stored per-course (`courses/{id}/exam`, `courses/{id}/questionBank`); attempts live in a top-level `examAttempts` collection so they can be queried by studentId across courses.

**Tech Stack:** React 18 + TypeScript + Firebase Firestore + plain CSS (no Tailwind) + Framer Motion (new dep, Phase 2 only)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `platform/src/types.ts` | Modify | Add ExamConfig, ExamQuestion, QuestionSnapshot, ExamAttempt |
| `platform/src/lib/examUtils.ts` | Create | shuffle, pickQuestions, makeSnapshots, calculateScore |
| `platform/src/pages/admin/ExamManager.tsx` | Create | Question bank CRUD + settings + results table (admin/mentor) |
| `platform/src/pages/admin/SyllabusPage.tsx` | Modify | Add "📝 Exam" tab that renders ExamManager |
| `platform/src/pages/exam/ExamInstructions.tsx` | Create | Pre-exam info + attempt creation |
| `platform/src/pages/exam/ExamRunner.tsx` | Create | Fullscreen exam UI with timer, palette, Framer Motion |
| `platform/src/pages/exam/ExamResults.tsx` | Create | Score card + topic breakdown + answer review |
| `platform/src/App.tsx` | Modify | Add exam routes, remove placeholder ExamPage |
| `platform/src/pages/student/StudentCourseView.tsx` | Modify | Load exam state, show Take/Resume/Review button |

---

## Task 1: Add Exam Types

**Files:**
- Modify: `platform/src/types.ts`

- [ ] **Step 1: Append the four new interfaces at the end of types.ts**

Open `platform/src/types.ts` and append after the last line:

```typescript
export interface ExamConfig {
  duration: number           // minutes
  totalMarks: number
  questionsPerExam: number
  isActive: boolean
  createdBy: string          // uid
}

export interface ExamQuestion {
  id: string
  question: string
  options: string[]          // always 4
  correctAnswer: string      // must match one of options exactly
  explanation: string
  difficulty: 'easy' | 'medium' | 'hard'
  topic: string
  marks: number
  usageCount: number
}

export interface QuestionSnapshot extends ExamQuestion {
  shuffledOptions: string[]  // options in the order shown to the student
}

export interface ExamAttempt {
  id: string
  studentId: string
  courseId: string
  startedAt: string          // ISO timestamp string
  submittedAt: string | null
  timeSpentSeconds: number
  questions: QuestionSnapshot[]
  answers: Record<string, string>  // questionId → chosen option text
  score: number
  totalMarks: number
  topicBreakdown: Record<string, { correct: number; total: number }>
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd platform && npx tsc --noEmit
```

Expected: no errors about the new types.

- [ ] **Step 3: Commit**

```bash
cd platform
git add src/types.ts
git commit -m "feat: add ExamConfig, ExamQuestion, QuestionSnapshot, ExamAttempt types"
```

---

## Task 2: Create examUtils.ts

**Files:**
- Create: `platform/src/lib/examUtils.ts`

- [ ] **Step 1: Create the file with shuffle, pick, snapshot, and score helpers**

```typescript
import type { ExamQuestion, QuestionSnapshot } from '../types'

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/**
 * Picks `count` questions weighted by inverse usageCount so less-used questions
 * are more likely to be selected. Falls back to full shuffled list if bank is small.
 */
export function pickQuestions(questions: ExamQuestion[], count: number): ExamQuestion[] {
  if (questions.length <= count) return shuffleArray(questions)
  const maxUsage = Math.max(...questions.map((q) => q.usageCount), 1)
  const pool = [...questions]
  const selected: ExamQuestion[] = []
  for (let i = 0; i < count; i++) {
    const weights = pool.map((q) => maxUsage - q.usageCount + 1)
    const total = weights.reduce((s, w) => s + w, 0)
    let rand = Math.random() * total
    let idx = 0
    while (idx < pool.length - 1 && rand > weights[idx]!) {
      rand -= weights[idx]!
      idx++
    }
    selected.push(pool.splice(idx, 1)[0]!)
  }
  return selected
}

/** Wraps each question with shuffled option order for display. */
export function makeSnapshots(questions: ExamQuestion[]): QuestionSnapshot[] {
  return questions.map((q) => ({ ...q, shuffledOptions: shuffleArray(q.options) }))
}

export function calculateScore(
  questions: QuestionSnapshot[],
  answers: Record<string, string>,
): { score: number; topicBreakdown: Record<string, { correct: number; total: number }> } {
  let score = 0
  const topicBreakdown: Record<string, { correct: number; total: number }> = {}
  for (const q of questions) {
    const topic = q.topic.trim() || 'General'
    if (!topicBreakdown[topic]) topicBreakdown[topic] = { correct: 0, total: 0 }
    topicBreakdown[topic]!.total++
    if (answers[q.id] === q.correctAnswer) {
      score += q.marks
      topicBreakdown[topic]!.correct++
    }
  }
  return { score, topicBreakdown }
}

export function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd platform && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd platform
git add src/lib/examUtils.ts
git commit -m "feat: add examUtils (shuffle, pick, snapshot, score, formatTime)"
```

---

## Task 3: Create ExamManager

**Files:**
- Create: `platform/src/pages/admin/ExamManager.tsx`

This is the largest file. It has three internal tabs: Question Bank, Settings, Results.

- [ ] **Step 1: Create the file**

```tsx
import { useEffect, useState, type FormEvent } from 'react'
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
                    <>
                      <tr
                        key={a.id}
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
                        <tr key={`${a.id}-expanded`}>
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
                    </>
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
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd platform && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd platform
git add src/pages/admin/ExamManager.tsx
git commit -m "feat: add ExamManager with question bank CRUD, settings, and results table"
```

---

## Task 4: Add Exam Tab to SyllabusPage

**Files:**
- Modify: `platform/src/pages/admin/SyllabusPage.tsx`

- [ ] **Step 1: Add rightTab state and ExamManager import**

At the top of `SyllabusPage.tsx`, add after the existing imports (line 7, after `readTopicsFromSessionDoc`):

```typescript
import ExamManager from './ExamManager'
import { useAuth } from '../../context/AuthContext'
```

- [ ] **Step 2: Add rightTab state inside SyllabusPage function**

After line 47 (`const [openMenuId, setOpenMenuId] = useState<string | null>(null)`), add:

```typescript
const { profile } = useAuth()
const isAdminOrMentor = profile?.roles.some((r) => r === 'admin' || r === 'mentor') ?? false
const [rightTab, setRightTab] = useState<'sessions' | 'exam'>('sessions')
```

- [ ] **Step 3: Add tab buttons inside the right column, after the breadcrumb**

Find line 366 (the breadcrumb line):
```tsx
<p className="muted small syllabus-breadcrumb">in {selectedCourse?.title}</p>
```

After that line, add the tab switcher:
```tsx
{isAdminOrMentor && (
  <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem', borderBottom: '2px solid var(--border)' }}>
    {(['sessions', 'exam'] as const).map((t) => (
      <button
        key={t}
        type="button"
        onClick={() => setRightTab(t)}
        style={{
          padding: '0.4rem 0.85rem',
          border: 'none',
          borderBottom: rightTab === t ? '2px solid var(--primary)' : '2px solid transparent',
          background: 'none',
          color: rightTab === t ? 'var(--primary)' : 'var(--muted-2)',
          fontWeight: rightTab === t ? 700 : 400,
          cursor: 'pointer',
          fontSize: '0.86rem',
          marginBottom: '-2px',
        }}
      >
        {t === 'sessions' ? '📋 Sessions' : '📝 Exam'}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 4: Wrap existing sessions content and add ExamManager**

Find the import result notice at line 371:
```tsx
{importResult ? <p className="notice" style={{ marginBottom: '0.5rem' }}>{importResult}</p> : null}
```

Wrap everything from `{importResult ...}` down to the closing `</div>` of the right column (line 532) with `{rightTab === 'sessions' && (` ... `)}`, then add the ExamManager below:

The right column `<div className="syllabus-col syllabus-col-wide">` currently ends at line 532 with `</div>`.

Replace the contents from line 371 to line 531 with:

```tsx
{rightTab === 'sessions' ? (
  <>
    {importResult ? <p className="notice" style={{ marginBottom: '0.5rem' }}>{importResult}</p> : null}
    {/* ... all existing session form and session list JSX ... */}
  </>
) : (
  <ExamManager courseId={selectedCourseId} />
)}
```

**Note to implementer:** The sessions JSX to keep inside the `rightTab === 'sessions'` branch is everything from `{importResult ? ...}` through the closing `</ul>` of the session list (line 531). Do not remove any of this — just wrap it. Only the closing `</div>` at line 532 and `) : null}` at line 533 stay outside the condition.

- [ ] **Step 5: Verify TypeScript and visually test**

```bash
cd platform && npx tsc --noEmit
npm run dev
```

Navigate to Syllabus page, select a course, confirm "Sessions" and "Exam" tabs appear. Click "Exam" tab and verify ExamManager loads with "Question Bank / Settings / Results" sub-tabs.

- [ ] **Step 6: Commit**

```bash
cd platform
git add src/pages/admin/SyllabusPage.tsx
git commit -m "feat: add Exam tab to SyllabusPage, renders ExamManager for admin/mentor"
```

---

## Task 5: Install Framer Motion

**Files:**
- Modify: `platform/package.json` (via npm)

- [ ] **Step 1: Install the dependency**

```bash
cd platform && npm install framer-motion
```

Expected: framer-motion appears in `package.json` dependencies.

- [ ] **Step 2: Verify the build still works**

```bash
cd platform && npx tsc --noEmit && npm run build 2>&1 | tail -5
```

Expected: build succeeds, no errors.

- [ ] **Step 3: Commit**

```bash
cd platform
git add package.json package-lock.json
git commit -m "feat: install framer-motion for exam question transitions"
```

---

## Task 6: Create ExamInstructions

**Files:**
- Create: `platform/src/pages/exam/ExamInstructions.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { makeSnapshots, pickQuestions } from '../../lib/examUtils'
import type { ExamAttempt, ExamConfig, ExamQuestion } from '../../types'

export default function ExamInstructions() {
  const { courseId } = useParams<{ courseId: string }>()
  const { firebaseUser } = useAuth()
  const navigate = useNavigate()

  const [config, setConfig] = useState<ExamConfig | null>(null)
  const [courseTitle, setCourseTitle] = useState('')
  const [existingAttempt, setExistingAttempt] = useState<ExamAttempt | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { void load() }, [courseId, firebaseUser?.uid])

  async function load() {
    if (!courseId || !firebaseUser?.uid) return
    setLoading(true)
    try {
      const [courseSnap, cfgSnap, attSnap] = await Promise.all([
        getDoc(doc(db, 'courses', courseId)),
        getDoc(doc(db, 'courses', courseId, 'exam', 'config')),
        getDocs(query(collection(db, 'examAttempts'), where('studentId', '==', firebaseUser.uid), where('courseId', '==', courseId))),
      ])
      if (courseSnap.exists()) setCourseTitle((courseSnap.data().title as string) ?? '')
      if (cfgSnap.exists()) setConfig(cfgSnap.data() as ExamConfig)

      if (!attSnap.empty) {
        const d = attSnap.docs[0]!
        const att = { id: d.id, ...(d.data() as Omit<ExamAttempt, 'id'>) }
        setExistingAttempt(att)
        // If already submitted, redirect straight to results
        if (att.submittedAt) {
          navigate(`/exam/${courseId}/results/${att.id}`, { replace: true })
          return
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }

  async function startExam() {
    if (!courseId || !firebaseUser?.uid || !config) return
    // Resume if incomplete attempt exists
    if (existingAttempt && !existingAttempt.submittedAt) {
      navigate(`/exam/${courseId}/run`, { state: { attemptId: existingAttempt.id } })
      return
    }
    setStarting(true); setError('')
    try {
      const qSnap = await getDocs(collection(db, 'courses', courseId, 'questionBank'))
      const allQs: ExamQuestion[] = []
      qSnap.forEach((d) => allQs.push({ id: d.id, ...(d.data() as Omit<ExamQuestion, 'id'>) }))

      if (allQs.length === 0) { setError('No questions in the question bank yet.'); setStarting(false); return }

      const picked = pickQuestions(allQs, config.questionsPerExam)
      const snapshots = makeSnapshots(picked)

      const attemptData: Omit<ExamAttempt, 'id'> = {
        studentId: firebaseUser.uid,
        courseId,
        startedAt: new Date().toISOString(),
        submittedAt: null,
        timeSpentSeconds: 0,
        questions: snapshots,
        answers: {},
        score: 0,
        totalMarks: config.totalMarks,
        topicBreakdown: {},
      }

      const ref = await addDoc(collection(db, 'examAttempts'), {
        ...attemptData,
        createdAt: serverTimestamp(),
      })

      navigate(`/exam/${courseId}/run`, { state: { attemptId: ref.id } })
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to start exam'); setStarting(false) }
  }

  if (loading) return <div style={{ padding: '2rem' }}><p className="muted">Loading…</p></div>

  if (!config) return (
    <div style={{ padding: '2rem' }}>
      <p className="error">No exam configured for this course yet. Ask your mentor.</p>
    </div>
  )

  if (!config.isActive) return (
    <div style={{ padding: '2rem' }}>
      <p className="notice">The exam for this course is not active yet. Check back later.</p>
    </div>
  )

  const isResume = !!existingAttempt && !existingAttempt.submittedAt

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ marginBottom: '0.3rem' }}>{courseTitle}</h1>
      <h2 style={{ marginBottom: '1.5rem', fontWeight: 400, color: 'var(--muted)' }}>Exam Instructions</h2>

      <div className="panel" style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ marginBottom: '0.75rem' }}>Exam Details</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {[
            ['⏱ Duration', `${config.duration} minutes`],
            ['📋 Questions', `${config.questionsPerExam} questions`],
            ['🏆 Total Marks', `${config.totalMarks} marks`],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
              <span className="muted">{label}</span>
              <span style={{ fontWeight: 600 }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '0.75rem' }}>Rules</h3>
        <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
          <li>You get one attempt only — choose your answers carefully.</li>
          <li>Answers are saved automatically as you select them.</li>
          <li>The timer auto-submits when time runs out.</li>
          <li>You can navigate between questions freely using the palette.</li>
          <li>Use keyboard: ← → arrows to navigate, 1–4 to select options.</li>
        </ul>
      </div>

      {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}

      {isResume ? (
        <div style={{ marginBottom: '0.75rem' }}>
          <p className="notice">You have an incomplete attempt. Click Resume to continue where you left off.</p>
        </div>
      ) : null}

      <button
        type="button"
        className="btn primary"
        style={{ width: '100%', padding: '0.85rem', fontSize: '1rem' }}
        onClick={() => void startExam()}
        disabled={starting}
      >
        {starting ? 'Starting…' : isResume ? '▶ Resume Exam' : '🚀 Start Exam'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd platform && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd platform
git add src/pages/exam/ExamInstructions.tsx
git commit -m "feat: add ExamInstructions page with attempt creation and resume detection"
```

---

## Task 7: Create ExamRunner

**Files:**
- Create: `platform/src/pages/exam/ExamRunner.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { collection, doc, getDocs, increment, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { calculateScore, formatTime } from '../../lib/examUtils'
import type { ExamAttempt } from '../../types'

export default function ExamRunner() {
  const { courseId } = useParams<{ courseId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { firebaseUser } = useAuth()

  const [attempt, setAttempt] = useState<ExamAttempt | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [currentIdx, setCurrentIdx] = useState(0)
  const [timeLeft, setTimeLeft] = useState(0)           // seconds
  const [direction, setDirection] = useState(1)         // 1 = forward, -1 = backward
  const [paletteOpen, setPaletteOpen] = useState(false) // mobile drawer
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const startedAtRef = useRef<number>(Date.now())
  const attemptIdRef = useRef<string | null>(null)
  const autoSubmitFired = useRef(false)

  // ─── Load attempt ──────────────────────────────────────────────────────────

  useEffect(() => {
    void load()
  }, [courseId, firebaseUser?.uid])

  async function load() {
    if (!courseId || !firebaseUser?.uid) return
    setLoading(true)
    try {
      let att: ExamAttempt | null = null
      const stateAttemptId = (location.state as { attemptId?: string } | null)?.attemptId

      // Try to get attemptId from navigation state or query Firestore
      const attSnap = await (async () => {
        if (stateAttemptId) {
          const { getDoc } = await import('firebase/firestore')
          const d = await getDoc(doc(db, 'examAttempts', stateAttemptId))
          return d.exists() ? [d] : []
        }
        const snap = await getDocs(
          query(collection(db, 'examAttempts'),
            where('studentId', '==', firebaseUser.uid),
            where('courseId', '==', courseId))
        )
        return snap.docs
      })()

      if (attSnap.length === 0) {
        setError('No exam attempt found. Please go back and start the exam.')
        setLoading(false)
        return
      }

      const d = attSnap[0]!
      att = { id: d.id, ...(d.data() as Omit<ExamAttempt, 'id'>) }

      // If already submitted, redirect to results
      if (att.submittedAt) {
        navigate(`/exam/${courseId}/results/${att.id}`, { replace: true })
        return
      }

      attemptIdRef.current = att.id
      setAttempt(att)
      setAnswers(att.answers)

      // Calculate remaining time based on how long the exam has been open
      const elapsedSecs = Math.floor((Date.now() - new Date(att.startedAt).getTime()) / 1000)
      const durationSecs = att.questions.length > 0
        ? Math.floor((att.totalMarks / att.questions.length) * 60)   // fallback estimate
        : 30 * 60

      // Fetch actual duration from exam config
      const { getDoc: gd } = await import('firebase/firestore')
      const cfgSnap = await gd(doc(db, 'courses', courseId, 'exam', 'config'))
      const durationMinutes: number = cfgSnap.exists() ? (cfgSnap.data().duration as number) : 30
      const totalSecs = durationMinutes * 60
      const remaining = Math.max(0, totalSecs - elapsedSecs)
      setTimeLeft(remaining)
      startedAtRef.current = new Date(att.startedAt).getTime()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }

  // ─── Timer ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!attempt || timeLeft <= 0) return
    const id = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { clearInterval(id); void autoSubmit(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [!!attempt, timeLeft <= 0])

  async function autoSubmit() {
    if (autoSubmitFired.current) return
    autoSubmitFired.current = true
    await submit(true)
  }

  // ─── Keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (['1', '2', '3', '4'].includes(e.key)) {
        const q = attempt?.questions[currentIdx]
        if (!q) return
        const opt = q.shuffledOptions[Number(e.key) - 1]
        if (opt) void selectAnswer(q.id, opt)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [attempt, currentIdx, answers])

  // ─── Navigation ────────────────────────────────────────────────────────────

  function goTo(idx: number) {
    setDirection(idx > currentIdx ? 1 : -1)
    setCurrentIdx(idx)
    setPaletteOpen(false)
  }

  function goNext() {
    if (!attempt) return
    if (currentIdx < attempt.questions.length - 1) goTo(currentIdx + 1)
  }

  function goPrev() {
    if (currentIdx > 0) goTo(currentIdx - 1)
  }

  // ─── Answer selection ──────────────────────────────────────────────────────

  async function selectAnswer(questionId: string, option: string) {
    const next = { ...answers, [questionId]: option }
    setAnswers(next)
    if (!attemptIdRef.current) return
    try {
      await updateDoc(doc(db, 'examAttempts', attemptIdRef.current), {
        [`answers.${questionId}`]: option,
      })
    } catch { /* non-critical: answer saved locally */ }
  }

  // ─── Submit ────────────────────────────────────────────────────────────────

  async function submit(auto = false) {
    if (!attempt || !attemptIdRef.current || submitting) return
    if (!auto) {
      if (!window.confirm('Are you sure you want to submit? You cannot change answers after submitting.')) return
    }
    setSubmitting(true)
    try {
      const timeSpentSeconds = Math.floor((Date.now() - startedAtRef.current) / 1000)
      const { score, topicBreakdown } = calculateScore(attempt.questions, answers)

      await updateDoc(doc(db, 'examAttempts', attemptIdRef.current), {
        submittedAt: new Date().toISOString(),
        score,
        topicBreakdown,
        timeSpentSeconds,
        answers,
      })

      // Increment usageCount on each question
      await Promise.all(
        attempt.questions.map((q) =>
          updateDoc(doc(db, 'courses', courseId!, 'questionBank', q.id), { usageCount: increment(1) })
        )
      )

      navigate(`/exam/${courseId}/results/${attemptIdRef.current}`, { replace: true })
    } catch (e) { setError(e instanceof Error ? e.message : 'Submit failed'); setSubmitting(false) }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div style={{ padding: '2rem' }}><p className="muted">Loading exam…</p></div>
  if (error) return <div style={{ padding: '2rem' }}><p className="error">{error}</p></div>
  if (!attempt) return null

  const q = attempt.questions[currentIdx]!
  const totalQ = attempt.questions.length
  const timerRed = timeLeft <= 300
  const answeredCount = Object.keys(answers).length

  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0 }),
  }

  function paletteStatus(idx: number) {
    const qid = attempt!.questions[idx]!.id
    if (idx === currentIdx) return 'current'
    if (answers[qid]) return 'answered'
    return 'unseen'
  }

  const PALETTE_COLORS: Record<string, string> = {
    current: 'var(--primary)',
    answered: '#059669',
    unseen: 'var(--border)',
  }

  const palette = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--muted)' }}>
        {answeredCount}/{totalQ} answered
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.3rem' }}>
        {attempt.questions.map((_, idx) => {
          const status = paletteStatus(idx)
          return (
            <button
              key={idx}
              type="button"
              onClick={() => goTo(idx)}
              style={{
                width: '100%',
                aspectRatio: '1',
                border: `2px solid ${PALETTE_COLORS[status]}`,
                borderRadius: 6,
                background: status === 'current' ? 'var(--primary)' : status === 'answered' ? '#dcfce7' : 'var(--bg)',
                color: status === 'current' ? '#fff' : 'var(--text)',
                fontWeight: status === 'current' ? 700 : 400,
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              {idx + 1}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
        <span>🟦 Current</span>
        <span>🟩 Answered</span>
        <span>⬜ Unseen</span>
      </div>
      <button
        type="button"
        className="btn primary"
        style={{ marginTop: '0.5rem' }}
        onClick={() => void submit()}
        disabled={submitting}
      >
        {submitting ? 'Submitting…' : 'Submit Exam'}
      </button>
    </div>
  )

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: '100%', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexWrap: 'wrap', gap: '0.5rem' }}>
        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Q {currentIdx + 1} / {totalQ}</span>
        <span style={{ fontWeight: 700, fontSize: '1rem', color: timerRed ? '#dc2626' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          ⏱ {formatTime(timeLeft)}
        </span>
        {/* Mobile: palette toggle */}
        <button
          type="button"
          className="btn small ghost"
          onClick={() => setPaletteOpen((v) => !v)}
          style={{ display: 'none' }}   // shown via CSS on mobile
          aria-label="Open question palette"
        >
          📊 Questions
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Main question area */}
        <div style={{ flex: 1, padding: '1.5rem 1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <p className="muted small" style={{ marginBottom: '0.75rem' }}>Question {currentIdx + 1} of {totalQ}</p>

          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentIdx}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: 'easeInOut' }}
            >
              <div className="panel" style={{ marginBottom: '1.25rem', fontSize: '1rem', lineHeight: 1.6 }}>
                {q.question}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {q.shuffledOptions.map((opt, i) => {
                  const selected = answers[q.id] === opt
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => void selectAnswer(q.id, opt)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.75rem 1rem',
                        border: `2px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
                        borderRadius: 10,
                        background: selected ? 'var(--primary-soft, #ede9fe)' : 'var(--bg)',
                        color: selected ? 'var(--primary)' : 'var(--text)',
                        fontWeight: selected ? 700 : 400,
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: '0.95rem',
                        transition: 'border-color 0.15s, background 0.15s',
                      }}
                    >
                      <span style={{ width: 28, height: 28, borderRadius: '50%', border: `2px solid ${selected ? 'var(--primary)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem', flexShrink: 0, background: selected ? 'var(--primary)' : 'transparent', color: selected ? '#fff' : 'var(--muted-2)' }}>
                        {i + 1}
                      </span>
                      {opt}
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </AnimatePresence>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto' }}>
            <button type="button" className="btn ghost" onClick={goPrev} disabled={currentIdx === 0}>← Previous</button>
            <button type="button" className="btn ghost" onClick={goNext} disabled={currentIdx === totalQ - 1}>Next →</button>
          </div>
        </div>

        {/* Sidebar palette — desktop */}
        <div style={{ width: 200, borderLeft: '1px solid var(--border)', padding: '1rem', overflowY: 'auto', flexShrink: 0 }} className="exam-palette-desktop">
          {palette}
        </div>
      </div>

      {/* Mobile palette drawer */}
      {paletteOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => setPaletteOpen(false)}
        >
          <div
            style={{ background: 'var(--bg)', width: '100%', padding: '1.5rem 1rem', borderRadius: '16px 16px 0 0', maxHeight: '70vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            {palette}
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: '0.75rem 1rem', background: '#fee2e2', color: '#991b1b', fontSize: '0.88rem' }}>{error}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add CSS for the exam palette desktop/mobile toggle**

Add to `platform/src/index.css`:

```css
/* Exam Runner */
.exam-palette-desktop { display: flex; flex-direction: column; }
@media (max-width: 600px) {
  .exam-palette-desktop { display: none; }
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd platform && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd platform
git add src/pages/exam/ExamRunner.tsx src/index.css
git commit -m "feat: add ExamRunner with timer, Framer Motion transitions, palette, and submit"
```

---

## Task 8: Update App.tsx Routes

**Files:**
- Modify: `platform/src/App.tsx`

- [ ] **Step 1: Replace the placeholder exam route with the three real exam routes**

Open `platform/src/App.tsx`.

Remove these lines:
```tsx
import ExamPage from './pages/ExamPage'
```

and:
```tsx
<Route path="exam" element={<ExamPage />} />
```

Add these imports at the top:
```tsx
import ExamInstructions from './pages/exam/ExamInstructions'
import ExamRunner from './pages/exam/ExamRunner'
import ExamResults from './pages/exam/ExamResults'
```

Add these routes inside `<Route path="/" element={<AppShell />}>` (replace the old `<Route path="exam" element={<ExamPage />} />`):
```tsx
<Route path="exam">
  <Route path=":courseId/instructions" element={<ExamInstructions />} />
  <Route path=":courseId/run" element={<ExamRunner />} />
  <Route path=":courseId/results/:attemptId" element={<ExamResults />} />
</Route>
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd platform && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd platform
git add src/App.tsx
git commit -m "feat: add exam routes to App (instructions, run, results)"
```

---

## Task 9: Create ExamResults

**Files:**
- Create: `platform/src/pages/exam/ExamResults.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { ExamAttempt } from '../../types'

function pct(score: number, total: number) {
  return total === 0 ? 0 : Math.round((score / total) * 100)
}

function encouragement(p: number) {
  if (p >= 80) return 'Excellent! 🎉'
  if (p >= 60) return 'Good job! 👍'
  if (p >= 40) return 'Keep practising! 💪'
  return "Don't give up! 🌱"
}

function fmtTime(secs: number) {
  const m = Math.floor(secs / 60), s = secs % 60
  return `${m}m ${s}s`
}

export default function ExamResults() {
  const { courseId, attemptId } = useParams<{ courseId: string; attemptId: string }>()
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null)
  const [courseTitle, setCourseTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { void load() }, [attemptId, courseId])

  async function load() {
    if (!attemptId || !courseId) return
    setLoading(true)
    try {
      const [attSnap, courseSnap] = await Promise.all([
        getDoc(doc(db, 'examAttempts', attemptId)),
        getDoc(doc(db, 'courses', courseId)),
      ])
      if (!attSnap.exists()) { setError('Attempt not found.'); return }
      setAttempt({ id: attSnap.id, ...(attSnap.data() as Omit<ExamAttempt, 'id'>) })
      if (courseSnap.exists()) setCourseTitle((courseSnap.data().title as string) ?? '')
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }

  if (loading) return <div style={{ padding: '2rem' }}><p className="muted">Loading results…</p></div>
  if (error) return <div style={{ padding: '2rem' }}><p className="error">{error}</p></div>
  if (!attempt) return null
  if (!attempt.submittedAt) return <div style={{ padding: '2rem' }}><p className="notice">This exam has not been submitted yet.</p></div>

  const p = pct(attempt.score, attempt.totalMarks)
  const passed = p >= 50
  const topicEntries = Object.entries(attempt.topicBreakdown).sort((a, b) => b[1].correct / b[1].total - a[1].correct / a[1].total)

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <Link to={`/student/courses/${courseId}`} className="muted small">← Back to course</Link>
      </div>
      <h1 style={{ marginBottom: '0.25rem' }}>{courseTitle}</h1>
      <h2 style={{ fontWeight: 400, color: 'var(--muted)', marginBottom: '1.5rem' }}>Exam Results</h2>

      {/* Score card */}
      <div className="panel" style={{ textAlign: 'center', padding: '2rem 1.5rem', marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '3rem', fontWeight: 800, color: passed ? '#059669' : '#dc2626', marginBottom: '0.25rem' }}>
          {attempt.score} / {attempt.totalMarks}
        </div>
        <div style={{ fontSize: '1.4rem', fontWeight: 600, color: passed ? '#059669' : '#dc2626', marginBottom: '0.5rem' }}>
          {p}% — {passed ? 'Pass ✅' : 'Fail ❌'}
        </div>
        <div style={{ fontSize: '1.1rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>{encouragement(p)}</div>
        <div className="muted small">Time taken: {fmtTime(attempt.timeSpentSeconds)}</div>
      </div>

      {/* Topic breakdown */}
      {topicEntries.length > 0 && (
        <div className="panel" style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ marginBottom: '0.75rem' }}>Topic Breakdown</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {topicEntries.map(([topic, { correct, total }]) => {
              const tp = pct(correct, total)
              return (
                <div key={topic}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.88rem' }}>
                    <span style={{ fontWeight: 500 }}>{topic}</span>
                    <span style={{ color: tp >= 50 ? '#059669' : '#dc2626', fontWeight: 600 }}>{correct}/{total} correct ({tp}%)</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${tp}%`, background: tp >= 50 ? '#10b981' : '#f87171', borderRadius: 99, transition: 'width 0.4s' }} />
                  </div>
                </div>
              )
            })}
          </div>
          {topicEntries.length > 1 && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.83rem', color: 'var(--muted)' }}>
              Strongest: <strong>{topicEntries[0]![0]}</strong> · Weakest: <strong>{topicEntries[topicEntries.length - 1]![0]}</strong>
            </div>
          )}
        </div>
      )}

      {/* Answer review */}
      <div className="panel">
        <h3 style={{ marginBottom: '0.75rem' }}>Answer Review</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {attempt.questions.map((q, idx) => {
            const studentAns = attempt.answers[q.id]
            const correct = studentAns === q.correctAnswer
            return (
              <div key={q.id} style={{ borderLeft: `3px solid ${correct ? '#10b981' : '#f87171'}`, paddingLeft: '0.75rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.3rem', fontSize: '0.9rem' }}>
                  {correct ? '✅' : '❌'} Q{idx + 1}: {q.question}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', marginBottom: '0.3rem' }}>
                  {q.shuffledOptions.map((opt) => {
                    const isCorrect = opt === q.correctAnswer
                    const isStudentWrong = opt === studentAns && !correct
                    return (
                      <div
                        key={opt}
                        style={{
                          fontSize: '0.85rem',
                          padding: '0.2rem 0.5rem',
                          borderRadius: 4,
                          background: isCorrect ? '#dcfce7' : isStudentWrong ? '#fee2e2' : 'transparent',
                          color: isCorrect ? '#166534' : isStudentWrong ? '#991b1b' : 'var(--muted)',
                          fontWeight: isCorrect || isStudentWrong ? 700 : 400,
                        }}
                      >
                        {opt}
                        {isCorrect ? ' ✓' : ''}
                        {isStudentWrong ? ' ✗ (your answer)' : ''}
                      </div>
                    )
                  })}
                </div>
                {q.explanation && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--muted)', fontStyle: 'italic' }}>💡 {q.explanation}</div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd platform && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd platform
git add src/pages/exam/ExamResults.tsx
git commit -m "feat: add ExamResults with score card, topic breakdown, and answer review"
```

---

## Task 10: Add Take Exam Button to StudentCourseView

**Files:**
- Modify: `platform/src/pages/student/StudentCourseView.tsx`

This task adds the exam entry point at the top of the course view. It loads the exam config and the student's attempt state, then shows the appropriate button.

- [ ] **Step 1: Add new imports at the top of StudentCourseView.tsx**

After the existing imports (after line 8), add:
```typescript
import { Link } from 'react-router-dom'
import type { ExamAttempt, ExamConfig } from '../../types'
```

Note: `Link` may already be imported — check first; if so, skip it.

- [ ] **Step 2: Add exam state inside the StudentCourseView function**

After the existing `const [error, setError] = useState('')` line, add:
```typescript
const [examConfig, setExamConfig] = useState<ExamConfig | null>(null)
const [examAttempt, setExamAttempt] = useState<ExamAttempt | null>(null)
```

- [ ] **Step 3: Load exam data inside the existing load() callback**

Inside `load()`, after the three existing Firestore fetches and their results are set, add these parallel fetches:

```typescript
// Load exam config and student's attempt for this course
const [examCfgSnap, examAttSnap] = await Promise.all([
  getDoc(doc(db, 'courses', courseId, 'exam', 'config')),
  getDocs(query(collection(db, 'examAttempts'), where('studentId', '==', uid), where('courseId', '==', courseId))),
])
if (examCfgSnap.exists()) setExamConfig(examCfgSnap.data() as ExamConfig)
if (!examAttSnap.empty) {
  const d = examAttSnap.docs[0]!
  setExamAttempt({ id: d.id, ...(d.data() as Omit<ExamAttempt, 'id'>) })
}
```

Also add `where` to the existing firebase/firestore import at the top if it is not already there (it is — confirmed on line 3).

And add `ExamAttempt, ExamConfig` to the types import.

- [ ] **Step 4: Render the exam banner at the top of the page content**

Inside the return JSX, after the course header (the `<h1>` and description block) but before the sessions list, add:

```tsx
{/* Exam entry point */}
{examConfig?.isActive && (
  <div className="panel" style={{ marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
    <div>
      <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>📝 Course Exam</div>
      <div className="muted small">{examConfig.questionsPerExam} questions · {examConfig.duration} min · {examConfig.totalMarks} marks</div>
    </div>
    {!examAttempt && (
      <Link to={`/exam/${courseId}/instructions`} className="btn primary">Take Exam</Link>
    )}
    {examAttempt && !examAttempt.submittedAt && (
      <Link to={`/exam/${courseId}/run`} state={{ attemptId: examAttempt.id }} className="btn primary">Resume Exam</Link>
    )}
    {examAttempt?.submittedAt && (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: examAttempt.score / examAttempt.totalMarks >= 0.5 ? '#059669' : '#dc2626' }}>
          Scored {examAttempt.score}/{examAttempt.totalMarks}
        </span>
        <Link to={`/exam/${courseId}/results/${examAttempt.id}`} className="btn small ghost">Review →</Link>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd platform && npx tsc --noEmit
```

- [ ] **Step 6: Test the full flow in dev server**

```bash
cd platform && npm run dev
```

1. Log in as admin → Syllabus → select a course → click "Exam" tab.
2. In Settings: set duration 5, questions 2, marks 2, add 3+ questions in Question Bank, activate the exam.
3. Log in as student → go to the course → confirm "Take Exam" button appears.
4. Click Take Exam → Instructions page shows correct details.
5. Click Start → ExamRunner loads with timer, questions, and palette.
6. Answer questions and submit → redirected to ExamResults.
7. Back in course view: score badge shown. "Review →" link works.
8. Admin Syllabus → Exam → Results: shows the student's attempt with answer sheet.

- [ ] **Step 7: Commit**

```bash
cd platform
git add src/pages/student/StudentCourseView.tsx
git commit -m "feat: add exam entry point to StudentCourseView (take / resume / review)"
```

---

## Self-Review Against Spec

**Spec section → Task:**

| Spec requirement | Task |
|-----------------|------|
| Firestore model: `courses/{id}/exam`, `questionBank`, `examAttempts` | Tasks 1, 6 |
| ExamConfig, ExamQuestion, QuestionSnapshot, ExamAttempt types | Task 1 |
| shuffle, pickQuestions (weighted), makeSnapshots, calculateScore | Task 2 |
| Admin/mentor question bank CRUD with filter, usage count | Task 3 |
| Exam settings tab with isActive toggle | Task 3 |
| Results table with answer sheet expand | Task 3 |
| "📝 Exam" tab in SyllabusPage | Task 4 |
| Install Framer Motion | Task 5 |
| ExamInstructions with rules, one-attempt check, resume | Task 6 |
| ExamRunner: timer, Framer Motion slide transitions | Task 7 |
| ExamRunner: keyboard shortcuts (ArrowLeft/Right, 1-4) | Task 7 |
| ExamRunner: auto-submit at zero | Task 7 |
| ExamRunner: real-time answer save | Task 7 |
| ExamRunner: submit flow with confirm dialog | Task 7 |
| ExamRunner: usageCount increment on submit | Task 7 |
| ExamRunner: question palette (desktop sidebar, mobile drawer) | Task 7 |
| App routes `/exam/:courseId/instructions|run|results/:id` | Task 8 |
| ExamResults: score card with percentage and pass/fail | Task 9 |
| ExamResults: encouragement messages | Task 9 |
| ExamResults: topic breakdown bars | Task 9 |
| ExamResults: answer review with color-coded options | Task 9 |
| Student entry: Take/Resume/Review on StudentCourseView | Task 10 |
| Access control: Exam tab only for admin/mentor | Task 4 (`isAdminOrMentor` check) |
