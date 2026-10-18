import { lazy, Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { normalizeRoles } from '../../lib/roles'
import { OwlMascot } from '../../components/manager/OwlMascot'
import { NavCard } from '../../components/manager/NavCard'
import {
  timeStrToMinutes,
  createDefaultTimetable, normalizeTimetable, createDefaultElectives, normalizeElectives,
} from '../../components/manager/schedulerShared'
import type { ClassTimetable, ElectiveSchedule, Weekday } from '../../types'

// Lazy — same reasoning as StudentsPage's own Timetable popup: most visits to this
// preview tool never open it.
const StudentTimetableView = lazy(() => import('../student/StudentTimetableView').then((m) => ({ default: m.StudentTimetableView })))

/**
 * A manager/admin-only, read-only view of a real student's dashboard — pick any
 * real student from the dropdown and this fetches their name and shows the same
 * "welcome" header, shared class schedule, and Timetable/Notes action cards the
 * real student dashboard shows. Never writes anything.
 */

interface StudentOption { id: string; name: string }

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
  const selectedStudentId = searchParams.get('student')
  // Local state, not a `?view=` query param — this opens in place as a popup, it
  // doesn't navigate anywhere.
  const [showTimetable, setShowTimetable] = useState(false)
  function closeTimetable() { setShowTimetable(false) }

  const [students, setStudents] = useState<StudentOption[]>([])
  const [studentsLoading, setStudentsLoading] = useState(true)

  const [studentName, setStudentName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [nextClass, setNextClass] = useState<NextClassInfo | null>(null)
  const [loadingSchedule, setLoadingSchedule] = useState(true)

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

  // Just the student's own name — mirrors the real StudentDashboard's greeting,
  // parameterized by the selected uid instead of the signed-in manager's own.
  useEffect(() => {
    if (!selectedStudentId) { setStudentName(''); return }
    setLoading(true); setError('')
    void (async () => {
      try {
        const userSnap = await getDoc(doc(db, 'users', selectedStudentId))
        const studentData = userSnap.exists() ? userSnap.data() : {}
        setStudentName((studentData.name as string) || 'Student')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load student data')
      } finally {
        setLoading(false)
      }
    })()
  }, [selectedStudentId])

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
          <p className="muted">Choose anyone from the dropdown above to see their real dashboard.</p>
        </div>
      ) : loading ? (
        <p className="muted">Loading {firstName}'s data…</p>
      ) : (
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
            <NavCard title="Timetable" color="#8b5cf6" onClick={() => setShowTimetable(true)} minimal compact />
            <NavCard title="Notes" color="#059669" to={`/manager/student-preview?student=${selectedStudentId}`} minimal compact />
          </div>
        </div>
      )}

      {showTimetable && selectedStudentId && (
        <div className="modal-backdrop modal-backdrop-fullscreen" onClick={closeTimetable}>
          <div className="modal manager-view-modal manager-view-modal-fullscreen" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Close"
              className="btn small ghost manager-view-close manager-view-close-fullscreen"
              onClick={closeTimetable}
            >
              ✕
            </button>
            <div className="manager-view-fullscreen-body">
              <Suspense fallback={<p className="muted">Loading…</p>}>
                <StudentTimetableView studentId={selectedStudentId} />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
