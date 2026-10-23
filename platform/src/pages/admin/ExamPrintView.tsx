import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { Exam } from '../../types'

export default function ExamPrintView() {
  const { courseId, examId } = useParams<{ courseId: string; examId: string }>()
  const [exam, setExam] = useState<Exam | null>(null)
  const [courseTitle, setCourseTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      if (!courseId || !examId) return
      try {
        const [examSnap, courseSnap] = await Promise.all([
          getDoc(doc(db, 'courses', courseId, 'exams', examId)),
          getDoc(doc(db, 'courses', courseId)),
        ])
        if (!examSnap.exists()) { setError('Exam not found.'); return }
        setExam({ id: examSnap.id, ...(examSnap.data() as Omit<Exam, 'id'>) })
        if (courseSnap.exists()) setCourseTitle((courseSnap.data().title as string) ?? '')
      } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
      finally { setLoading(false) }
    })()
  }, [courseId, examId])

  if (loading) return <p style={{ padding: '2rem' }}>Loading…</p>
  if (error || !exam) return <p style={{ padding: '2rem', color: '#991b1b' }}>{error || 'Not found.'}</p>

  const sumMarks = exam.sections.reduce((s, sec) => s + sec.questionCount * sec.marksPerQuestion, 0)
  let qNum = 0

  return (
    <div className="exam-print-page">
      <style>{`
        .exam-print-page { max-width: 760px; margin: 0 auto; padding: 2rem; font-family: Georgia, 'Times New Roman', serif; color: #111; }
        .exam-print-page h1 { font-size: 1.4rem; margin: 0 0 0.25rem; text-align: center; }
        .exam-print-page .sub { text-align: center; color: #555; margin: 0 0 1.5rem; font-size: 0.95rem; }
        .exam-print-page .meta { display: flex; justify-content: space-between; border-top: 1px solid #333; border-bottom: 1px solid #333; padding: 0.5rem 0; margin-bottom: 1.5rem; font-size: 0.9rem; }
        .exam-print-page .section-head { font-weight: 700; margin: 1.5rem 0 0.75rem; font-size: 1.05rem; border-bottom: 1px solid #999; padding-bottom: 0.25rem; }
        .exam-print-page .q { margin-bottom: 1.4rem; display: flex; gap: 0.6rem; }
        .exam-print-page .q .num { font-weight: 700; flex-shrink: 0; }
        .exam-print-page .q .body { flex: 1; }
        .exam-print-page .q .marks { flex-shrink: 0; color: #555; font-size: 0.85rem; white-space: nowrap; }
        .exam-print-page .answer-space { border-bottom: 1px dashed #bbb; height: 2rem; margin-top: 0.5rem; }
        .exam-print-page .print-btn { margin-bottom: 1.5rem; }
        @media print {
          .print-btn { display: none; }
          .exam-print-page { padding: 0; }
          .sidebar, .launcher-fab { display: none !important; }
          .main { margin: 0 !important; }
        }
      `}</style>

      <button type="button" className="btn primary print-btn" onClick={() => window.print()}>🖨 Print / Save as PDF</button>

      <h1>{exam.title}</h1>
      <p className="sub">{courseTitle}</p>
      <div className="meta">
        <span>Total Questions: {exam.sections.reduce((s, sec) => s + sec.questionCount, 0)}</span>
        <span>Total Marks: {sumMarks}</span>
        <span>Date: _______________</span>
      </div>

      {exam.sections.map((section) => {
        const sectionQs = exam.questions.filter((q) => q.sectionId === section.id)
        return (
          <div key={section.id}>
            <div className="section-head">{section.label} ({sectionQs.length} × {section.marksPerQuestion} mark{section.marksPerQuestion !== 1 ? 's' : ''} = {sectionQs.length * section.marksPerQuestion})</div>
            {sectionQs.map((q) => {
              qNum++
              return (
                <div className="q" key={q.id}>
                  <span className="num">{qNum}.</span>
                  <div className="body">
                    <div>{q.text}</div>
                    <div className="answer-space" />
                  </div>
                  <span className="marks">[{section.marksPerQuestion}]</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
