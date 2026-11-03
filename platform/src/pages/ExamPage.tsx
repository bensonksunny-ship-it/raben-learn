import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { examAvailability, examEnd, examStart, formatExamWhen, loadExamSchedules, type ExamAvailability, type ExamScheduleEntry } from '../lib/examSchedule'
import type { Exam, ExamAttempt } from '../types'

interface Row {
  courseId: string
  courseTitle: string
  exam: Exam
  attempt: ExamAttempt | null
  availability: ExamAvailability
}

/**
 * A student's exams: the upcoming timetable of booked exams for their
 * subjects (online and written), then the online papers they can take now or
 * have already taken. A scheduled online paper opens only during its slot.
 */
export default function ExamPage() {
  const { profile, firebaseUser } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [upcoming, setUpcoming] = useState<ExamScheduleEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void load()
  }, [profile?.courseIds, firebaseUser?.uid])

  async function load() {
    const courseIds = profile?.courseIds ?? []
    if (!firebaseUser?.uid || courseIds.length === 0) { setLoading(false); return }
    setLoading(true)
    try {
      const [attemptsSnap, allSchedules] = await Promise.all([
        getDocs(query(collection(db, 'examAttempts'), where('studentId', '==', firebaseUser.uid))),
        loadExamSchedules().catch(() => [] as ExamScheduleEntry[]),
      ])
      const attemptsByExam = new Map<string, ExamAttempt>()
      attemptsSnap.forEach((d) => {
        const a = { id: d.id, ...(d.data() as Omit<ExamAttempt, 'id'>) }
        attemptsByExam.set(a.examId, a)
      })
      const schedules = allSchedules.filter((s) => courseIds.includes(s.courseId))
      const now = new Date()
      setUpcoming(schedules.filter((s) => examEnd(s) >= now))

      const out: Row[] = []
      for (const courseId of courseIds) {
        const [courseSnap, examsSnap] = await Promise.all([
          getDoc(doc(db, 'courses', courseId)),
          getDocs(query(collection(db, 'courses', courseId, 'exams'), where('type', '==', 'mcq'))),
        ])
        const courseTitle = courseSnap.exists() ? ((courseSnap.data().title as string) ?? courseId) : courseId
        examsSnap.forEach((d) => {
          const exam = { id: d.id, ...(d.data() as Omit<Exam, 'id'>) }
          const attempt = attemptsByExam.get(exam.id) ?? null
          const availability = examAvailability(exam, schedules, now)
          // Listed here once it's open, or once the student has an attempt
          // (in progress or finished). Upcoming ones are in the list above.
          if (availability.state === 'open' || attempt) out.push({ courseId, courseTitle, exam, attempt, availability })
        })
      }
      setRows(out)
    } finally { setLoading(false) }
  }

  if (loading) return <div style={{ padding: '2rem' }}><p className="muted">Loading exams…</p></div>

  const attemptedIds = new Set(rows.filter((r) => r.attempt?.submittedAt).map((r) => r.exam.id))

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ marginBottom: '0.3rem' }}>Exams</h1>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>Your exam timetable and online exams.</p>

      <h2 style={{ fontSize: '1.05rem', marginBottom: '0.6rem' }}>📅 Upcoming exams</h2>
      {upcoming.length === 0 ? (
        <div className="panel" style={{ marginBottom: '1.75rem' }}><p className="muted" style={{ margin: 0 }}>No exams scheduled.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.75rem' }}>
          {upcoming.map((s) => {
            const live = examStart(s) <= new Date()
            const canStart = live && s.examType === 'mcq' && s.examId && !attemptedIds.has(s.examId)
            return (
              <div key={s.id} className="panel" style={{ margin: 0, padding: '0.9rem 1rem', borderLeft: '5px solid #c2255c' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{s.courseTitle} — {s.examTitle || 'Exam'}</div>
                    <div className="muted small">{formatExamWhen(s)}{s.notes ? ` · ${s.notes}` : ''}</div>
                    <div className="muted small">{s.examType === 'mcq' ? 'Online exam in the app' : s.examType === 'written' ? 'Written exam in class' : 'Exam in class'}</div>
                  </div>
                  {canStart ? (
                    <Link to={`/exam/${s.courseId}/${s.examId}/instructions`} className="btn primary small">Start →</Link>
                  ) : live ? (
                    <span className="tag danger">Now</span>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <h2 style={{ fontSize: '1.05rem', marginBottom: '0.6rem' }}>💻 Online exams</h2>
      {rows.length === 0 ? (
        <div className="panel"><p className="muted" style={{ margin: 0 }}>No online exams open right now.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {rows.map(({ courseId, courseTitle, exam, attempt, availability }) => {
            const done = !!attempt?.submittedAt
            const inProgress = !!attempt && !attempt.submittedAt
            const to = done
              ? `/exam/${courseId}/${exam.id}/results/${attempt!.id}`
              : `/exam/${courseId}/${exam.id}/instructions`
            const closesAt = availability.state === 'open' && availability.until
              ? ` · closes ${availability.until.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
              : ''
            return (
              <Link key={exam.id} to={to} className="panel" style={{ display: 'block', padding: '1rem', textDecoration: 'none', color: 'inherit' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{exam.title}</div>
                    <div className="muted small">{courseTitle} · {exam.durationMinutes} min · {exam.totalMarks || exam.sections.reduce((s, sec) => s + sec.questionCount * sec.marksPerQuestion, 0)} marks{done ? '' : closesAt}</div>
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
