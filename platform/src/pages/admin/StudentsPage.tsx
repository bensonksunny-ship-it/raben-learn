import { lazy, Suspense, useEffect, useState } from 'react'
import { collection, doc, getDocs, orderBy, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { callCreateUser, callDeleteUser, callDisableUser, callUpdateUser } from '../../lib/adminGcfCallables'
import { formatFirebaseError } from '../../lib/formatFirebaseError'
import { mapUserDoc, avatarClass } from '../../lib/userUtils'
import { mapCourseDoc } from '../../lib/courses'
import { readTopicsFromSessionDoc } from '../../lib/topics'
import { useAuth } from '../../context/AuthContext'
import type { Course, Session, UserProfile } from '../../types'
import { EmptyState } from '../../components/EmptyState'
import { StudentApplicationForm, ApplicationStatusTag } from '../../components/StudentApplicationForm'
import { loadApplication, loadApplicationFile, moveApplicantToStudent, newApplicantId, normalizeApplication, validateApplication, type ApplicationStatus, type StudentApplication } from '../../lib/studentApplication'
import { downloadDataUrl, renderIdCardBack, renderIdCardFront, studentCodeFor } from '../../lib/idCard'
import { studentScanUrl } from '../../lib/publicUrl'

// Lazy — pulls in the whole PriorityScheduler grid, which most visits to the
// Students page never need.
const StudentTimetableView = lazy(() => import('../student/StudentTimetableView').then((m) => ({ default: m.StudentTimetableView })))

export function StudentsPage() {
  const { profile } = useAuth()
  const isAdmin = Boolean(profile?.roles.includes('admin'))
  const isManager = Boolean(profile?.roles.includes('manager'))
  // Create / edit courses / disable — same as admin. Delete stays admin-only (not part
  // of the approved manager scope), so it's gated separately below with `isAdmin`.
  const canManage = isAdmin || isManager

  const [students, setStudents] = useState<UserProfile[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [createdPw, setCreatedPw] = useState('')

  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'applications'>('active')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [selectedStudent, setSelectedStudent] = useState<UserProfile | null>(null)
  const [timetableStudentId, setTimetableStudentId] = useState<string | null>(null)
  const [idCardStudentId, setIdCardStudentId] = useState<string | null>(null)
  const [cardFront, setCardFront] = useState<string | null>(null)
  const [cardBack, setCardBack] = useState<string | null>(null)
  const [cardNote, setCardNote] = useState('')
  const [applicationStudentId, setApplicationStudentId] = useState<string | null>(null)
  const [appStatuses, setAppStatuses] = useState<Record<string, ApplicationStatus>>({})
  const [generatingQr, setGeneratingQr] = useState(false)
  const [selectedCourseForSyllabus, setSelectedCourseForSyllabus] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [syllabusLoading, setSyllabusLoading] = useState(false)
  const [addCourseId, setAddCourseId] = useState('')

  const [saving, setSaving] = useState(false)
  /** "+ New Student" / an applicant opened from the Applications tab — the full
   *  application form, saved to `applicants` (no account until recruited). */
  const [applicantFormId, setApplicantFormId] = useState<string | null>(null)
  const [applicants, setApplicants] = useState<StudentApplication[]>([])
  const [recruitingId, setRecruitingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      // Unfiltered fetch + filter by the normalized role below — a Firestore `array-contains`
      // query only matches when `roles` is literally an array, so it silently drops any legacy
      // doc that stores a single string role instead (see StudentDiaryPage for the same fix).
      const [usersSnap, coursesSnap, appsSnap, applicantsSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(query(collection(db, 'courses'), orderBy('title'))),
        getDocs(collection(db, 'student_applications')).catch(() => null),
        getDocs(collection(db, 'applicants')).catch(() => null),
      ])
      const applicantList: StudentApplication[] = []
      applicantsSnap?.forEach((d) => applicantList.push(normalizeApplication(d.id, d.data())))
      setApplicants(applicantList.filter((a) => a.status !== 'recruited').sort((a, b) => a.fullName.localeCompare(b.fullName)))
      const statuses: Record<string, ApplicationStatus> = {}
      appsSnap?.forEach((d) => { statuses[d.id] = (d.data().status as ApplicationStatus | undefined) ?? 'draft' })
      setAppStatuses(statuses)
      const list: UserProfile[] = []
      usersSnap.forEach((d) => {
        const profile = mapUserDoc(d)
        if (profile.roles.includes('student')) list.push(profile)
      })
      list.sort((a, b) => a.name.localeCompare(b.name))
      setStudents(list)

      const cl: Course[] = []
      coursesSnap.forEach((d) => cl.push(mapCourseDoc(d)))
      setCourses(cl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  useEffect(() => {
    if (!selectedStudent) return
    const updated = students.find((s) => s.id === selectedStudent.id)
    if (updated) setSelectedStudent(updated)
  }, [students])

  function openStudentDetail(student: UserProfile) {
    setSelectedStudent((prev) => prev?.id === student.id ? null : student)
    setSelectedCourseForSyllabus(null)
    setSessions([])
  }

  async function loadSyllabus(courseId: string) {
    setSyllabusLoading(true); setSessions([])
    try {
      const snap = await getDocs(query(collection(db, 'sessions'), where('courseId', '==', courseId)))
      const list: Session[] = []
      snap.forEach((d) => {
        const x = d.data()
        list.push({
          id: d.id,
          title: (x.title as string) ?? '',
          subtitle: (x.subtitle as string) ?? '',
          courseId: (x.courseId as string) ?? null,
          courseName: (x.courseName as string) ?? '',
          order: Number(x.order ?? 0),
          activities: readTopicsFromSessionDoc(x.activities),
        })
      })
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title))
      setSessions(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load syllabus')
    } finally {
      setSyllabusLoading(false)
    }
  }

  /**
   * "Recruit Student": creates the login account (Cloud Function, same as the old
   * direct "Add Student"), assigns the target courses, then carries the
   * application + documents over to the new student and marks the applicant
   * recruited — moving them into Active Students.
   */
  async function recruit(a: StudentApplication) {
    if (!canManage) return
    if (!a.fullName.trim() || !a.email.trim()) { setError('This application needs a full name and login email before recruiting.'); return }
    const missing = validateApplication(a)
    const prompt = missing.length > 0
      ? `${a.fullName} is still missing:\n• ${missing.join('\n• ')}\n\nRecruit anyway? This creates their student login (${a.email}).`
      : `Recruit ${a.fullName}? This creates their student login (${a.email}) and moves them to Active Students.`
    if (!window.confirm(prompt)) return
    setError(''); setCreatedPw(''); setRecruitingId(a.studentId)
    try {
      const res = await callCreateUser({
        name: a.fullName.trim(), email: a.email.trim(), roles: ['student'],
        centreIds: [], centreId: null,
        courseId: a.targetCourseIds[0] ?? null,
        temporaryPassword: null,
      })
      if (a.targetCourseIds.length > 0) {
        await updateDoc(doc(db, 'users', res.uid), { courseIds: a.targetCourseIds })
      }
      await moveApplicantToStudent(a, res.uid, profile?.id)
      setCreatedPw(`${a.fullName} recruited — login ${a.email}, temporary password: ${res.temporaryPassword}`)
      setStatusFilter('active')
      await load()
    } catch (err: unknown) {
      setError(formatFirebaseError(err, 'Recruit failed'))
    } finally {
      setRecruitingId(null)
    }
  }

  async function toggleDisable(u: UserProfile) {
    if (!canManage) return
    const disabling = u.status === 'active'
    if (!window.confirm(disabling ? 'Mark this student as inactive?' : 'Mark this student as active again?')) return
    setError('')
    try {
      await callDisableUser(u.id, disabling)
      const nextStatus: UserProfile['status'] = disabling ? 'disabled' : 'active'
      setStudents((prev) => prev.map((x) => (x.id === u.id ? { ...x, status: nextStatus } : x)))
    } catch (err: unknown) { setError(formatFirebaseError(err, 'Failed')) }
  }

  async function deleteStudent(u: UserProfile) {
    if (!isAdmin) return
    if (!window.confirm(`Permanently delete ${u.name || u.email}? This cannot be undone.`)) return
    setError('')
    try {
      await callDeleteUser(u.id)
      setStudents((prev) => prev.filter((x) => x.id !== u.id))
      if (selectedStudent?.id === u.id) setSelectedStudent(null)
    } catch (err: unknown) { setError(formatFirebaseError(err, 'Delete failed')) }
  }

  /** Display label only — the stored `UserStatus` value is still 'active'/'disabled'. */
  function statusLabel(status: UserProfile['status']): string {
    return status === 'active' ? 'active' : 'inactive'
  }

  async function saveCourses(u: UserProfile, nextCourseIds: string[]) {
    if (!canManage) return
    setError(''); setSaving(true)
    try {
      await callUpdateUser({ uid: u.id, courseIds: nextCourseIds, courseId: nextCourseIds[0] ?? null, centreIds: [], centreId: null })
      await updateDoc(doc(db, 'users', u.id), { courseIds: nextCourseIds })
      await load()
    } catch (err: unknown) {
      setError(formatFirebaseError(err, 'Update failed'))
    } finally {
      setSaving(false)
    }
  }

  const courseLabel = (cids: string[]) =>
    cids.map((cid) => courses.find((c) => c.id === cid)?.title).filter(Boolean).join(', ')

  const idCardStudent = students.find((s) => s.id === idCardStudentId) ?? null

  // Builds both sides of the printable ID card (JPEG) from the student's
  // application — photo, class, DOB, blood group on the front; the attendance
  // QR (permanent production URL) and emergency contact on the back.
  useEffect(() => {
    setCardFront(null); setCardBack(null); setCardNote('')
    if (!idCardStudent) return
    let cancelled = false
    void (async () => {
      try {
        const { app, exists } = await loadApplication(idCardStudent.id, idCardStudent.name)
        const photo = app.files.photo ? await loadApplicationFile(idCardStudent.id, 'photo') : null
        const [front, back] = await Promise.all([
          renderIdCardFront({
            name: app.fullName || idCardStudent.name,
            studentCode: studentCodeFor(idCardStudent.id),
            grade: app.grade, dateOfBirth: app.dateOfBirth, bloodGroup: app.bloodGroup,
            photoDataUrl: photo,
          }),
          renderIdCardBack({
            scanUrl: idCardStudent.qrToken ? studentScanUrl(idCardStudent.id, idCardStudent.qrToken) : null,
            emergencyName: app.emergencyName, emergencyPhone: app.emergencyPhone || app.fatherPhone || app.motherPhone,
            address: app.address,
          }),
        ])
        if (cancelled) return
        setCardFront(front); setCardBack(back)
        if (!exists) setCardNote('No application yet — the card only has the name. Ask the student to fill in their application (with photo).')
        else if (!photo) setCardNote('No photo uploaded yet in the application.')
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to build the ID card')
      }
    })()
    return () => { cancelled = true }
  }, [idCardStudent?.id, idCardStudent?.qrToken, idCardStudent?.name])

  async function generateQrToken(u: UserProfile) {
    setGeneratingQr(true); setError('')
    try {
      await callUpdateUser({ uid: u.id, generateQrToken: true })
      await load()
    } catch (err: unknown) {
      setError(formatFirebaseError(err, 'Failed to generate QR code'))
    } finally {
      setGeneratingQr(false)
    }
  }

  const activeStudents = students.filter((s) => s.status === 'active')
  const inactiveStudents = students.filter((s) => s.status !== 'active')
  const visibleStudents = statusFilter === 'applications' ? [] : statusFilter === 'active' ? activeStudents : inactiveStudents

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Students</h1>
        </div>
        {canManage && (
          <button className="btn primary" onClick={() => { setApplicantFormId(newApplicantId()); setError('') }}>
            + New Student
          </button>
        )}
      </div>

      {error ? <p className="error" style={{ marginBottom: '1rem' }}>{error}</p> : null}
      {createdPw ? <div className="notice" style={{ marginBottom: '1rem' }}><strong>Copy now:</strong> {createdPw}</div> : null}

      {!canManage && profile ? (
        <p className="notice" style={{ background: '#fffbeb', borderColor: '#fde68a', color: '#92400e', marginBottom: '1rem' }}>
          Signed in as <strong>{profile.roles.join(', ')}</strong>. Only <strong>admin</strong> and <strong>manager</strong> accounts can create students.
        </p>
      ) : null}

      {/* New Student — the full application form. Saves an applicant (no account
          yet); they become a student only via "Recruit Student" under Applications. */}
      {canManage && applicantFormId && (
        <div className="modal-backdrop" onClick={() => { setApplicantFormId(null); void load() }}>
          <div className="modal" style={{ maxWidth: 820 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>📝 Student Application</h3>
              <button type="button" className="btn small ghost" onClick={() => { setApplicantFormId(null); void load() }}>✕</button>
            </div>
            <StudentApplicationForm
              studentId={applicantFormId}
              defaultName=""
              mode="applicant"
              reviewerId={profile?.id}
              courses={courses}
              onSaved={(status) => { if (status === 'submitted') { setStatusFilter('applications'); void load() } }}
            />
          </div>
        </div>
      )}

      {loading ? <p className="muted">Loading…</p> : null}

      {/* Active / Inactive filter */}
      <div className="row" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className={`btn small ${statusFilter === 'active' ? 'primary' : 'secondary'}`}
          onClick={() => setStatusFilter('active')}
        >
          Active Students ({activeStudents.length})
        </button>
        <button
          type="button"
          className={`btn small ${statusFilter === 'inactive' ? 'primary' : 'secondary'}`}
          onClick={() => setStatusFilter('inactive')}
        >
          Inactive Students ({inactiveStudents.length})
        </button>
        {canManage && (
          <button
            type="button"
            className={`btn small ${statusFilter === 'applications' ? 'primary' : 'secondary'}`}
            onClick={() => setStatusFilter('applications')}
          >
            Applications ({applicants.length})
          </button>
        )}
      </div>

      {statusFilter === 'applications' && (
        applicants.length === 0 ? (
          <EmptyState title="No applications" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {applicants.map((a) => {
              const missing = validateApplication(a)
              const target = courseLabel(a.targetCourseIds)
              return (
                <div key={a.studentId} className="panel" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', margin: 0 }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 700 }}>{a.fullName || 'Unnamed applicant'}</div>
                    <div className="muted small">{a.email || 'No login email yet'}{target ? ` · ${target}` : ''}</div>
                    <div className="small" style={{ marginTop: '0.3rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <ApplicationStatusTag status={a.status} />
                      {missing.length > 0
                        ? <span className="muted">Missing: {missing.slice(0, 3).join(', ')}{missing.length > 3 ? ` +${missing.length - 3} more` : ''}</span>
                        : <span style={{ color: 'var(--green)', fontWeight: 600 }}>Complete</span>}
                    </div>
                  </div>
                  <div className="row" style={{ gap: '0.5rem' }}>
                    <button type="button" className="btn small secondary" onClick={() => setApplicantFormId(a.studentId)}>View / Edit</button>
                    <button type="button" className="btn small primary" disabled={recruitingId !== null} onClick={() => void recruit(a)}>
                      {recruitingId === a.studentId ? 'Recruiting…' : '✓ Recruit Student'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Student card grid */}
      {openMenuId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={() => setOpenMenuId(null)} />
      )}
      <div className="user-grid">
        {visibleStudents.map((s) => (
          <div
            key={s.id}
            className={`user-card${selectedStudent?.id === s.id ? ' selected' : ''}`}
            onClick={() => openStudentDetail(s)}
            style={{ cursor: 'pointer', overflow: 'visible' }}
          >
            <div className="user-card-body">
              <div className="user-card-top">
                <div className={avatarClass(s.roles)}>{s.name.charAt(0).toUpperCase()}</div>
                <div className="user-card-info">
                  <div className="user-card-name">{s.name}</div>
                  <div className="user-card-email">{s.email}</div>
                  <div style={{ marginTop: '0.25rem' }}><ApplicationStatusTag status={appStatuses[s.id] ?? null} /></div>
                </div>
                <span className={`tag ${s.status === 'active' ? '' : 'danger'}`} style={{ flexShrink: 0 }}>
                  {statusLabel(s.status)}
                </span>
                {canManage && (
                  <div className="topic-menu-wrap" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="topic-menu-btn"
                      onClick={() => setOpenMenuId(openMenuId === s.id ? null : s.id)}
                    >
                      ⋮
                    </button>
                    {openMenuId === s.id && (
                      <div className="topic-menu-dropdown">
                        {s.status === 'active' ? (
                          <button
                            type="button"
                            className="topic-menu-item"
                            onClick={() => { setOpenMenuId(null); void toggleDisable(s) }}
                          >
                            Mark Inactive
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="topic-menu-item"
                              onClick={() => { setOpenMenuId(null); void toggleDisable(s) }}
                            >
                              Mark Active
                            </button>
                            {/* Delete only ever shows for an already-inactive student, and
                                stays admin-only — not part of the manager scope. */}
                            {isAdmin && (
                              <button
                                type="button"
                                className="topic-menu-item danger"
                                onClick={() => { setOpenMenuId(null); void deleteStudent(s) }}
                              >
                                Delete
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {(s.courseIds ?? []).length > 0
                ? <div className="user-card-courses">📘 {courseLabel(s.courseIds ?? [])}</div>
                : <div className="muted small">No courses assigned</div>
              }
            </div>
          </div>
        ))}
        {visibleStudents.length === 0 && !loading && statusFilter !== 'applications' && (
          <div style={{ gridColumn: '1/-1' }}>
            <EmptyState title={statusFilter === 'active' ? 'No active students found' : 'No inactive students'} />
          </div>
        )}
      </div>

      {/* Student detail panel */}
      {selectedStudent && (
        <section className="panel" style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <div className={avatarClass(selectedStudent.roles)} style={{ width: 52, height: 52, fontSize: '1.35rem' }}>
                {selectedStudent.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 style={{ margin: '0 0 0.15rem' }}>{selectedStudent.name}</h2>
                <div className="muted small">{selectedStudent.email}</div>
                <span className={`tag ${selectedStudent.status === 'active' ? '' : 'danger'}`} style={{ marginTop: '0.3rem', display: 'inline-block' }}>
                  {statusLabel(selectedStudent.status)}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn small secondary" onClick={() => setTimetableStudentId(selectedStudent.id)}>
                🗓️ Timetable
              </button>
              {canManage && (
                <button type="button" className="btn small secondary" onClick={() => setApplicationStudentId(selectedStudent.id)}>
                  📋 Application
                </button>
              )}
              {canManage && (
                <button type="button" className="btn small secondary" onClick={() => setIdCardStudentId(selectedStudent.id)}>
                  🪪 ID Card
                </button>
              )}
              <button type="button" className="btn small secondary" onClick={() => setSelectedStudent(null)}>✕ Close</button>
            </div>
          </div>

          <h3 style={{ marginBottom: '0.75rem' }}>Courses</h3>
          {(selectedStudent.courseIds ?? []).length === 0
            ? <p className="muted" style={{ marginBottom: '0.75rem' }}>No courses assigned.</p>
            : (
              <div className="course-grid" style={{ marginBottom: '1rem' }}>
                {(selectedStudent.courseIds ?? []).map((cid) => {
                  const course = courses.find((c) => c.id === cid)
                  if (!course) return null
                  const isActive = selectedCourseForSyllabus === cid
                  return (
                    <div
                      key={cid}
                      style={{
                        background: isActive ? '#f0f4ff' : 'var(--surface)',
                        border: `1.5px solid ${isActive ? 'var(--primary)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius)',
                        transition: 'all 0.15s',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => { setSelectedCourseForSyllabus(cid); void loadSyllabus(cid) }}
                        style={{ width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none', padding: '1rem 1.25rem', fontFamily: 'inherit' }}
                      >
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: isActive ? 'var(--primary)' : 'var(--text)', marginBottom: '0.2rem' }}>
                          📘 {course.title}
                        </div>
                        <div className="muted small">{isActive ? '▸ Viewing syllabus' : 'Click to view syllabus'}</div>
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          }

          {canManage && (() => {
            const unassigned = courses.filter((c) => !(selectedStudent.courseIds ?? []).includes(c.id))
            return (
              <div className="row" style={{ marginBottom: '1.25rem' }}>
                <select
                  value={addCourseId}
                  onChange={(e) => setAddCourseId(e.target.value)}
                  style={{ maxWidth: 280 }}
                  disabled={unassigned.length === 0}
                >
                  <option value="">{unassigned.length === 0 ? 'All courses assigned' : 'Select course to add…'}</option>
                  {unassigned.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
                <button
                  type="button"
                  className="btn primary small"
                  disabled={!addCourseId || saving}
                  onClick={() => {
                    if (!addCourseId) return
                    void saveCourses(selectedStudent, [...(selectedStudent.courseIds ?? []), addCourseId])
                    setAddCourseId('')
                  }}
                >
                  + Add Course
                </button>
              </div>
            )
          })()}

          {selectedCourseForSyllabus && (
            <div>
              <h3 style={{ marginBottom: '0.75rem' }}>
                📝 Syllabus — {courses.find((c) => c.id === selectedCourseForSyllabus)?.title}
              </h3>
              {syllabusLoading ? <p className="muted">Loading syllabus…</p> : null}
              {!syllabusLoading && sessions.length === 0 ? <p className="muted">No sessions found.</p> : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {sessions.map((session) => (
                  <div key={session.id} className="syllabus-lesson" style={{ padding: '1rem 1.1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <strong style={{ fontSize: '1.05rem' }}>{session.order ? `${session.order}. ` : ''}{session.title}</strong>
                      <span className="muted small">{session.activities.length} topic{session.activities.length === 1 ? '' : 's'}</span>
                    </div>
                    {session.activities.length === 0 ? (
                      <p className="muted small" style={{ margin: 0 }}>No topics.</p>
                    ) : (
                      <ol style={{ margin: '0.25rem 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {session.activities.map((topic, idx) => {
                          const colors = topic.type === 'concept'
                            ? { bg: '#ede9fe', text: '#5b21b6' }
                            : { bg: '#dcfce7', text: '#166534' }
                          return (
                            <li key={topic.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.97rem' }}>
                              <span className="muted small" style={{ width: '1.4rem', textAlign: 'center', flexShrink: 0 }}>{idx + 1}</span>
                              <span style={{ background: colors.bg, color: colors.text, padding: '0.12rem 0.55rem', borderRadius: 999, fontSize: '0.76rem', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                {topic.type === 'concept' ? 'Concept' : 'Exercise'}
                              </span>
                              <span>
                                {topic.title}
                                {topic.remark ? <span className="muted"> — {topic.remark}</span> : null}
                              </span>
                              {topic.completed ? <span style={{ color: '#10b981', fontWeight: 700, fontSize: '0.8rem' }}>✓ Done</span> : null}
                            </li>
                          )
                        })}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {applicationStudentId && (() => {
        const st = students.find((x) => x.id === applicationStudentId)
        if (!st) return null
        return (
          <div className="modal-backdrop" onClick={() => setApplicationStudentId(null)}>
            <div className="modal" style={{ maxWidth: 820 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0 }}>📋 Application — {st.name}</h3>
                <button type="button" className="btn small ghost" onClick={() => setApplicationStudentId(null)}>✕</button>
              </div>
              <StudentApplicationForm
                studentId={st.id}
                defaultName={st.name}
                mode="staff"
                reviewerId={profile?.id}
                onSaved={(status) => setAppStatuses((prev) => ({ ...prev, [st.id]: status }))}
              />
            </div>
          </div>
        )
      })()}

      {idCardStudentId && idCardStudent && (
        <div className="modal-backdrop" onClick={() => setIdCardStudentId(null)}>
          <div className="modal" style={{ maxWidth: 520, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>🪪 ID Card — {idCardStudent.name}</h3>
              <button type="button" className="btn small ghost" onClick={() => setIdCardStudentId(null)}>✕</button>
            </div>
            {cardNote ? <p className="muted small" style={{ marginTop: 0 }}>{cardNote}</p> : null}
            {!idCardStudent.qrToken && (
              <div style={{ marginBottom: '1rem' }}>
                <button type="button" className="btn primary small" disabled={generatingQr} onClick={() => void generateQrToken(idCardStudent)}>
                  {generatingQr ? 'Generating…' : 'Generate QR Code'}
                </button>
              </div>
            )}
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {([['Front', cardFront, 'front'], ['Back', cardBack, 'back']] as const).map(([label, url, side]) => (
                <div key={side} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                  {url ? (
                    <img src={url} alt={`ID card ${side}`} style={{ width: 200, borderRadius: 12, border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }} />
                  ) : (
                    <div className="muted small" style={{ width: 200, height: 318, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--border)', borderRadius: 12 }}>Rendering…</div>
                  )}
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={!url}
                    onClick={() => url && downloadDataUrl(url, `${(idCardStudent.name || 'student').replace(/[^\w-]+/g, '_')}-id-card-${side}.jpg`)}
                  >
                    ⬇ {label} (JPEG)
                  </button>
                </div>
              ))}
            </div>
            {idCardStudent.qrToken && (
              <button type="button" className="btn ghost small" style={{ marginTop: '1rem' }} disabled={generatingQr} onClick={() => void generateQrToken(idCardStudent)}>
                {generatingQr ? 'Generating…' : '🔄 Regenerate QR (invalidates the old card)'}
              </button>
            )}
          </div>
        </div>
      )}

      {timetableStudentId && (
        <div className="modal-backdrop modal-backdrop-fullscreen" onClick={() => setTimetableStudentId(null)}>
          <div className="modal manager-view-modal manager-view-modal-fullscreen" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Close"
              className="btn small ghost manager-view-close manager-view-close-fullscreen"
              onClick={() => setTimetableStudentId(null)}
            >
              ✕
            </button>
            <div className="manager-view-fullscreen-body">
              <Suspense fallback={<p className="muted">Loading…</p>}>
                <StudentTimetableView studentId={timetableStudentId} />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
