import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { collection, doc, getDocs, orderBy, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { callCreateUser, callDisableUser, callResetPassword, callUpdateUser } from '../../lib/adminGcfCallables'
import { normalizeRoles } from '../../lib/roles'
import { useAuth } from '../../context/AuthContext'
import { formatFirebaseError } from '../../lib/formatFirebaseError'
import { readTopicsFromSessionDoc } from '../../lib/topics'
import type { Course, Session, UserProfile } from '../../types'

function mapUserDoc(d: { id: string; data: () => Record<string, unknown> }): UserProfile {
  const x = d.data()
  return {
    id: d.id,
    name: (x.name as string) ?? '',
    email: (x.email as string) ?? '',
    roles: normalizeRoles(x),
    status: x.status as UserProfile['status'],
    firstLogin: Boolean(x.firstLogin),
    createdAt: x.createdAt,
    courseIds: (x.courseIds as string[]) ?? [],
  }
}

export function StudentsPage() {
  const { profile } = useAuth()
  const isAdmin = Boolean(profile?.roles.includes('admin'))

  const [students, setStudents] = useState<UserProfile[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [createdPw, setCreatedPw] = useState('')

  const [search, setSearch] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<UserProfile | null>(null)
  const [selectedCourseForSyllabus, setSelectedCourseForSyllabus] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [syllabusLoading, setSyllabusLoading] = useState(false)
  const [addCourseId, setAddCourseId] = useState('')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [courseIds, setCourseIds] = useState<string[]>([])
  const [tempPassword, setTempPassword] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [usersSnap, coursesSnap] = await Promise.all([
        // Avoid Firestore composite-index requirement for (roles array-contains + orderBy email).
        // We fetch then sort client-side instead.
        getDocs(query(collection(db, 'users'), where('roles', 'array-contains', 'student'))),
        getDocs(query(collection(db, 'courses'), orderBy('title'))),
      ])
      const list: UserProfile[] = []
      usersSnap.forEach((docSnap) => list.push(mapUserDoc(docSnap)))
      list.sort((a, b) => a.email.localeCompare(b.email))
      setStudents(list)

      const cl: Course[] = []
      coursesSnap.forEach((d) => {
        const x = d.data()
        cl.push({ id: d.id, title: (x.title as string) ?? '' })
      })
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
        list.push({ id: d.id, title: (x.title as string) ?? '', subtitle: (x.subtitle as string) ?? '', courseId: (x.courseId as string) ?? null, courseName: (x.courseName as string) ?? '', order: Number(x.order ?? 0), activities: readTopicsFromSessionDoc(x.activities) })
      })
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title))
      setSessions(list)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load syllabus') } finally { setSyllabusLoading(false) }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return students.filter((s) => !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
  }, [students, search])

  function toggleCourse(cid: string) {
    setCourseIds((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]))
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (!isAdmin) return
    setError(''); setCreatedPw('')
    const pw = tempPassword.trim()
    if (pw.length > 0 && pw.length < 8) {
      setError('If you set a password, it must be at least 8 characters (or leave the field empty).')
      return
    }
    setSaving(true)
    try {
      const res = await callCreateUser({
        name,
        email,
        roles: ['student'],
        centreIds: [],
        centreId: null,
        courseId: courseIds[0] ?? null,
        temporaryPassword: pw ? pw : null,
      })
      setCreatedPw(res.temporaryPassword)
      setName(''); setEmail(''); setCourseIds([]); setTempPassword('')
      await load()
    } catch (err: unknown) {
      console.error('[DEBUG] Create student failed with error:', err)
      setError(formatFirebaseError(err, 'Create failed'))
    } finally {
      setSaving(false)
    }
  }

  async function toggleDisable(u: UserProfile) {
    if (!isAdmin) return
    const next = u.status === 'active'
    if (!window.confirm(next ? 'Disable this student?' : 'Re-enable this student?')) return
    setError('')
    try { await callDisableUser(u.id, next); await load() }
    catch (err: unknown) { setError(formatFirebaseError(err, 'Failed')) }
  }

  async function resetPassword(u: UserProfile) {
    if (!isAdmin) return
    if (!window.confirm(`Reset password for ${u.email}?`)) return
    setError(''); setCreatedPw('')
    try { const res = await callResetPassword(u.id); setCreatedPw(res.temporaryPassword) }
    catch (err: unknown) { setError(formatFirebaseError(err, 'Failed')) }
  }

  async function saveCourses(u: UserProfile, nextCourseIds: string[]) {
    if (!isAdmin) return
    setError(''); setSaving(true)
    try {
      await callUpdateUser({
        uid: u.id,
        courseIds: nextCourseIds,
        courseId: nextCourseIds[0] ?? null,
        centreIds: [],
        centreId: null,
      })
      await updateDoc(doc(db, 'users', u.id), { courseIds: nextCourseIds })
      await load()
    } catch (err: unknown) {
      setError(formatFirebaseError(err, 'Update failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1>Students</h1>
      <p className="muted">Create and manage student accounts.</p>
      {error ? <p className="error">{error}</p> : null}
      {createdPw ? <div className="notice"><strong>Temporary password (copy now):</strong> {createdPw}</div> : null}

      {!isAdmin && profile ? (
        <p className="notice" style={{ background: '#fffbeb', borderColor: '#fde68a', color: '#92400e' }}>
          You’re signed in as <strong>{profile.roles.join(', ')}</strong>. Only <strong>admin</strong> accounts see the
          “Add student” form (including optional password). Open <strong>User Management</strong> as an admin, or ask an admin to create accounts.
        </p>
      ) : null}

      {isAdmin && (
        <section className="panel" style={{ marginBottom: '1rem' }}>
          <h2>Add student</h2>
          <form className="form grid" onSubmit={onCreate}>
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <div className="full syllabus-mini-form" style={{ margin: 0 }}>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Initial password (optional)</div>
              <p className="muted small" style={{ margin: '0 0 0.5rem' }}>
                Leave empty to auto-generate a temporary password. If you set one, use at least 8 characters.
              </p>
              <input
                type="password"
                autoComplete="new-password"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                placeholder="Leave blank to auto-generate"
              />
            </div>
            <div className="full">
              <span className="muted small">Assign courses</span>
              <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                {courses.map((c) => (
                  <label key={c.id} className="row" style={{ gap: '0.25rem' }}>
                    <input type="checkbox" checked={courseIds.includes(c.id)} onChange={() => toggleCourse(c.id)} />
                    <span className="small">{c.title}</span>
                  </label>
                ))}
                {courses.length === 0 ? <span className="muted small">No courses yet.</span> : null}
              </div>
            </div>
            <button className="btn primary" type="submit" disabled={saving}>Create student</button>
          </form>
        </section>
      )}

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>All students</h2>
          <input style={{ maxWidth: 320 }} placeholder="Search name/email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {loading ? <p className="muted">Loading…</p> : null}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Courses</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} onClick={() => openStudentDetail(s)} style={{ cursor: 'pointer', background: selectedStudent?.id === s.id ? 'var(--surface-soft)' : undefined }}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link to={`/mentor/students/${s.id}`}>{s.name}</Link>
                  </td>
                  <td className="muted">{s.email}</td>
                  <td>
                    <span className="muted small">
                      {(s.courseIds ?? []).map((cid) => courses.find((c) => c.id === cid)?.title ?? cid).join(', ') || '—'}
                    </span>
                    {isAdmin && courses.length > 0 && (
                      <div className="row" style={{ marginTop: '0.35rem', gap: '0.35rem' }}>
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={() => {
                            const next = window.prompt('Comma-separated course titles to assign (exact match).')
                            if (next == null) return
                            const titles = next.split(',').map((t) => t.trim()).filter(Boolean)
                            const ids = courses.filter((c) => titles.includes(c.title)).map((c) => c.id)
                            void saveCourses(s, ids)
                          }}
                          disabled={saving}
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </td>
                  <td><span className={`tag ${s.status === 'active' ? '' : 'danger'}`}>{s.status}</span></td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    <Link className="btn small ghost" to={`/mentor/students/${s.id}`}>Open</Link>
                    {isAdmin && (
                      <>
                        <button type="button" className="btn small ghost" onClick={() => void resetPassword(s)}>Reset PW</button>
                        <button type="button" className="btn small ghost" onClick={() => void toggleDisable(s)}>{s.status === 'active' ? 'Disable' : 'Enable'}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !loading ? <tr><td colSpan={5} className="muted">No students found.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {selectedStudent && (
        <section className="panel" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <div className="student-card-avatar" style={{ width: 52, height: 52, fontSize: '1.35rem' }}>{selectedStudent.name.charAt(0).toUpperCase()}</div>
              <div>
                <h2 style={{ margin: '0 0 0.15rem' }}>{selectedStudent.name}</h2>
                <div className="muted small">{selectedStudent.email}</div>
                <span className={`tag ${selectedStudent.status === 'active' ? '' : 'danger'}`} style={{ marginTop: '0.3rem', display: 'inline-block' }}>{selectedStudent.status}</span>
              </div>
            </div>
            <button type="button" className="btn small ghost" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} onClick={() => setSelectedStudent(null)}>✕ Close</button>
          </div>

          <h3 style={{ marginBottom: '0.75rem' }}>Courses</h3>
          {(selectedStudent.courseIds ?? []).length === 0
            ? <p className="muted" style={{ marginBottom: '0.75rem' }}>No courses assigned to this student.</p>
            : (
              <div className="course-grid" style={{ marginBottom: '1rem' }}>
                {(selectedStudent.courseIds ?? []).map((cid) => {
                  const course = courses.find((c) => c.id === cid)
                  if (!course) return null
                  const isActive = selectedCourseForSyllabus === cid
                  return (
                    <div key={cid} style={{ position: 'relative', background: isActive ? '#f0f4ff' : 'var(--surface)', border: `1.5px solid ${isActive ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 'var(--radius)', transition: 'all 0.15s' }}>
                      <button
                        type="button"
                        onClick={() => { setSelectedCourseForSyllabus(cid); void loadSyllabus(cid) }}
                        style={{ width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none', padding: '1rem 1.25rem', fontFamily: 'inherit' }}
                      >
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: isActive ? 'var(--primary)' : 'var(--text)', marginBottom: '0.2rem' }}>📘 {course.title}</div>
                        {course.description ? <div className="muted small">{course.description}</div> : null}
                        <div className="muted small" style={{ marginTop: '0.35rem' }}>{isActive ? '▸ Viewing syllabus' : 'Click to view syllabus'}</div>
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          }
          {isAdmin && (() => {
            const unassigned = courses.filter((c) => !(selectedStudent.courseIds ?? []).includes(c.id))
            return (
              <div className="row" style={{ marginBottom: '1.25rem' }}>
                <select value={addCourseId} onChange={(e) => setAddCourseId(e.target.value)} style={{ maxWidth: 280 }} disabled={unassigned.length === 0}>
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
              <h3 style={{ marginBottom: '0.75rem' }}>📝 Syllabus — {courses.find((c) => c.id === selectedCourseForSyllabus)?.title}</h3>
              {syllabusLoading ? <p className="muted">Loading syllabus…</p> : null}
              {!syllabusLoading && sessions.length === 0 ? <p className="muted">No sessions found for this course.</p> : null}
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
                          const colors = topic.type === 'concept' ? { bg: '#ede9fe', text: '#5b21b6' } : { bg: '#dcfce7', text: '#166534' }
                          return (
                            <li key={topic.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.97rem' }}>
                              <span className="muted small" style={{ width: '1.4rem', textAlign: 'center', flexShrink: 0 }}>{idx + 1}</span>
                              <span style={{ background: colors.bg, color: colors.text, padding: '0.12rem 0.55rem', borderRadius: 999, fontSize: '0.76rem', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                {topic.type === 'concept' ? 'Concept' : 'Exercise'}
                              </span>
                              <span>{topic.title}{topic.remark ? <span className="muted"> — {topic.remark}</span> : null}</span>
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
    </div>
  )
}

