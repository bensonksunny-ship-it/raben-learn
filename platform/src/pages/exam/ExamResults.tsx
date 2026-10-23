import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { Exam, ExamAttempt } from '../../types'

export default function ExamResults() {
  const { courseId, examId, attemptId } = useParams<{ courseId: string; examId: string; attemptId: string }>()
  const [exam, setExam] = useState<Exam | null>(null)
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      if (!courseId || !examId || !attemptId) return
      try {
        const [examSnap, attSnap] = await Promise.all([
          getDoc(doc(db, 'courses', courseId, 'exams', examId)),
          getDoc(doc(db, 'examAttempts', attemptId)),
        ])
        if (!examSnap.exists() || !attSnap.exists()) { setError('Results not found.'); return }
        setExam({ id: examSnap.id, ...(examSnap.data() as Omit<Exam, 'id'>) })
        setAttempt({ id: attSnap.id, ...(attSnap.data() as Omit<ExamAttempt, 'id'>) })
      } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
      finally { setLoading(false) }
    })()
  }, [courseId, examId, attemptId])

  if (loading) return <div style={{ padding: '2rem' }}><p className="muted">Loading results…</p></div>
  if (error || !exam || !attempt) return <div style={{ padding: '2rem' }}><p className="error">{error || 'Not found.'}</p></div>

  const pct = attempt.totalMarks === 0 ? 0 : Math.round((attempt.score / attempt.totalMarks) * 100)
  const byId = new Map(exam.questions.map((q) => [q.id, q]))

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1rem' }}>
      <Link to="/exam" className="muted small" style={{ display: 'inline-block', marginBottom: '1rem' }}>← Back to Exams</Link>
      <h1 style={{ marginBottom: '0.3rem' }}>{exam.title}</h1>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>Results</p>

      <div className="panel" style={{ marginBottom: '1.5rem', textAlign: 'center', padding: '1.5rem' }}>
        <div style={{ fontSize: '2.2rem', fontWeight: 800, color: pct >= 50 ? '#059669' : '#dc2626' }}>{attempt.score} / {attempt.totalMarks}</div>
        <div className="muted" style={{ marginTop: '0.25rem' }}>{pct}%</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {attempt.questionOrder.map((qid, qi) => {
          const q = byId.get(qid)
          if (!q) return null
          const studentAns = attempt.answers[qid]
          const correct = studentAns === q.correctAnswer
          return (
            <div key={qid} style={{ padding: '0.75rem', background: 'var(--surface-soft)', borderRadius: 8, border: `1px solid ${correct ? '#bbf7d0' : '#fecaca'}` }}>
              <div style={{ fontWeight: 600, marginBottom: '0.3rem', fontSize: '0.9rem' }}>{correct ? '✅' : '❌'} Q{qi + 1}: {q.text}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                Your answer: <span style={{ color: correct ? '#059669' : '#dc2626', fontWeight: 600 }}>{studentAns ?? '(not answered)'}</span>
                {!correct && <> · Correct: <span style={{ color: '#059669', fontWeight: 600 }}>{q.correctAnswer}</span></>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
