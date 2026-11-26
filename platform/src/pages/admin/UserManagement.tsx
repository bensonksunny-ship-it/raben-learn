import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  collection, getDocs, limit, orderBy, query, startAfter, where,
  type QueryConstraint, type QueryDocumentSnapshot, type DocumentData,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { callCreateUser, callDeleteUser, callDisableUser, callSetPassword, callUpdateUser } from '../../lib/adminGcfCallables'
import { formatFirebaseError } from '../../lib/formatFirebaseError'
import { mapUserDoc, avatarClass } from '../../lib/userUtils'
import { mapCourseDoc } from '../../lib/courses'
import { useAuth } from '../../context/AuthContext'
import type { Course, Role, UserProfile } from '../../types'
import { EmptyState } from '../../components/EmptyState'

const PAGE_SIZE = 20
// Manager now has full access to everything else — granting, seeing, or
// touching an *admin* account is the one line it can't cross.
const ELEVATED_ROLES: Role[] = ['admin']

/** A manager can't see, target, or grant admin accounts — only admin can. */
function isElevated(roles: Role[]): boolean {
  return roles.some((r) => ELEVATED_ROLES.includes(r))
}

/** Checkbox/label display only — the stored role string itself stays the short 'consultant'. */
function roleLabel(r: Role): string {
  if (r === 'consultant') return 'Academic Consultant'
  if (r === 'mentor') return 'Teacher'
  return r.charAt(0).toUpperCase() + r.slice(1)
}

export function UserManagement() {
  const { profile } = useAuth()
  const isAdminActor = Boolean(profile?.roles.includes('admin'))
  // A manager who is *also* admin keeps full admin power — only restrict a manager-only actor.
  const isManagerOnly = !isAdminActor && Boolean(profile?.roles.includes('manager'))
  // Only the admin role itself is off-limits to a manager-only actor now.
  const roleOptions: Role[] = isManagerOnly
    ? ['mentor', 'student', 'consultant', 'manager', 'founder']
    : ['admin', 'mentor', 'student', 'manager', 'consultant', 'founder']

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
  const [createInitialPassword, setCreateInitialPassword] = useState('')
  const [creatingUser, setCreatingUser] = useState(false)
  const [createdPw, setCreatedPw] = useState('')

  const [setPwUserId, setSetPwUserId] = useState<string | null>(null)
  const [setPwValue, setSetPwValue] = useState('')
  const [settingPw, setSettingPw] = useState(false)

  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRoles, setEditRoles] = useState<Role[]>(['student'])
  const [editCourseIds, setEditCourseIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // The row a user clicked — email and every action live behind it, not on the list.
  const [detailUserId, setDetailUserId] = useState<string | null>(null)

  useEffect(() => {
    void getDocs(collection(db, 'courses')).then((snap) => {
      const list: Course[] = []
      snap.forEach((d) => list.push(mapCourseDoc(d)))
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
    return users
      .filter((u) => !isManagerOnly || !isElevated(u.roles))
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [users, search, isManagerOnly])

  function toggleRole(roles: Role[], r: Role, setter: (v: Role[]) => void) {
    setter(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])
  }

  function toggleCourse(ids: string[], cid: string, setter: (v: string[]) => void) {
    setter(ids.includes(cid) ? ids.filter((x) => x !== cid) : [...ids, cid])
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault(); setError(''); setCreatedPw('')
    if (createRoles.length === 0) { setError('Select at least one role.'); return }
    const pw = createInitialPassword.trim()
    if (pw.length > 0 && pw.length < 8) { setError('Password must be at least 8 characters.'); return }
    setCreatingUser(true)
    try {
      const res = await callCreateUser({
        name, email, roles: createRoles,
        centreIds: [], centreId: null,
        courseId: createCourseIds[0] ?? null,
        initialPassword: pw || null,
      })
      setCreatedPw(res.password)
      setName(''); setEmail(''); setCreateCourseIds([]); setCreateInitialPassword('')
      setShowCreate(false)
      await fetchPage(null, 0)
    } catch (err: unknown) {
      setError(formatFirebaseError(err, 'Create failed'))
    } finally { setCreatingUser(false) }
  }

  function startEdit(u: UserProfile) {
    // Defense in depth — `displayed` already hides admin/manager rows from a
    // manager-only actor, so this only matters if local state went stale.
    if (isManagerOnly && isElevated(u.roles)) { setError('Only an admin can edit this account.'); return }
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
    if (isManagerOnly && isElevated(u.roles)) { setError('Only an admin can disable this account.'); return }
    const disabling = u.status === 'active'
    if (!window.confirm(disabling ? 'Disable this user?' : 'Re-enable this user?')) return
    setError('')
    try {
      await callDisableUser(u.id, disabling)
      const nextStatus: UserProfile['status'] = disabling ? 'disabled' : 'active'
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, status: nextStatus } : x)))
    } catch (err: unknown) { setError(formatFirebaseError(err, 'Failed')) }
  }

  async function deleteUser(u: UserProfile) {
    if (isManagerOnly && isElevated(u.roles)) { setError('Only an admin can delete this account.'); return }
    if (!window.confirm(`Permanently delete ${u.name || u.email}? This cannot be undone.`)) return
    setError('')
    try {
      await callDeleteUser(u.id)
      setUsers((prev) => prev.filter((x) => x.id !== u.id))
    } catch (err: unknown) { setError(formatFirebaseError(err, 'Delete failed')) }
  }

  function openSetPassword(u: UserProfile) {
    if (isManagerOnly && isElevated(u.roles)) { setError('Only an admin can set this account\'s password.'); return }
    setError(''); setSetPwUserId(u.id); setSetPwValue('')
  }

  async function submitSetPassword(e: FormEvent) {
    e.preventDefault()
    if (!setPwUserId) return
    const pw = setPwValue.trim()
    if (pw.length > 0 && pw.length < 8) { setError('Password must be at least 8 characters.'); return }
    setSettingPw(true); setError(''); setCreatedPw('')
    try {
      const res = await callSetPassword(setPwUserId, pw || undefined)
      setCreatedPw(res.password)
      setSetPwUserId(null); setSetPwValue('')
    } catch (err: unknown) {
      setError(formatFirebaseError(err, 'Failed'))
    } finally {
      setSettingPw(false)
    }
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

  const detailUser = detailUserId ? displayed.find((u) => u.id === detailUserId) ?? null : null

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Users</h1>
        <button className="btn primary" onClick={() => { setShowCreate((v) => !v); setError('') }}>
          {showCreate ? '✕ Cancel' : '+ New User'}
        </button>
      </div>

      {error ? <p className="error" style={{ marginBottom: '1rem' }}>{error}</p> : null}
      {createdPw ? <div className="notice" style={{ marginBottom: '1rem' }}><strong>Password:</strong> {createdPw}</div> : null}

      {/* Create form */}
      {showCreate && (
        <section className="panel" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>New User</h2>
          <form className="form grid" onSubmit={onCreate}>
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <div className="full">
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.35rem' }}>Password</div>
              <input
                type="password"
                autoComplete="new-password"
                value={createInitialPassword}
                onChange={(e) => setCreateInitialPassword(e.target.value)}
                placeholder="Auto-generate"
              />
            </div>
            <div className="full">
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.35rem' }}>Roles</div>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {roleOptions.map((r) => (
                  <label key={r} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
                    <input type="checkbox" checked={createRoles.includes(r)} onChange={() => toggleRole(createRoles, r, setCreateRoles)} />
                    {roleLabel(r)}
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
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={roleFilter} onChange={(e) => setRoleFilter((e.target.value || '') as Role | '')}>
          <option value="">All</option>
          {!isManagerOnly && <option value="admin">Admin</option>}
          <option value="manager">Manager</option>
          <option value="mentor">Teacher</option>
          <option value="student">Student</option>
          <option value="consultant">Academic Consultant</option>
          <option value="founder">Founder</option>
        </select>
      </div>

      {loading && !loadingPage ? <p className="muted">Loading…</p> : null}

      <div className="user-list">
        {displayed.map((u) => (
          <button key={u.id} type="button" className="user-row" onClick={() => setDetailUserId(u.id)}>
            <div className={avatarClass(u.roles)}>{(u.name || u.email).charAt(0).toUpperCase()}</div>
            <span className="user-row-name">{u.name || u.email}</span>
            <span className="user-row-tags">
              {u.roles.map((r) => <span key={r} className={`role-chip ${r}`}>{roleLabel(r)}</span>)}
              {u.status !== 'active' && <span className="tag danger">Disabled</span>}
            </span>
          </button>
        ))}
        {displayed.length === 0 && !loading && <EmptyState title="No users" />}
      </div>

      {(pageIndex > 0 || hasMore) && (
        <div className="row" style={{ justifyContent: 'center', marginTop: '1.25rem', gap: '0.5rem' }}>
          <button className="btn small secondary" disabled={loadingPage || pageIndex === 0} onClick={() => void fetchPage(null, 0)}>←</button>
          <button className="btn small secondary" disabled={loadingPage || !hasMore || !lastDoc} onClick={() => void fetchPage(lastDoc, pageIndex + 1)}>→</button>
        </div>
      )}

      {detailUser && (
        <div className="modal-backdrop" onClick={() => setDetailUserId(null)}>
          <div className="modal" style={{ maxWidth: 820, width: '94%', minHeight: '60vh', padding: '3rem', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1.25rem', marginBottom: '2.5rem' }}>
              <div style={{ display: 'flex', gap: '1.1rem', alignItems: 'center', minWidth: 0 }}>
                <div className={avatarClass(detailUser.roles)} style={{ width: 96, height: 96, fontSize: '2.4rem' }}>
                  {(detailUser.name || detailUser.email).charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h1 style={{ margin: '0 0 0.4rem', fontSize: '2rem' }}>{detailUser.name || '—'}</h1>
                  <div className="muted" style={{ overflowWrap: 'anywhere', fontSize: '1.15rem' }}>{detailUser.email}</div>
                </div>
              </div>
              <button type="button" className="btn ghost" onClick={() => setDetailUserId(null)}>✕</button>
            </div>
            <div className="row" style={{ gap: '0.6rem', marginBottom: '2.5rem' }}>
              {detailUser.roles.map((r) => <span key={r} className={`role-chip ${r}`} style={{ fontSize: '0.95rem', padding: '0.45rem 1.1rem' }}>{roleLabel(r)}</span>)}
              {detailUser.status !== 'active' && <span className="tag danger">Disabled</span>}
            </div>
            <div className="row" style={{ gap: '1rem', flexWrap: 'wrap', marginTop: 'auto' }}>
              <button type="button" className="btn secondary" style={{ padding: '0.85rem 1.6rem', fontSize: '1.05rem' }} onClick={() => { setDetailUserId(null); startEdit(detailUser) }}>Edit</button>
              <button type="button" className="btn secondary" style={{ padding: '0.85rem 1.6rem', fontSize: '1.05rem' }} onClick={() => { setDetailUserId(null); openSetPassword(detailUser) }}>Password</button>
              <button type="button" className="btn secondary" style={{ padding: '0.85rem 1.6rem', fontSize: '1.05rem' }} onClick={() => { setDetailUserId(null); void toggleDisable(detailUser) }}>
                {detailUser.status === 'active' ? 'Disable' : 'Enable'}
              </button>
              <button type="button" className="btn secondary" style={{ color: 'var(--danger)', marginLeft: 'auto', padding: '0.85rem 1.6rem', fontSize: '1.05rem' }} onClick={() => { setDetailUserId(null); void deleteUser(detailUser) }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

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
                  {roleOptions.map((r) => (
                    <label key={r} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
                      <input type="checkbox" checked={editRoles.includes(r)} onChange={() => toggleRole(editRoles, r, setEditRoles)} />
                      {roleLabel(r)}
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

      {/* Set Password modal — leave blank to generate one to show once, same
          as account creation; either way it's a permanent password, never a
          forced-change flag. */}
      {setPwUserId && (
        <div className="modal-backdrop" onClick={() => setSetPwUserId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: '1rem' }}>Password</h2>
            <form className="form" onSubmit={(e) => void submitSetPassword(e)}>
              <label>
                New password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={setPwValue}
                  onChange={(e) => setSetPwValue(e.target.value)}
                  placeholder="Auto-generate"
                />
              </label>
              <div className="row">
                <button type="submit" className="btn primary" disabled={settingPw}>{settingPw ? 'Saving…' : 'Save'}</button>
                <button type="button" className="btn secondary" onClick={() => setSetPwUserId(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
