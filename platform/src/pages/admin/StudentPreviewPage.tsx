import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { mapCourseDoc } from '../../lib/courses'
import { readTopicsFromSessionDoc } from '../../lib/topics'
import { normalizeRoles } from '../../lib/roles'
import { OwlMascot } from '../../components/manager/OwlMascot'
import { NavCard } from '../../components/manager/NavCard'
import {
  timeStrToMinutes,
  createDefaultTimetable, normalizeTimetable, createDefaultElectives, normalizeElectives,
} from '../../components/manager/schedulerShared'
import type { ClassTimetable, Course, ElectiveSchedule, ItemStatus, ProgressEntry, Session, TopicType, Weekday } from '../../types'

/**
 * A manager/admin-only, read-only view of a real student's dashboard and course
 * screen — pick any real student from the dropdown and this fetches their actual
 * enrolled courses, progress, today's plan, and the shared class schedule. This
 * never writes anything: the "Complete"/rating/notes controls below are rendered
 * for visual fidelity with the real student screens but are always disabled —
 * editing a real student's record from a preview tool would be exactly the kind
 * of surprising side effect this page must not have.
 */

type PreviewView = 'dashboard' | 'courses'

function isPreviewView(v: string | null): v is PreviewView {
  return v === 'dashboard' || v === 'courses'
}

interface StudentOption { id: string; name: string }

function itemTypeLabel(t: TopicType): string {
  return t === 'concept' ? 'Concept' : 'Exercise'
}
function itemTypeColors(t: TopicType): { bg: string; text: string } {
  return t === 'concept' ? { bg: '#ede9fe', text: '#5b21b6' } : { bg: '#dcfce7', text: '#166534' }
}
function statusLabel(s: ItemStatus) {
  if (s === 'completed') return 'Done'
  if (s === 'review') return 'Under review'
  if (s === 'in_progress') return 'In progress'
  return 'Not started'
}

/** 12-hour clock label for an "HH:MM" string, e.g. "14:30" → "2:30 PM". */
function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (h == null || m == null) return hhmm
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${display} ${period}` : `${display}:${String(m).padStart(2, '0')} ${period}`
}

const JS_DAY_TO_WEEKDAY: (Weekday | null)[] = [null, 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface NextClassInfo { title: string; startTime: string; mentorName: string | null; status: 'now' | 'next' }

/** Same shared-timetable logic as the real StudentDashboard — the class schedule
 *  is one shared doc for everyone, so it doesn't actually vary by which student
 *  is selected; fetched once, not re-fetched per student. */
function computeNextClass(timetable: ClassTimetable, electives: ElectiveSchedule): NextClassInfo | null {
  const now = new Date()
  const weekday = JS_DAY_TO_WEEKDAY[now.getDay()]
  if (!weekday) return null
  const nowMin = now.getHours() * 60 + now.getMinutes()

  const items = [
    ...(timetable.days[weekday]?.periods ?? []).map((p) => ({
      title: p.title, startTime: p.startTime, mentorName: null as string | null,
      startMin: timeStrToMinutes(p.startTime) ?? 0, durationMinutes: p.durationMinutes,
    })),
    ...(electives.days[weekday]?.sessions ?? []).map((s) => ({
      title: s.title, startTime: s.startTime, mentorName: s.mentorName ?? null,
      startMin: timeStrToMinutes(s.startTime) ?? 0, durationMinutes: s.durationMinutes,
    })),
  ].sort((a, b) => a.startMin - b.startMin)

  const inProgress = items.find((i) => i.startMin <= nowMin && nowMin < i.startMin + i.durationMinutes)
  if (inProgress) return { title: inProgress.title, startTime: inProgress.startTime, mentorName: inProgress.mentorName, status: 'now' }
  const upcoming = items.find((i) => i.startMin >= nowMin)
  if (upcoming) return { title: upcoming.title, startTime: upcoming.startTime, mentorName: upcoming.mentorName, status: 'next' }
  return null
}

export function StudentPreviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawView = searchParams.get('view')
  const view: PreviewView = isPreviewView(rawView) ? rawView : 'dashboard'
  const selectedStudentId = searchParams.get('student')

  const [students, setStudents] = useState<StudentOption[]>([])
  const [studentsLoading, setStudentsLoading] = useState(true)

  const [studentName, setStudentName] = useState('')
  const [courses, setCourses] = useState<Course[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [progressMap, setProgressMap] = useState<Record<string, Record<string, ProgressEntry>>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [nextClass, setNextClass] = useState<NextClassInfo | null>(null)
  const [loadingSchedule, setLoadingSchedule] = useState(true)

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function goTo(nextView: PreviewView) {
    const next = new URLSearchParams(searchParams)
    if (nextView === 'dashboard') next.delete('view'); else next.set('view', nextView)
    setSearchParams(next)
  }

  function selectStudent(uid: string) {
    const next = new URLSearchParams(searchParams)
    if (uid) next.set('student', uid); else next.delete('student')
    setSearchParams(next)
  }

  // Full student roster for the dropdown — loaded once.
  useEffect(() => {
    void (async () => {
      try {
        const snap = await getDocs(collection(db, 'users'))
        const list: StudentOption[] = []
        snap.forEach((d) => {
          const x = d.data()
          if (normalizeRoles(x).includes('student')) list.push({ id: d.id, name: (x.name as string) || (x.email as string) || d.id })
        })
        list.sort((a, b) => a.name.localeCompare(b.name))
        setStudents(list)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load students')
      } finally {
        setStudentsLoading(false)
      }
    })()
  }, [])

  // The shared class schedule — one doc for every student, fetched once.
  useEffect(() => {
    void (async () => {
      try {
        const [timetableSnap, electivesSnap] = await Promise.all([
          getDoc(doc(db, 'class_timetable', 'master')),
          getDoc(doc(db, 'elective_sessions', 'master')),
        ])
        const timetable = normalizeTimetable(timetableSnap.exists() ? timetableSnap.data() : undefined)
        const electives = normalizeElectives(electivesSnap.exists() ? electivesSnap.data() : undefined)
        setNextClass(computeNextClass(timetable, electives))
      } catch {
        setNextClass(computeNextClass(createDefaultTimetable(), createDefaultElectives()))
      } finally {
        setLoadingSchedule(false)
      }
    })()
  }, [])

  // Real per-student data: enrolled courses, every session (for progress + the
  // course-view module list), and this student's own progress entries. Mirrors
  // StudentDashboard/StudentCourseView's own loads, parameterized by the selected
  // uid instead of the signed-in manager's own.
  useEffect(() => {
    if (!selectedStudentId) { setCourses([]); setSessions([]); setProgressMap({}); return }
    setLoading(true); setError('')
    void (async () => {
      try {
        const [userSnap, coursesSnap, sessionsSnap, progSnap] = await Promise.all([
          getDoc(doc(db, 'users', selectedStudentId)),
          getDocs(collection(db, 'courses')),
          getDocs(collection(db, 'sessions')),
          getDocs(query(collection(db, 'student_lesson_progress'), where('studentId', '==', selectedStudentId))),
        ])

        const studentData = userSnap.exists() ? userSnap.data() : {}
        setStudentName((studentData.name as string) || 'Student')
        const courseIds = (studentData.courseIds as string[] | undefined) ?? []

        const courseList: Course[] = []
        coursesSnap.forEach((d) => { if (courseIds.length === 0 || courseIds.includes(d.id)) courseList.push(mapCourseDoc(d)) })
        courseList.sort((a, b) => a.title.localeCompare(b.title))
        setCourses(courseList)
        setSelectedCourseId((prev) => (prev && courseList.some((c) => c.id === prev) ? prev : courseList[0]?.id ?? null))

        const sess: Session[] = []
        sessionsSnap.forEach((d) => {
          const x = d.data()
          sess.push({
            id: d.id,
            title: (x.title as string) ?? '',
            courseId: (x.courseId as string) ?? null,
            courseName: (x.courseName as string) ?? '',
            order: Number(x.order ?? 0),
            activities: readTopicsFromSessionDoc(x.activities),
          })
        })
        sess.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title))
        setSessions(sess)

        const pm: Record<string, Record<string, ProgressEntry>> = {}
        progSnap.forEach((d) => {
          const x = d.data()
          const sid = (x.sessionId as string) ?? (x.lessonId as string)
          const entries = (x.entries as ProgressEntry[]) ?? []
          if (sid) {
            pm[sid] = {}
            entries.forEach((e) => { if (e.activityId) pm[sid]![e.activityId] = e })
          }
        })
        setProgressMap(pm)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load student data')
      } finally {
        setLoading(false)
      }
    })()
  }, [selectedStudentId])

  const coursesForStudent = courses
  const sessionsForSelectedCourse = sessions.filter((s) => s.courseId === selectedCourseId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  useEffect(() => {
    setSelectedSessionId((prev) => (prev && sessionsForSelectedCourse.some((s) => s.id === prev) ? prev : sessionsForSelectedCourse[0]?.id ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-syncs only when the course (and thus its session list) changes
  }, [selectedCourseId])

  const selectedSession = sessionsForSelectedCourse.find((s) => s.id === selectedSessionId) ?? null
  const selectedCourse = coursesForStudent.find((c) => c.id === selectedCourseId) ?? null
  const courseTotalItems = sessionsForSelectedCourse.reduce((n, s) => n + s.activities.length, 0)
  const courseCompletedItems = sessionsForSelectedCourse.reduce(
    (n, s) => n + s.activities.filter((a) => (progressMap[s.id]?.[a.id]?.status ?? 'locked') === 'completed').length,
    0,
  )

  const firstName = studentName.split(' ')[0] || 'Student'

  return (
    <div>
      <select
        value={selectedStudentId ?? ''}
        onChange={(e) => selectStudent(e.target.value)}
        disabled={studentsLoading}
        style={{ fontSize: '0.85rem', maxWidth: 260, marginBottom: '1.25rem' }}
      >
        <option value="">{studentsLoading ? 'Loading students…' : 'Select a student…'}</option>
        {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      {error ? <p className="error">{error}</p> : null}

      {!selectedStudentId ? (
        <div className="panel" style={{ textAlign: 'center', padding: '2.5rem' }}>
          <p style={{ fontSize: '2.5rem', margin: 0 }}>🎓</p>
          <h3>Pick a student to preview</h3>
          <p className="muted">Choose anyone from the dropdown above to see their real dashboard and courses.</p>
        </div>
      ) : loading ? (
        <p className="muted">Loading {firstName}'s data…</p>
      ) : (
        <>
          <div className="row" style={{ marginBottom: '1.25rem', gap: '0.5rem' }}>
            <button type="button" className={`btn small ${view === 'dashboard' ? 'primary' : 'secondary'}`} onClick={() => goTo('dashboard')}>🏠 Dashboard</button>
            <button type="button" className={`btn small ${view === 'courses' ? 'primary' : 'secondary'}`} onClick={() => goTo('courses')}>📖 Course View</button>
          </div>

          {view === 'dashboard' ? (
            <div>
              <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', borderRadius: 'calc(var(--radius) + 10px)' }}>
                <OwlMascot size={108} />
                <h1 style={{ margin: 0 }}>Welcome, {firstName}</h1>
              </div>

              <div className="panel" style={{ marginBottom: '1.75rem', borderRadius: 'calc(var(--radius) + 10px)' }}>
                <h2 style={{ margin: '0 0 0.6rem', fontSize: '1rem' }}>Today's Schedule</h2>
                {loadingSchedule ? (
                  <p className="muted small" style={{ margin: 0 }}>Loading…</p>
                ) : !nextClass ? (
                  <p className="muted small" style={{ margin: 0 }}>No more classes scheduled for today.</p>
                ) : (
                  <p style={{ margin: 0, fontSize: '0.98rem' }}>
                    {nextClass.status === 'now' ? 'Now' : 'Next'}: {nextClass.title} at {formatClock(nextClass.startTime)}
                  </p>
                )}
              </div>

              <div className="nav-card-grid student-action-grid" style={{ marginBottom: '1.75rem' }}>
                <NavCard title="Timetable" color="#8b5cf6" to={`/manager/student-preview?student=${selectedStudentId}`} minimal compact />
                <NavCard title="Syllabus" color="#3b82f6" to={`/manager/student-preview?student=${selectedStudentId}&view=courses`} minimal compact />
                <NavCard title="Notes" color="#059669" to={`/manager/student-preview?student=${selectedStudentId}`} minimal compact />
              </div>
            </div>
          ) : (
            <div className="student-syllabus">
              {coursesForStudent.length === 0 ? (
                <div className="panel" style={{ textAlign: 'center', padding: '2.5rem' }}>
                  <p style={{ fontSize: '2.5rem', margin: 0 }}>📖</p>
                  <h3>No subjects assigned</h3>
                  <p className="muted">{firstName} isn't enrolled in any course yet.</p>
                </div>
              ) : (
                <>
                  <div className="student-syllabus-top">
                    <div className="student-syllabus-hero">
                      <div>
                        <h1 className="student-syllabus-title">{studentName}</h1>
                        {courses.length > 1 ? (
                          <select value={selectedCourseId ?? ''} onChange={(e) => setSelectedCourseId(e.target.value)} style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>
                            {coursesForStudent.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                          </select>
                        ) : (
                          <p className="muted small" style={{ margin: '0.35rem 0 0' }}>
                            Course: <strong style={{ color: 'var(--text)' }}>{selectedCourse?.title}</strong>
                          </p>
                        )}
                      </div>
                      <div className="student-syllabus-progress-pill">
                        <span className="student-syllabus-progress-count">{courseCompletedItems}/{courseTotalItems || '—'}</span>
                        <span className="muted small">items completed</span>
                      </div>
                    </div>
                    {courseTotalItems > 0 ? (
                      <div className="student-syllabus-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={courseTotalItems} aria-valuenow={courseCompletedItems}>
                        <span className="student-syllabus-progress-bar-fill" style={{ width: `${Math.round((courseCompletedItems / courseTotalItems) * 100)}%` }} />
                      </div>
                    ) : null}
                  </div>

                  <div className="student-syllabus-grid">
                    <aside className="student-syllabus-modules">
                      <h2 className="student-syllabus-modules-heading">Modules</h2>
                      <ul className="student-syllabus-module-list">
                        {sessionsForSelectedCourse.map((s) => {
                          const done = s.activities.filter((a) => (progressMap[s.id]?.[a.id]?.status ?? 'locked') === 'completed').length
                          const active = selectedSessionId === s.id
                          return (
                            <li key={s.id}>
                              <button type="button" className={`student-syllabus-module-btn${active ? ' active' : ''}`} onClick={() => setSelectedSessionId(s.id)}>
                                <span className="student-syllabus-module-name">{s.order ? `${s.order}. ` : ''}{s.title}</span>
                                <span className="student-syllabus-module-meta">{done}/{s.activities.length} done</span>
                              </button>
                            </li>
                          )
                        })}
                        {sessionsForSelectedCourse.length === 0 ? <p className="muted small">No modules yet.</p> : null}
                      </ul>
                    </aside>

                    <section className="student-syllabus-detail">
                      {!selectedSession ? (
                        <p className="muted">Select a module.</p>
                      ) : (
                        <>
                          <div className="student-syllabus-module-header">
                            <div>
                              <h2 className="student-syllabus-module-title">{selectedSession.order ? `${selectedSession.order}. ` : ''}{selectedSession.title}</h2>
                              <span className="muted small">{selectedSession.activities.length} items</span>
                            </div>
                          </div>

                          <ul className="student-task-list">
                            {selectedSession.activities.map((a) => {
                              const entry = progressMap[selectedSession.id]?.[a.id]
                              const status: ItemStatus = entry?.status ?? 'locked'
                              const colors = itemTypeColors(a.type)
                              const isUnlocked = status !== 'locked'
                              const isDone = status === 'completed'
                              const isExpanded = expandedId === a.id
                              const rating = entry?.rating ?? 0
                              const notes = entry?.notes ?? ''

                              return (
                                <li key={a.id} className={['student-task', isExpanded ? 'expanded' : '', !isUnlocked ? 'locked' : '', isDone ? 'done' : ''].filter(Boolean).join(' ')}>
                                  <div className="student-task-row">
                                    <button
                                      type="button"
                                      className="student-task-trigger"
                                      onClick={() => setExpandedId((cur) => (cur === a.id ? null : a.id))}
                                      aria-expanded={isExpanded}
                                      aria-label={`${itemTypeLabel(a.type)}: ${a.title}. ${statusLabel(status)}. ${isExpanded ? 'Collapse' : 'Expand'} details.`}
                                    >
                                      <span className="student-task-badge" style={{ background: colors.bg, color: colors.text }}>{itemTypeLabel(a.type)}</span>
                                      <span className="student-task-titles">
                                        <span className="student-task-title">{a.title}</span>
                                        {a.remark ? <span className="student-task-remark muted small">{a.remark}</span> : null}
                                      </span>
                                      {!isUnlocked ? (
                                        <span className="student-task-status muted small">🔒 Locked</span>
                                      ) : (
                                        <span className="student-task-status muted small">{statusLabel(status)}</span>
                                      )}
                                      <span className="student-task-chevron" aria-hidden>{isExpanded ? '▾' : '▸'}</span>
                                    </button>
                                    <div className="student-task-actions">
                                      <button
                                        type="button"
                                        className={`btn small student-task-complete-btn${isDone ? ' student-task-complete-btn--done' : ' primary'}`}
                                        disabled
                                        title="Read-only preview — can't be changed from here"
                                      >
                                        {isDone ? 'Completed' : 'Complete'}
                                      </button>
                                    </div>
                                  </div>

                                  {isExpanded ? (
                                    <div className="student-task-details">
                                      <div className="student-task-details-row">
                                        <div className="student-task-stars" aria-label="Rating">
                                          {[1, 2, 3, 4, 5].map((star) => (
                                            <span key={star} className={`student-syllabus-star${star <= rating ? ' on' : ''}`} aria-hidden>★</span>
                                          ))}
                                        </div>
                                      </div>
                                      <label className="student-task-notes-label">
                                        <span className="muted small">Notes</span>
                                        <textarea className="student-task-notes" rows={2} value={notes || '—'} readOnly />
                                      </label>
                                    </div>
                                  ) : null}
                                </li>
                              )
                            })}
                            {selectedSession.activities.length === 0 ? <li className="muted small" style={{ padding: '0.5rem 0' }}>No topics yet.</li> : null}
                          </ul>
                        </>
                      )}
                    </section>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
