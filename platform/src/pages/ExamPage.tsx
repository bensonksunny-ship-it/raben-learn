import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import type { Exam, ExamAttempt } from '../types'

interface Row {
  courseId: string
  courseTitle: string
  exam: Exam
  attempt: ExamAttempt | null
}

export default function ExamPage() {
  const { profile, firebaseUser } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void load()
  }, [profile?.courseIds, firebaseUser?.uid])

  async function load() {
    const courseIds = profile?.courseIds ?? []
    if (!firebaseUser?.uid || courseIds.length === 0) { setLoading(false); return }
    setLoading(true)
    try {
      const attemptsSnap = await getDocs(query(collection(db, 'examAttempts'), where('studentId', '==', firebaseUser.uid)))
      const attemptsByExam = new Map<string, ExamAttempt>()
      attemptsSnap.forEach((d) => {
        const a = { id: d.id, ...(d.data() as Omit<ExamAttempt, 'id'>) }
        attemptsByExam.set(a.examId, a)
      })

      const out: Row[] = []
      for (const courseId of courseIds) {
        const [courseSnap, examsSnap] = await Promise.all([
          getDoc(doc(db, 'courses', courseId)),
          getDocs(query(collection(db, 'courses', courseId, 'exams'), where('type', '==', 'mcq'), where('isActive', '==', true))),
        ])
        const courseTitle = courseSnap.exists() ? ((courseSnap.data().title as string) ?? courseId) : courseId
        examsSnap.forEach((d) => {
          const exam = { id: d.id, ...(d.data() as Omit<Exam, 'id'>) }
          out.push({ courseId, courseTitle, exam, attempt: attemptsByExam.get(exam.id) ?? null })
        })
      }
      setRows(out)
    } finally { setLoading(false) }
  }

  if (loading) return <div style={{ padding: '2rem' }}><p className="muted">Loading exams…</p></div>

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ marginBottom: '0.3rem' }}>Exams</h1>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>Your assigned exams will appear here.</p>

      {rows.length === 0 ? (
        <div className="panel"><p className="muted">No exams yet.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {rows.map(({ courseId, courseTitle, exam, attempt }) => {
            const done = !!attempt?.submittedAt
            const inProgress = !!attempt && !attempt.submittedAt
            const to = done
              ? `/exam/${courseId}/${exam.id}/results/${attempt!.id}`
              : `/exam/${courseId}/${exam.id}/instructions`
            return (
              <Link key={exam.id} to={to} className="panel" style={{ display: 'block', padding: '1rem', textDecoration: 'none', color: 'inherit' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{exam.title}</div>
                    <div className="muted small">{courseTitle} · {exam.durationMinutes} min · {exam.totalMarks || exam.sections.reduce((s, sec) => s + sec.questionCount * sec.marksPerQuestion, 0)} marks</div>
                  </div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: done ? '#059669' : inProgress ? '#b45309' : 'var(--primary)' }}>
                    {done ? 'View Results →' : inProgress ? 'Resume →' : 'Start →'}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
