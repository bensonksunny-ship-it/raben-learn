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
