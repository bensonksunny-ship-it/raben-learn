import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { collection, doc, getDocs, orderBy, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { callCreateUser, callDisableUser, callResetPassword, callUpdateUser } from '../../lib/adminGcfCallables'
import { formatFirebaseError } from '../../lib/formatFirebaseError'
import { mapUserDoc, avatarClass } from '../../lib/userUtils'
import { readTopicsFromSessionDoc } from '../../lib/topics'
import { useAuth } from '../../context/AuthContext'
import type { Course, Session, UserProfile } from '../../types'

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

  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [courseIds, setCourseIds] = useState<string[]>([])
  const [tempPassword, setTempPassword] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [usersSnap, coursesSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('roles', 'array-contains', 'student'))),
        getDocs(query(collection(db, 'courses'), orderBy('title'))),
      ])
      const list: UserProfile[] = []
      usersSnap.forEach((d) => list.push(mapUserDoc(d)))
      list.sort((a, b) => a.name.localeCompare(b.name))
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
      setError('Password must be at least 8 characters.'); return
    }
    setSaving(true)
    try {
      const res = await callCreateUser({
        name, email, roles: ['student'],
        centreIds: [], centreId: null,
        courseId: courseIds[0] ?? null,
        temporaryPassword: pw || null,
      })
      setCreatedPw(res.temporaryPassword)
      setName(''); setEmail(''); setCourseIds([]); setTempPassword('')
      setShowCreate(false)
      await load()
    } catch (err: unknown) {
      setError(formatFirebaseError(err, 'Create failed'))
    } finally {
      setSaving(false)
    }
  }

  async function toggleDisable(u: UserProfile) {
    if (!isAdmin) return
    const disabling = u.status === 'active'
    if (!window.confirm(disabling ? 'Disable this student?' : 'Re-enable this student?')) return
    setError('')
    try { await callDisableUser(u.id, disabling); await load() }
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

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Students</h1>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="page-stat">{students.length} students</span>
            <span className="muted small">Create and manage student accounts</span>
          </div>
        </div>
        {isAdmin && (
          <button className="btn primary" onClick={() => { setShowCreate((v) => !v); setError('') }}>
            {showCreate ? '✕ Cancel' : '+ New Student'}
          </button>
        )}
      </div>

      {error ? <p className="error" style={{ marginBottom: '1rem' }}>{error}</p> : null}
      {createdPw ? <div className="notice" style={{ marginBottom: '1rem' }}><strong>Temporary password (copy now):</strong> {createdPw}</div> : null}

      {!isAdmin && profile ? (
        <p className="notice" style={{ background: '#fffbeb', borderColor: '#fde68a', color: '#92400e', marginBottom: '1rem' }}>
          Signed in as <strong>{profile.roles.join(', ')}</strong>. Only <strong>admin</strong> accounts can create students.
        </p>
      ) : null}

      {/* Create student form */}
      {isAdmin && showCreate && (
        <section className="panel" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>Add Student</h2>
          <form className="form grid" onSubmit={onCreate}>
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <div className="full">
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.35rem' }}>
                Initial password <span className="muted small" style={{ fontWeight: 400 }}>(optional — leave blank to auto-generate)</span>
              </div>
              <input
                type="password"
                autoComplete="new-password"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                placeholder="Min 8 characters or leave blank"
              />
            </div>
            <div className="full">
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.35rem' }}>Assign Courses</div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {courses.map((c) => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.9rem' }}>
                    <input type="checkbox" checked={courseIds.includes(c.id)} onChange={() => toggleCourse(c.id)} />
                    {c.title}
                  </label>
                ))}
                {courses.length === 0 && <span className="muted small">No courses yet.</span>}
              </div>
            </div>
            <div className="full">
              <button className="btn primary" type="submit" disabled={saving}>
                {saving ? 'Creating…' : 'Create Student'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Search */}
      <div className="filter-bar">
        <input
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? <p className="muted">Loading…</p> : null}

      {/* Student card grid */}
      <div className="user-grid">
        {filtered.map((s) => (
          <div
            key={s.id}
            className={`user-card${selectedStudent?.id === s.id ? ' selected' : ''}`}
            onClick={() => openStudentDetail(s)}
            style={{ cursor: 'pointer' }}
          >
            <div className="user-card-body">
              <div className="user-card-top">
                <div className={avatarClass(s.roles)}>{s.name.charAt(0).toUpperCase()}</div>
                <div className="user-card-info">
                  <div className="user-card-name">{s.name}</div>
                  <div className="user-card-email">{s.email}</div>
                </div>
                <span className={`tag ${s.status === 'active' ? '' : 'danger'}`} style={{ flexShrink: 0 }}>
                  {s.status}
                </span>
              </div>
              {(s.courseIds ?? []).length > 0
                ? <div className="user-card-courses">📘 {courseLabel(s.courseIds ?? [])}</div>
                : <div className="muted small">No courses assigned</div>
              }
            </div>
            <div className="user-card-footer" onClick={(e) => e.stopPropagation()}>
              <Link className="btn small secondary" to={`/mentor/students/${s.id}`}>Open</Link>
              {isAdmin && (
                <>
                  <button type="button" className="btn small secondary" onClick={() => void resetPassword(s)}>Reset PW</button>
                  <button type="button" className="btn small secondary" onClick={() => void toggleDisable(s)}>
                    {s.status === 'active' ? 'Disable' : 'Enable'}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && !loading && (
          <p className="muted" style={{ gridColumn: '1/-1', padding: '2rem 0' }}>No students found.</p>
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
                  {selectedStudent.status}
                </span>
              </div>
            </div>
            <button type="button" className="btn small secondary" onClick={() => setSelectedStudent(null)}>✕ Close</button>
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

          {isAdmin && (() => {
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
    </div>
  )
}
