import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { callCreateUser, callDisableUser, callResetPassword, callUpdateUser } from '../../lib/callables'
import { normalizeRoles } from '../../lib/roles'
import { useAuth } from '../../context/AuthContext'
import type { Course, UserProfile } from '../../types'

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

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [courseIds, setCourseIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [usersSnap, coursesSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('roles', 'array-contains', 'student'), orderBy('email'))),
        getDocs(query(collection(db, 'courses'), orderBy('title'))),
      ])
      const list: UserProfile[] = []
      usersSnap.forEach((docSnap) => list.push(mapUserDoc(docSnap)))
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
    setError(''); setCreatedPw(''); setSaving(true)
    try {
      const res = await callCreateUser({
        name,
        email,
        roles: ['student'],
        centreIds: [],
        centreId: null,
        courseId: courseIds[0] ?? null,
      })
      setCreatedPw(res.temporaryPassword)
      setName(''); setEmail(''); setCourseIds([])
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Create failed')
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
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed') }
  }

  async function resetPassword(u: UserProfile) {
    if (!isAdmin) return
    if (!window.confirm(`Reset password for ${u.email}?`)) return
    setError(''); setCreatedPw('')
    try { const res = await callResetPassword(u.id); setCreatedPw(res.temporaryPassword) }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed') }
  }

  async function saveCourses(u: UserProfile, nextCourseIds: string[]) {
    if (!isAdmin) return
    setError(''); setSaving(true)
    try {
      await callUpdateUser({
        uid: u.id,
        courseId: nextCourseIds[0] ?? null,
        centreIds: [],
        centreId: null,
      })
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed')
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

      {isAdmin && (
        <section className="panel" style={{ marginBottom: '1rem' }}>
          <h2>Add student</h2>
          <form className="form grid" onSubmit={onCreate}>
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
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
                <tr key={s.id}>
                  <td>
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
                  <td className="actions">
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
    </div>
  )
}

