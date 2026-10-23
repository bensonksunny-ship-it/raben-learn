import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { calculateScore, formatTime } from '../../lib/examUtils'
import type { Exam, ExamAttempt, ExamQuestionItem } from '../../types'

export default function ExamRunner() {
  const { courseId, examId } = useParams<{ courseId: string; examId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { firebaseUser } = useAuth()

  const [exam, setExam] = useState<Exam | null>(null)
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [currentIdx, setCurrentIdx] = useState(0)
  const [timeLeft, setTimeLeft] = useState(0)
  const [direction, setDirection] = useState(1)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const startedAtRef = useRef<number>(Date.now())
  const attemptIdRef = useRef<string | null>(null)
  const autoSubmitFired = useRef(false)

  useEffect(() => {
    void load()
  }, [courseId, examId, firebaseUser?.uid])

  async function load() {
    if (!courseId || !examId || !firebaseUser?.uid) return
    setLoading(true)
    try {
      const stateAttemptId = (location.state as { attemptId?: string } | null)?.attemptId

      let attemptDoc: { id: string; data: () => Record<string, unknown> } | null = null

      if (stateAttemptId) {
        const d = await getDoc(doc(db, 'examAttempts', stateAttemptId))
        if (d.exists()) attemptDoc = { id: d.id, data: () => d.data() as Record<string, unknown> }
      } else {
        const snap = await getDocs(
          query(collection(db, 'examAttempts'),
            where('studentId', '==', firebaseUser.uid),
            where('examId', '==', examId))
        )
        if (!snap.empty) { const d = snap.docs[0]!; attemptDoc = { id: d.id, data: () => d.data() as Record<string, unknown> } }
      }

      if (!attemptDoc) {
        setError('No exam attempt found. Please go back and start the exam.')
        setLoading(false)
        return
      }

      const att = { id: attemptDoc.id, ...(attemptDoc.data() as Omit<ExamAttempt, 'id'>) }

      if (att.submittedAt) {
        navigate(`/exam/${courseId}/${examId}/results/${att.id}`, { replace: true })
        return
      }

      const examSnap = await getDoc(doc(db, 'courses', courseId, 'exams', examId))
      if (!examSnap.exists()) { setError('Exam not found.'); setLoading(false); return }
      const examData = { id: examSnap.id, ...(examSnap.data() as Omit<Exam, 'id'>) }

      attemptIdRef.current = att.id
      setAttempt(att)
      setExam(examData)
      setAnswers(att.answers)

      const elapsedSecs = Math.floor((Date.now() - new Date(att.startedAt).getTime()) / 1000)
      const totalSecs = examData.durationMinutes * 60
      const remaining = Math.max(0, totalSecs - elapsedSecs)
      setTimeLeft(remaining)
      startedAtRef.current = new Date(att.startedAt).getTime()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (!attempt || timeLeft <= 0) return
    const id = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { clearInterval(id); void autoSubmit(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [attempt?.id, timeLeft <= 0])

  async function autoSubmit() {
    if (autoSubmitFired.current) return
    autoSubmitFired.current = true
    await submit(true)
  }

  const questions: ExamQuestionItem[] = exam && attempt
    ? attempt.questionOrder.map((qid) => exam.questions.find((q) => q.id === qid)).filter((q): q is ExamQuestionItem => !!q)
    : []

  const goTo = useCallback((idx: number) => {
    setDirection(idx > currentIdx ? 1 : -1)
    setCurrentIdx(idx)
    setPaletteOpen(false)
  }, [currentIdx])

  const goNext = useCallback(() => {
    if (currentIdx < questions.length - 1) goTo(currentIdx + 1)
  }, [questions.length, currentIdx, goTo])

  const goPrev = useCallback(() => {
    if (currentIdx > 0) goTo(currentIdx - 1)
  }, [currentIdx, goTo])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (['1', '2', '3', '4'].includes(e.key)) {
        const q = questions[currentIdx]
        if (!q || !attempt) return
        const opt = attempt.optionOrder[q.id]?.[Number(e.key) - 1]
        if (opt) void selectAnswer(q.id, opt)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [attempt, questions, currentIdx, goNext, goPrev])

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

  async function submit(auto = false) {
    if (!attempt || !exam || !attemptIdRef.current || submitting) return
    if (!auto) {
      if (!window.confirm('Are you sure you want to submit? You cannot change answers after submitting.')) return
    }
    setSubmitting(true)
    try {
      const timeSpentSeconds = Math.floor((Date.now() - startedAtRef.current) / 1000)
      const marksBySection = Object.fromEntries(exam.sections.map((s) => [s.id, s.marksPerQuestion]))
      const score = calculateScore(exam.questions, marksBySection, attempt.questionOrder, answers)

      await updateDoc(doc(db, 'examAttempts', attemptIdRef.current), {
        submittedAt: new Date().toISOString(),
        score,
        timeSpentSeconds,
        answers,
      })

      navigate(`/exam/${courseId}/${examId}/results/${attemptIdRef.current}`, { replace: true })
    } catch (e) { setError(e instanceof Error ? e.message : 'Submit failed'); setSubmitting(false) }
  }

  if (loading) return <div style={{ padding: '2rem' }}><p className="muted">Loading exam…</p></div>
  if (error) return <div style={{ padding: '2rem' }}><p className="error">{error}</p></div>
  if (!attempt || !exam || questions.length === 0) return null

  const q = questions[currentIdx]!
  const shuffledOptions = attempt.optionOrder[q.id] ?? q.options ?? []
  const totalQ = questions.length
  const timerRed = timeLeft <= 300
  const answeredCount = Object.keys(answers).length

  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0 }),
  }

  function paletteStatus(idx: number) {
    const qid = questions[idx]!.id
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
        {questions.map((_, idx) => {
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
        <button
          type="button"
          className="btn small ghost exam-palette-mobile-btn"
          onClick={() => setPaletteOpen((v) => !v)}
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
                {q.text}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {shuffledOptions.map((opt, i) => {
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
        <div className="exam-palette-desktop" style={{ width: 200, borderLeft: '1px solid var(--border)', padding: '1rem', overflowY: 'auto', flexShrink: 0 }}>
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
