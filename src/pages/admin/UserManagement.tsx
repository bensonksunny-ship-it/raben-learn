import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  collection, getDocs, limit, orderBy, query, startAfter, where,
  type QueryConstraint, type QueryDocumentSnapshot, type DocumentData,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { callCreateUser, callDisableUser, callResetPassword, callUpdateUser } from '../../lib/adminGcfCallables'
import { normalizeRoles } from '../../lib/roles'
import { formatFirebaseError } from '../../lib/formatFirebaseError'
import type { Course, Role, UserProfile } from '../../types'

const PAGE_SIZE = 20
const ROLE_OPTIONS: Role[] = ['admin', 'mentor', 'student']

function mapUserDoc(docSnap: QueryDocumentSnapshot<DocumentData>): UserProfile {
  const d = docSnap.data()
  return {
    id: docSnap.id, name: d.name as string, email: d.email as string,
    roles: normalizeRoles(d), status: d.status as UserProfile['status'],
    firstLogin: Boolean(d.firstLogin), createdAt: d.createdAt,
    courseIds: (d.courseIds as string[]) ?? [],
  }
}

export function UserManagement() {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingPage, setLoadingPage] = useState(false)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | ''>('')
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [pageIndex, setPageIndex] = useState(0)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [createRoles, setCreateRoles] = useState<Role[]>(['student'])
  const [createCourseIds, setCreateCourseIds] = useState<string[]>([])
  const [createTempPassword, setCreateTempPassword] = useState('')
  const [creatingUser, setCreatingUser] = useState(false)
  const [createdPw, setCreatedPw] = useState('')

  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRoles, setEditRoles] = useState<Role[]>(['student'])
  const [editCourseIds, setEditCourseIds] = useState<string[]>([])

  useEffect(() => {
    getDocs(collection(db, 'courses')).then((snap) => {
      const list: Course[] = []
      snap.forEach((d) => { const x = d.data(); list.push({ id: d.id, title: (x.title as string) ?? '' }) })
      list.sort((a, b) => a.title.localeCompare(b.title))
      setCourses(list)
    })
  }, [])

  const fetchPage = useCallback(
    async (startAfterDoc: QueryDocumentSnapshot<DocumentData> | null, nextPageIndex: number) => {
      setLoadingPage(true); setError('')
      try {
        const constraints: QueryConstraint[] = [orderBy('email'), limit(PAGE_SIZE + 1)]
        if (roleFilter) constraints.unshift(where('roles', 'array-contains', roleFilter))
        if (startAfterDoc) constraints.push(startAfter(startAfterDoc))
        const snap = await getDocs(query(collection(db, 'users'), ...constraints))
        let docs = snap.docs
        const more = docs.length > PAGE_SIZE
        if (more) docs = docs.slice(0, PAGE_SIZE)
        setUsers(docs.map(mapUserDoc))
        setLastDoc(docs.length ? docs[docs.length - 1]! : null)
        setHasMore(more); setPageIndex(nextPageIndex)
      } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); setUsers([]) }
      finally { setLoadingPage(false); setLoading(false) }
    }, [roleFilter])

  useEffect(() => { setLoading(true); void fetchPage(null, 0) }, [fetchPage])

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [users, search])

  function toggleRole(roles: Role[], r: Role, setter: (v: Role[]) => void) {
    setter(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])
  }

  function toggleCourse(courseIds: string[], cid: string, setter: (v: string[]) => void) {
    setter(courseIds.includes(cid) ? courseIds.filter((x) => x !== cid) : [...courseIds, cid])
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault(); setError(''); setCreatedPw('')
    if (createRoles.length === 0) { setError('Select at least one role.'); return }
    const pw = createTempPassword.trim()
    if (pw.length > 0 && pw.length < 8) {
      setError('If you set a password, it must be at least 8 characters (or leave the field empty).')
      return
    }
    setCreatingUser(true)
    try {
      const res = await callCreateUser({
        name, email, roles: createRoles,
        centreIds: [], centreId: null,
        courseId: createCourseIds[0] ?? null,
        temporaryPassword: pw ? pw : null,
      })
      setCreatedPw(res.temporaryPassword)
      setName(''); setEmail(''); setCreateCourseIds([]); setCreateTempPassword('')
      await fetchPage(null, 0)
    } catch (err: unknown) {
      console.error('Create user failed', err)
      setError(formatFirebaseError(err, 'Create failed'))
    } finally {
      setCreatingUser(false)
    }
  }

  function startEdit(u: UserProfile) {
    setEditId(u.id); setEditName(u.name); setEditEmail(u.email)
    setEditRoles(u.roles.length ? [...u.roles] : ['student'])
    setEditCourseIds(u.courseIds ?? [])
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault(); if (!editId) return; setError('')
    if (editRoles.length === 0) { setError('Select at least one role.'); return }
    try {
      await callUpdateUser({
        uid: editId, name: editName, email: editEmail, roles: editRoles,
        centreIds: [], centreId: null,
        courseId: editCourseIds[0] ?? null,
      })
      setEditId(null); await fetchPage(null, 0)
    } catch (err: unknown) { setError(formatFirebaseError(err, 'Update failed')) }
  }

  async function toggleDisable(u: UserProfile) {
    const next = u.status === 'active'
    if (!window.confirm(next ? 'Disable this user?' : 'Re-enable this user?')) return
    try { await callDisableUser(u.id, next); await fetchPage(null, 0) }
    catch (err: unknown) { setError(formatFirebaseError(err, 'Failed')) }
  }

  async function resetPassword(u: UserProfile) {
    if (!window.confirm(`Reset password for ${u.email}?`)) return
    setCreatedPw('')
    try { const res = await callResetPassword(u.id); setCreatedPw(res.temporaryPassword) }
    catch (err: unknown) { setError(formatFirebaseError(err, 'Failed')) }
  }

  function CourseSelector({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
    if (courses.length === 0) return <p className="muted small">No courses created yet.</p>
    return (
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {courses.map((c) => (
          <label key={c.id} className="row" style={{ gap: '0.25rem' }}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleCourse(selected, c.id, onChange)} />
            <span className="small">{c.title}</span>
          </label>
        ))}
      </div>
    )
  }

  return (
    <div>
      <h1>User Management</h1>
      <p className="muted">Create accounts with temporary passwords. Assign courses to students.</p>
      {error ? <p className="error">{error}</p> : null}
      {createdPw ? <div className="notice"><strong>Temporary password (copy now):</strong> {createdPw}</div> : null}

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <h2>Create User</h2>
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
              value={createTempPassword}
              onChange={(e) => setCreateTempPassword(e.target.value)}
              placeholder="Leave blank to auto-generate"
            />
          </div>
          <div className="full">
            <span className="muted small">Roles</span>
            <div className="row">{ROLE_OPTIONS.map((r) => (
              <label key={r} className="row" style={{ gap: '0.25rem' }}><input type="checkbox" checked={createRoles.includes(r)} onChange={() => toggleRole(createRoles, r, setCreateRoles)} /> {r}</label>
            ))}</div>
          </div>
          {createRoles.includes('student') && (
            <div className="full">
              <span className="muted small">Assign Courses</span>
              <CourseSelector selected={createCourseIds} onChange={setCreateCourseIds} />
            </div>
          )}
          <button type="submit" className="btn primary" disabled={creatingUser}>
            {creatingUser ? 'Creating…' : 'Create User'}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>All Users</h2>
        <div className="form grid" style={{ marginBottom: '0.75rem' }}>
          <label>Search<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by name/email…" /></label>
          <label>Role<select value={roleFilter} onChange={(e) => setRoleFilter((e.target.value || '') as Role | '')}>
            <option value="">All</option><option value="admin">admin</option><option value="mentor">mentor</option><option value="student">student</option>
          </select></label>
        </div>
        <div className="row" style={{ marginBottom: '0.75rem' }}>
          <button type="button" className="btn ghost" disabled={loadingPage || pageIndex === 0} onClick={() => void fetchPage(null, 0)}>First</button>
          <button type="button" className="btn primary" disabled={loadingPage || !hasMore || !lastDoc} onClick={() => void fetchPage(lastDoc, pageIndex + 1)}>Next</button>
          <span className="muted small">Page {pageIndex + 1}{loadingPage ? ' · Loading…' : ''}</span>
        </div>
        {loading && !loadingPage ? <p className="muted">Loading…</p> : null}
        <div className="table-wrap"><table className="table"><thead><tr>
          <th>Name</th><th>Email</th><th>Roles</th><th>Courses</th><th>Status</th><th></th>
        </tr></thead><tbody>
          {displayed.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td><td>{u.email}</td><td>{u.roles.join(', ')}</td>
              <td>{(u.courseIds ?? []).map((cid) => courses.find((c) => c.id === cid)?.title ?? cid).join(', ') || '—'}</td>
              <td><span className={`tag ${u.status === 'active' ? '' : 'danger'}`}>{u.status}</span></td>
              <td className="actions">
                <button type="button" className="btn small" onClick={() => startEdit(u)}>Edit</button>
                <button type="button" className="btn small ghost" onClick={() => void resetPassword(u)}>Reset PW</button>
                <button type="button" className="btn small ghost" onClick={() => void toggleDisable(u)}>{u.status === 'active' ? 'Disable' : 'Enable'}</button>
              </td>
            </tr>
          ))}
        </tbody></table></div>
      </section>

      {editId && (
        <div className="modal-backdrop" onClick={() => setEditId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit User</h2>
            <form className="form" onSubmit={saveEdit}>
              <label>Name<input value={editName} onChange={(e) => setEditName(e.target.value)} required /></label>
              <label>Email<input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required /></label>
              <div>
                <span className="muted small">Roles</span>
                <div className="row">{ROLE_OPTIONS.map((r) => (
                  <label key={r} className="row" style={{ gap: '0.25rem' }}><input type="checkbox" checked={editRoles.includes(r)} onChange={() => toggleRole(editRoles, r, setEditRoles)} /> {r}</label>
                ))}</div>
              </div>
              {editRoles.includes('student') && (
                <div>
                  <span className="muted small">Assigned Courses</span>
                  <CourseSelector selected={editCourseIds} onChange={setEditCourseIds} />
                </div>
              )}
              <div className="row">
                <button type="submit" className="btn primary">Save</button>
                <button type="button" className="btn ghost" onClick={() => setEditId(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
