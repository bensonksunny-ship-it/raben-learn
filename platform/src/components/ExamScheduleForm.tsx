import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { formatFirebaseError } from '../lib/formatFirebaseError'
import {
  createExamSchedule, deleteExamSchedule, localDateStr, updateExamSchedule,
  type ExamScheduleDraft, type ExamScheduleEntry,
} from '../lib/examSchedule'
import type { Course, Exam } from '../types'

interface Props {
  courses: Course[]
  /** An existing booking to edit, or null to create one. */
  entry: ExamScheduleEntry | null
  /** Pre-fills a new booking (e.g. the date/time of the grid slot it came from). */
  prefill?: Partial<ExamScheduleDraft>
  onClose: () => void
  onSaved: () => void
}

/**
 * Book (or edit/cancel) one exam sitting for a subject — subject, optional
 * paper from that subject's Exam Manager, date, start time, duration, notes.
 */
export function ExamScheduleForm({ courses, entry, prefill, onClose, onSaved }: Props) {
  const { profile } = useAuth()
  const subjects = courses.filter((c) => c.title.trim()).sort((a, b) => a.title.localeCompare(b.title))
  const [draft, setDraft] = useState<ExamScheduleDraft>(() => entry
    ? { courseId: entry.courseId, courseTitle: entry.courseTitle, examId: entry.examId, examTitle: entry.examTitle, examType: entry.examType, date: entry.date, startTime: entry.startTime, durationMinutes: entry.durationMinutes, notes: entry.notes }
    : {
      courseId: '', courseTitle: '', examId: null, examTitle: '', examType: null,
      date: localDateStr(), startTime: '10:00', durationMinutes: 60, notes: '',
      ...prefill,
    })
  const [papers, setPapers] = useState<Exam[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!draft.courseId) return
    let cancelled = false
    void getDocs(collection(db, 'courses', draft.courseId, 'exams'))
      .then((snap) => {
        if (cancelled) return
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Exam, 'id'>) }))
        // Whole-subject Main Exams first, then topic exams.
        list.sort((a, b) => Number(!!a.topicId) - Number(!!b.topicId) || a.title.localeCompare(b.title))
        setPapers(list)
      })
      .catch(() => { if (!cancelled) setPapers([]) })
    return () => { cancelled = true }
  }, [draft.courseId])

  const set = (patch: Partial<ExamScheduleDraft>) => setDraft((d) => ({ ...d, ...patch }))

  function pickSubject(courseId: string) {
    const c = subjects.find((x) => x.id === courseId)
    setPapers(null)
    set({ courseId, courseTitle: c?.title ?? '', examId: null, examTitle: '', examType: null })
  }

  function pickPaper(examId: string) {
    const p = papers?.find((x) => x.id === examId)
    if (!p) { set({ examId: null, examTitle: '', examType: null }); return }
    const title = p.topicTitle ? `${p.title} · ${p.topicTitle}` : p.title
    set({
      examId: p.id, examTitle: title, examType: p.type,
      ...(p.type === 'mcq' && p.durationMinutes > 0 ? { durationMinutes: p.durationMinutes } : {}),
    })
  }

  async function save() {
    if (!draft.courseId) { setError('Pick a subject.'); return }
    if (!draft.date || !/^\d{2}:\d{2}$/.test(draft.startTime)) { setError('Pick a date and start time.'); return }
    if (!(draft.durationMinutes >= 5)) { setError('Duration must be at least 5 minutes.'); return }
    setBusy(true); setError('')
    try {
      const clean = { ...draft, notes: draft.notes.trim(), examTitle: draft.examTitle || 'Exam' }
      if (entry) await updateExamSchedule(entry.id, clean)
      else await createExamSchedule(clean, { uid: profile?.id ?? '', name: profile?.name ?? '' })
      onSaved()
    } catch (e) {
      setError(formatFirebaseError(e, 'Could not save the exam'))
    } finally {
      setBusy(false)
    }
  }

  async function cancelExam() {
    if (!entry || !window.confirm(`Cancel the ${entry.courseTitle} exam on ${entry.date}? It will be removed from every timetable.`)) return
    setBusy(true); setError('')
    try {
      await deleteExamSchedule(entry.id)
      onSaved()
    } catch (e) {
      setError(formatFirebaseError(e, 'Could not cancel the exam'))
      setBusy(false)
    }
  }

  const selectedPaper = papers?.find((p) => p.id === draft.examId) ?? null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>📝 {entry ? 'Edit exam' : 'Schedule an exam'}</h3>
          <button type="button" className="btn small ghost" onClick={onClose}>✕</button>
        </div>
        <div className="form" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label>Subject
            <select value={draft.courseId} onChange={(e) => pickSubject(e.target.value)}>
              <option value="">Select a subject…</option>
              {subjects.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          {draft.courseId && (
            <label>Exam paper <span className="muted small">(optional — can be added later)</span>
              <select value={draft.examId ?? ''} onChange={(e) => pickPaper(e.target.value)} disabled={papers === null}>
                <option value="">{papers === null ? 'Loading…' : papers.length === 0 ? 'No papers yet for this subject' : 'Not decided yet'}</option>
                {papers?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}{p.topicTitle ? ` · ${p.topicTitle}` : ' (Main)'} — {p.type === 'mcq' ? 'Online MCQ' : 'Written'}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selectedPaper?.type === 'mcq' && (
            <p className="muted small" style={{ margin: 0 }}>
              Online paper — students can start it only during this slot. It opens automatically; no need to switch it on in the Exam Manager.
            </p>
          )}
          {selectedPaper?.type === 'written' && (
            <p className="muted small" style={{ margin: 0 }}>Written paper — print it from the Exam Manager for the day.</p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
            <label>Date<input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} /></label>
            <label>Start time<input type="time" value={draft.startTime} onChange={(e) => set({ startTime: e.target.value })} /></label>
            <label>Duration (min)
              <input type="number" min={5} max={480} step={5} value={draft.durationMinutes} onChange={(e) => set({ durationMinutes: Number(e.target.value) })} />
            </label>
          </div>
          <label>Notes <span className="muted small">(optional — room, materials…)</span>
            <input value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. Room 2 · bring a calculator" />
          </label>
          {error ? <p className="error small" style={{ margin: 0 }}>{error}</p> : null}
          <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : entry ? 'Save changes' : 'Schedule exam'}</button>
            <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Close</button>
            {entry && (
              <button type="button" className="btn secondary" style={{ color: 'var(--danger)', marginLeft: 'auto' }} disabled={busy} onClick={() => void cancelExam()}>
                Cancel exam
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
