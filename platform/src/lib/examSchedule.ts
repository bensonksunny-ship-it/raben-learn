import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import type { Exam, ExamType } from '../types'

/**
 * A dated exam booking for one subject (`exam_schedules/{id}`) — the single
 * source of truth for "when is the exam". Admins, managers, teachers (mentors)
 * and academic consultants create them from the Exam Schedule page or the
 * Schedule grid's "Exam" slot option. They show on every timetable view, on the
 * students' Exams page, and on the Live Class kiosk; an online (MCQ) paper
 * opens to students only inside its scheduled window.
 */
export interface ExamScheduleEntry {
  id: string
  courseId: string
  courseTitle: string
  /** The paper from the subject's Exam Manager — null until one is picked. */
  examId: string | null
  examTitle: string
  examType: ExamType | null
  /** "YYYY-MM-DD" (local calendar date) */
  date: string
  /** "HH:MM" */
  startTime: string
  durationMinutes: number
  notes: string
  createdBy: string
  createdByName: string
}

export type ExamScheduleDraft = Omit<ExamScheduleEntry, 'id' | 'createdBy' | 'createdByName'>

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function mapExamSchedule(id: string, d: Record<string, unknown>): ExamScheduleEntry {
  const t = str(d.examType)
  return {
    id,
    courseId: str(d.courseId),
    courseTitle: str(d.courseTitle),
    examId: typeof d.examId === 'string' && d.examId ? d.examId : null,
    examTitle: str(d.examTitle),
    examType: t === 'mcq' || t === 'written' ? t : null,
    date: str(d.date),
    startTime: str(d.startTime),
    durationMinutes: Number(d.durationMinutes ?? 0) || 60,
    notes: str(d.notes),
    createdBy: str(d.createdBy),
    createdByName: str(d.createdByName),
  }
}

/** Every scheduled exam, soonest first. The collection stays small (one doc per
 *  sitting), so callers filter client-side by course/date. */
export async function loadExamSchedules(): Promise<ExamScheduleEntry[]> {
  const snap = await getDocs(collection(db, 'exam_schedules'))
  return snap.docs
    .map((d) => mapExamSchedule(d.id, d.data()))
    .filter((e) => e.courseId && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && /^\d{2}:\d{2}$/.test(e.startTime))
    .sort((a, b) => examStart(a).getTime() - examStart(b).getTime())
}

export async function createExamSchedule(draft: ExamScheduleDraft, by: { uid: string; name: string }): Promise<string> {
  const ref = await addDoc(collection(db, 'exam_schedules'), {
    ...draft, createdBy: by.uid, createdByName: by.name, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateExamSchedule(id: string, draft: ExamScheduleDraft): Promise<void> {
  await updateDoc(doc(db, 'exam_schedules', id), { ...draft, updatedAt: serverTimestamp() })
}

export async function deleteExamSchedule(id: string): Promise<void> {
  await deleteDoc(doc(db, 'exam_schedules', id))
}

export function examStart(e: Pick<ExamScheduleEntry, 'date' | 'startTime'>): Date {
  return new Date(`${e.date}T${e.startTime}:00`)
}

export function examEnd(e: Pick<ExamScheduleEntry, 'date' | 'startTime' | 'durationMinutes'>): Date {
  return new Date(examStart(e).getTime() + e.durationMinutes * 60_000)
}

/** Local "YYYY-MM-DD" for a Date (not UTC — an exam's date is a wall-calendar date). */
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatExamWhen(e: Pick<ExamScheduleEntry, 'date' | 'startTime' | 'durationMinutes'>): string {
  const s = examStart(e)
  const day = s.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  const t = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${day} · ${t(s)} – ${t(examEnd(e))}`
}

export type ExamAvailability =
  | { state: 'open'; until: Date | null }
  | { state: 'upcoming'; next: ExamScheduleEntry }
  | { state: 'closed' }
  | { state: 'unavailable' }

/**
 * Whether a student can start an online (MCQ) paper right now. A scheduled
 * paper opens automatically inside its window — no need to switch it on in the
 * Exam Manager. A paper with no schedule falls back to the Exam Manager's
 * manual "active" switch, as before; once every sitting has passed, that switch
 * can still reopen it (a make-up).
 */
export function examAvailability(exam: Pick<Exam, 'id' | 'isActive'>, schedules: ExamScheduleEntry[], now: Date = new Date()): ExamAvailability {
  const mine = schedules.filter((s) => s.examId === exam.id)
  if (mine.length === 0) return exam.isActive ? { state: 'open', until: null } : { state: 'unavailable' }
  const current = mine.find((s) => examStart(s) <= now && now < examEnd(s))
  if (current) return { state: 'open', until: examEnd(current) }
  const next = mine.filter((s) => examStart(s) > now).sort((a, b) => examStart(a).getTime() - examStart(b).getTime())[0]
  if (next) return { state: 'upcoming', next }
  return exam.isActive ? { state: 'open', until: null } : { state: 'closed' }
}
