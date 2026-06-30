import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  collection, getDocs, limit, orderBy, query, startAfter, where,
  type QueryConstraint, type QueryDocumentSnapshot, type DocumentData,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { callCreateUser, callDisableUser, callResetPassword, callUpdateUser } from '../../lib/adminGcfCallables'
import { formatFirebaseError } from '../../lib/formatFirebaseError'
import { mapUserDoc, avatarClass } from '../../lib/userUtils'
import type { Course, Role, UserProfile } from '../../types'

const PAGE_SIZE = 20
const ROLE_OPTIONS: Role[] = ['admin', 'mentor', 'student']

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

  const [showCreate, setShowCreate] = useState(false)
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
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void getDocs(collection(db, 'courses')).then((snap) => {
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
    },
    [roleFilter],
  )

  useEffect(() => { setLoading(true); void fetchPage(null, 0) }, [fetchPage])

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [users, search])

  function toggleRole(roles: Role[], r: Role, setter: (v: Role[]) => void) {
    setter(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])
  }

  function toggleCourse(ids: string[], cid: string, setter: (v: string[]) => void) {
    setter(ids.includes(cid) ? ids.filter((x) => x !== cid) : [...ids, cid])
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault(); setError(''); setCreatedPw('')
    if (createRoles.length === 0) { setError('Select at least one role.'); return }
    const pw = createTempPassword.trim()
    if (pw.length > 0 && pw.length < 8) { setError('Password must be at least 8 characters.'); return }
    setCreatingUser(true)
    try {
      const res = await callCreateUser({
        name, email, roles: createRoles,
        centreIds: [], centreId: null,
        courseId: createCourseIds[0] ?? null,
        temporaryPassword: pw || null,
      })
      setCreatedPw(res.temporaryPassword)
      setName(''); setEmail(''); setCreateCourseIds([]); setCreateTempPassword('')
      setShowCreate(false)
      await fetchPage(null, 0)
    } catch (err: unknown) {
      setError(formatFirebaseError(err, 'Create failed'))
    } finally { setCreatingUser(false) }
  }

  function startEdit(u: UserProfile) {
    setEditId(u.id); setEditName(u.name); setEditEmail(u.email)
    setEditRoles(u.roles.length ? [...u.roles] : ['student'])
    setEditCourseIds(u.courseIds ?? [])
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault(); if (!editId) return; setError(''); setSaving(true)
    if (editRoles.length === 0) { setError('Select at least one role.'); setSaving(false); return }
    try {
      await callUpdateUser({
        uid: editId, name: editName, email: editEmail, roles: editRoles,
        centreIds: [], centreId: null, courseId: editCourseIds[0] ?? null,
      })
      setEditId(null); await fetchPage(null, 0)
    } catch (err: unknown) { setError(formatFirebaseError(err, 'Update failed')) }
    finally { setSaving(false) }
  }

  async function toggleDisable(u: UserProfile) {
    const disabling = u.status === 'active'
    if (!window.confirm(disabling ? 'Disable this user?' : 'Re-enable this user?')) return
    try { await callDisableUser(u.id, disabling); await fetchPage(null, 0) }
    catch (err: unknown) { setError(formatFirebaseError(err, 'Failed')) }
  }

  async function resetPassword(u: UserProfile) {
    if (!window.confirm(`Reset password for ${u.email}?`)) return
    setCreatedPw('')
    try { const res = await callResetPassword(u.id); setCreatedPw(res.temporaryPassword) }
    catch (err: unknown) { setError(formatFirebaseError(err, 'Failed')) }
  }

  function CourseSelector({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
    if (courses.length === 0) return <p className="muted small">No courses yet.</p>
    return (
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {courses.map((c) => (
          <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.9rem' }}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleCourse(selected, c.id, onChange)} />
            {c.title}
          </label>
        ))}
      </div>
    )
  }

  const courseLabel = (cids: string[]) =>
    cids.map((cid) => courses.find((c) => c.id === cid)?.title).filter(Boolean).join(', ')

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>User Management</h1>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="page-stat">{users.length}{hasMore ? '+' : ''} users</span>
            <span className="muted small">Create accounts and manage roles</span>
          </div>
        </div>
        <button className="btn primary" onClick={() => { setShowCreate((v) => !v); setError('') }}>
          {showCreate ? '✕ Cancel' : '+ New User'}
        </button>
      </div>

      {error ? <p className="error" style={{ marginBottom: '1rem' }}>{error}</p> : null}
      {createdPw ? <div className="notice" style={{ marginBottom: '1rem' }}><strong>Temporary password (copy now):</strong> {createdPw}</div> : null}

      {/* Create form */}
      {showCreate && (
        <section className="panel" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>Create User</h2>
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
                value={createTempPassword}
                onChange={(e) => setCreateTempPassword(e.target.value)}
                placeholder="Min 8 characters or leave blank"
              />
            </div>
            <div className="full">
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.35rem' }}>Roles</div>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {ROLE_OPTIONS.map((r) => (
                  <label key={r} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
                    <input type="checkbox" checked={createRoles.includes(r)} onChange={() => toggleRole(createRoles, r, setCreateRoles)} />
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </label>
                ))}
              </div>
            </div>
            {createRoles.includes('student') && (
              <div className="full">
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.35rem' }}>Assign Courses</div>
                <CourseSelector selected={createCourseIds} onChange={setCreateCourseIds} />
              </div>
            )}
            <div className="full">
              <button type="submit" className="btn primary" disabled={creatingUser}>
                {creatingUser ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Filter bar */}
      <div className="filter-bar">
        <input
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={roleFilter} onChange={(e) => setRoleFilter((e.target.value || '') as Role | '')}>
          <option value="">All roles</option>
          <option value="admin">Admin</option>
          <option value="mentor">Mentor</option>
          <option value="student">Student</option>
        </select>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginLeft: 'auto' }}>
          <button className="btn small secondary" disabled={loadingPage || pageIndex === 0} onClick={() => void fetchPage(null, 0)}>← First</button>
          <button className="btn small primary" disabled={loadingPage || !hasMore || !lastDoc} onClick={() => void fetchPage(lastDoc, pageIndex + 1)}>Next →</button>
          <span className="muted small" style={{ whiteSpace: 'nowrap' }}>
            Page {pageIndex + 1}{loadingPage ? ' · Loading…' : ''}
          </span>
        </div>
      </div>

      {loading && !loadingPage ? <p className="muted">Loading…</p> : null}

      {/* User card grid */}
      <div className="user-grid">
        {displayed.map((u) => (
          <div key={u.id} className="user-card">
            <div className="user-card-body">
              <div className="user-card-top">
                <div className={avatarClass(u.roles)}>{(u.name || u.email).charAt(0).toUpperCase()}</div>
                <div className="user-card-info">
                  <div className="user-card-name">{u.name || '—'}</div>
                  <div className="user-card-email">{u.email}</div>
                </div>
                <span className={`tag ${u.status === 'active' ? '' : 'danger'}`} style={{ flexShrink: 0 }}>
                  {u.status}
                </span>
              </div>
              <div className="user-card-chips">
                {u.roles.map((r) => <span key={r} className={`role-chip ${r}`}>{r}</span>)}
              </div>
              {(u.courseIds ?? []).length > 0 && (
                <div className="user-card-courses">📘 {courseLabel(u.courseIds ?? [])}</div>
              )}
            </div>
            <div className="user-card-footer">
              <button type="button" className="btn small secondary" onClick={() => startEdit(u)}>Edit</button>
              <button type="button" className="btn small secondary" onClick={() => void resetPassword(u)}>Reset PW</button>
              <button type="button" className="btn small secondary" onClick={() => void toggleDisable(u)}>
                {u.status === 'active' ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>
        ))}
        {displayed.length === 0 && !loading && (
          <p className="muted" style={{ gridColumn: '1/-1', padding: '2rem 0' }}>No users found.</p>
        )}
      </div>

      {/* Edit modal */}
      {editId && (
        <div className="modal-backdrop" onClick={() => setEditId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: '1rem' }}>Edit User</h2>
            <form className="form" onSubmit={saveEdit}>
              <label>Name<input value={editName} onChange={(e) => setEditName(e.target.value)} required /></label>
              <label>Email<input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required /></label>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.35rem' }}>Roles</div>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  {ROLE_OPTIONS.map((r) => (
                    <label key={r} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
                      <input type="checkbox" checked={editRoles.includes(r)} onChange={() => toggleRole(editRoles, r, setEditRoles)} />
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
              {editRoles.includes('student') && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.35rem' }}>Assigned Courses</div>
                  <CourseSelector selected={editCourseIds} onChange={setEditCourseIds} />
                </div>
              )}
              <div className="row">
                <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                <button type="button" className="btn secondary" onClick={() => setEditId(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
