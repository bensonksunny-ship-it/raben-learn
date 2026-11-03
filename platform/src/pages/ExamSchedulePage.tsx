import { useCallback, useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'
import { mapCourseDoc } from '../lib/courses'
import { formatFirebaseError } from '../lib/formatFirebaseError'
import { examEnd, examStart, formatExamWhen, loadExamSchedules, type ExamScheduleEntry } from '../lib/examSchedule'
import { ExamScheduleForm } from '../components/ExamScheduleForm'
import { EmptyState } from '../components/EmptyState'
import type { Course } from '../types'

/**
 * Exam Schedule — every subject's exam sittings in one list, for admins,
 * managers, teachers (mentors) and academic consultants. Bookings made here
 * show on the timetable, the students' Exams page and the Live Class kiosk.
 */
export function ExamSchedulePage() {
  const [entries, setEntries] = useState<ExamScheduleEntry[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [editing, setEditing] = useState<ExamScheduleEntry | 'new' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, coursesSnap] = await Promise.all([loadExamSchedules(), getDocs(collection(db, 'courses'))])
      setEntries(list)
      setCourses(coursesSnap.docs.map(mapCourseDoc))
      setError('')
    } catch (e) {
      setError(formatFirebaseError(e, 'Could not load exams'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const now = new Date()
  const upcoming = entries.filter((e) => examEnd(e) >= now)
  const past = entries.filter((e) => examEnd(e) < now).reverse()
  const shown = (view === 'upcoming' ? upcoming : past).filter((e) => !subjectFilter || e.courseId === subjectFilter)
  const subjectsInUse = [...new Map(entries.map((e) => [e.courseId, e.courseTitle])).entries()].sort((a, b) => a[1].localeCompare(b[1]))

  // Group by date for a calendar-like read.
  const byDate = new Map<string, ExamScheduleEntry[]>()
  for (const e of shown) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e])

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Exam Schedule</h1>
          <p className="muted" style={{ margin: 0 }}>Book exams for each subject — they appear on the timetable and the students' Exams page.</p>
        </div>
        <button type="button" className="btn primary" onClick={() => setEditing('new')}>+ Schedule exam</button>
      </div>

      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
        <button type="button" className={`btn small ${view === 'upcoming' ? 'primary' : 'secondary'}`} onClick={() => setView('upcoming')}>Upcoming ({upcoming.length})</button>
        <button type="button" className={`btn small ${view === 'past' ? 'primary' : 'secondary'}`} onClick={() => setView('past')}>Past ({past.length})</button>
        {subjectsInUse.length > 0 && (
          <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} style={{ width: 'auto', marginLeft: 'auto' }}>
            <option value="">All subjects</option>
            {subjectsInUse.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
          </select>
        )}
      </div>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : shown.length === 0 ? (
        <EmptyState
          title={view === 'upcoming' ? 'No upcoming exams' : 'No past exams'}
          subtitle={view === 'upcoming' ? 'Use “+ Schedule exam” to book one for a subject.' : undefined}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {[...byDate.entries()].map(([date, list]) => (
            <section key={date}>
              <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem' }}>
                {examStart(list[0]!).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {list.map((e) => {
                  const live = examStart(e) <= now && now < examEnd(e)
                  return (
                    <button
                      key={e.id}
                      type="button"
                      className="panel"
                      onClick={() => setEditing(e)}
                      style={{
                        margin: 0, textAlign: 'left', cursor: 'pointer', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap',
                        borderLeft: '5px solid #c2255c', width: '100%', font: 'inherit', color: 'inherit',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <div style={{ fontWeight: 700 }}>📝 {e.courseTitle} — {e.examTitle || 'Exam'}</div>
                        <div className="muted small">{formatExamWhen(e)}{e.notes ? ` · ${e.notes}` : ''}</div>
                        <div className="muted small">Scheduled by {e.createdByName || '—'}</div>
                      </div>
                      <div className="row" style={{ gap: '0.4rem' }}>
                        {live && <span className="tag danger">In progress</span>}
                        <span className="tag">{e.examType === 'mcq' ? 'Online MCQ' : e.examType === 'written' ? 'Written' : 'Paper not set'}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <ExamScheduleForm
          courses={courses}
          entry={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
        />
      )}
    </div>
  )
}
