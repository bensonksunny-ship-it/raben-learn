import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { shuffleArray } from '../../lib/examUtils'
import type { Exam, ExamAttempt } from '../../types'

export default function ExamInstructions() {
  const { courseId, examId } = useParams<{ courseId: string; examId: string }>()
  const { firebaseUser } = useAuth()
  const navigate = useNavigate()

  const [exam, setExam] = useState<Exam | null>(null)
  const [courseTitle, setCourseTitle] = useState('')
  const [existingAttempt, setExistingAttempt] = useState<ExamAttempt | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { void load() }, [courseId, examId, firebaseUser?.uid])

  async function load() {
    if (!courseId || !examId || !firebaseUser?.uid) return
    setLoading(true)
    try {
      const [courseSnap, examSnap, attSnap] = await Promise.all([
        getDoc(doc(db, 'courses', courseId)),
        getDoc(doc(db, 'courses', courseId, 'exams', examId)),
        getDocs(query(collection(db, 'examAttempts'), where('studentId', '==', firebaseUser.uid), where('examId', '==', examId))),
      ])
      if (courseSnap.exists()) setCourseTitle((courseSnap.data().title as string) ?? '')
      if (examSnap.exists()) setExam({ id: examSnap.id, ...(examSnap.data() as Omit<Exam, 'id'>) })

      if (!attSnap.empty) {
        const d = attSnap.docs[0]!
        const att = { id: d.id, ...(d.data() as Omit<ExamAttempt, 'id'>) }
        setExistingAttempt(att)
        if (att.submittedAt) {
          navigate(`/exam/${courseId}/${examId}/results/${att.id}`, { replace: true })
          return
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }

  async function startExam() {
    if (!courseId || !examId || !firebaseUser?.uid || !exam) return
    if (existingAttempt && !existingAttempt.submittedAt) {
      navigate(`/exam/${courseId}/${examId}/run`, { state: { attemptId: existingAttempt.id } })
      return
    }
    setStarting(true); setError('')
    try {
      if (exam.questions.length === 0) { setError('This exam has no questions yet.'); setStarting(false); return }

      const sectionOrder = new Map(exam.sections.map((s, i) => [s.id, i]))
      const ordered = [...exam.questions].sort((a, b) => (sectionOrder.get(a.sectionId) ?? 0) - (sectionOrder.get(b.sectionId) ?? 0))
      const questionOrder = ordered.map((q) => q.id)
      const optionOrder: Record<string, string[]> = {}
      for (const q of ordered) if (q.options) optionOrder[q.id] = shuffleArray(q.options)

      const marksBySection = new Map(exam.sections.map((s) => [s.id, s.marksPerQuestion]))
      const totalMarks = ordered.reduce((sum, q) => sum + (marksBySection.get(q.sectionId) ?? 0), 0)

      const attemptData: Omit<ExamAttempt, 'id'> = {
        examId,
        courseId,
        studentId: firebaseUser.uid,
        startedAt: new Date().toISOString(),
        submittedAt: null,
        timeSpentSeconds: 0,
        questionOrder,
        optionOrder,
        answers: {},
        score: 0,
        totalMarks,
      }

      const ref = await addDoc(collection(db, 'examAttempts'), { ...attemptData, createdAt: serverTimestamp() })

      setStarting(false)
      navigate(`/exam/${courseId}/${examId}/run`, { state: { attemptId: ref.id } })
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to start exam'); setStarting(false) }
  }

  if (loading) return <div style={{ padding: '2rem' }}><p className="muted">Loading…</p></div>

  if (!exam) return (
    <div style={{ padding: '2rem' }}>
      <p className="error">Exam not found.</p>
    </div>
  )

  if (!exam.isActive) return (
    <div style={{ padding: '2rem' }}>
      <p className="notice">This exam is not active yet. Check back later.</p>
    </div>
  )

  const totalQuestions = exam.questions.length
  const marksBySection = new Map(exam.sections.map((s) => [s.id, s.marksPerQuestion]))
  const totalMarks = exam.questions.reduce((sum, q) => sum + (marksBySection.get(q.sectionId) ?? 0), 0)
  const isResume = !!existingAttempt && !existingAttempt.submittedAt

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ marginBottom: '0.3rem' }}>{courseTitle}</h1>
      <h2 style={{ marginBottom: '1.5rem', fontWeight: 400, color: 'var(--muted)' }}>{exam.title}</h2>

      <div className="panel" style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ marginBottom: '0.75rem' }}>Exam Details</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {[
            ['⏱ Duration', `${exam.durationMinutes} minutes`],
            ['📋 Questions', `${totalQuestions} questions`],
            ['🏆 Total Marks', `${totalMarks} marks`],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
              <span className="muted">{label}</span>
              <span style={{ fontWeight: 600 }}>{value}</span>
            </div>
          ))}
        </div>
        {exam.sections.length > 0 && (
          <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {exam.sections.map((s) => {
              const n = exam.questions.filter((q) => q.sectionId === s.id).length
              return <span key={s.id} className="muted small">{s.label}: {n} × {s.marksPerQuestion} mark{s.marksPerQuestion !== 1 ? 's' : ''}</span>
            })}
          </div>
        )}
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
