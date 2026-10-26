import * as admin from 'firebase-admin'
import { randomUUID } from 'crypto'
import { setGlobalOptions } from 'firebase-functions/v2'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'

/** Must match client `getFunctions(app, region)` / `VITE_FIREBASE_FUNCTIONS_REGION`. */
const CALLABLE_REGION = 'us-central1'

setGlobalOptions({
  region: CALLABLE_REGION,
  invoker: 'public',
})

admin.initializeApp()
const db = admin.firestore()
const auth = admin.auth()

const VALID_ROLES = ['admin', 'mentor', 'student', 'manager', 'consultant'] as const
type Role = (typeof VALID_ROLES)[number]
const ELEVATED_ROLES: Role[] = ['admin', 'manager']

function isNonEmptyString(v: unknown, max = 500): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max
}

function validateEmail(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email')
  }
}

function validateRoles(input: unknown): Role[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new HttpsError('invalid-argument', 'roles must be a non-empty array')
  }
  const set = new Set<string>()
  for (const r of input) {
    if (typeof r !== 'string' || !VALID_ROLES.includes(r as Role)) {
      throw new HttpsError('invalid-argument', `Invalid role: ${String(r)}`)
    }
    set.add(r)
  }
  return [...set] as Role[]
}

/** Legacy docs may have unknown role strings; drop invalid entries. */
function coerceRoles(data: admin.firestore.DocumentData | undefined): Role[] {
  const raw = normalizeRolesFromDoc(data)
  const out = raw.filter((r): r is Role => VALID_ROLES.includes(r as Role))
  return out.length ? (out as Role[]) : ['student']
}

function normalizeRolesFromDoc(data: admin.firestore.DocumentData | undefined): string[] {
  if (data?.roles && Array.isArray(data.roles)) return data.roles as string[]
  if (data?.role) return [data.role as string]
  return []
}

async function assertAdmin(uid: string) {
  const snap = await db.doc(`users/${uid}`).get()
  const roles = coerceRoles(snap.data())
  const status = snap.data()?.status
  console.log(`[assertAdmin] uid=${uid}, exists=${snap.exists}, roles=${JSON.stringify(roles)}, status=${status}`)
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'Admin only: user doc not found')
  }
  if (!roles.includes('admin')) {
    throw new HttpsError('permission-denied', `Admin only: missing admin role (has: ${roles.join(',')})`)
  }
  if (status !== 'active') {
    throw new HttpsError('permission-denied', `Admin only: status is "${status}" not "active"`)
  }
}

/**
 * Admin or manager may call the user-management callables. Manager is deliberately
 * narrow — see `assertRolesAllowedForManager` / `assertTargetNotElevated` below, which
 * every manager-reachable callable must also apply. Admin keeps full, unrestricted access.
 */
async function assertUserManagerAccess(uid: string): Promise<'admin' | 'manager'> {
  const snap = await db.doc(`users/${uid}`).get()
  const roles = coerceRoles(snap.data())
  const status = snap.data()?.status
  console.log(`[assertUserManagerAccess] uid=${uid}, exists=${snap.exists}, roles=${JSON.stringify(roles)}, status=${status}`)
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'Admin or manager only: user doc not found')
  }
  if (status !== 'active') {
    throw new HttpsError('permission-denied', `Admin or manager only: status is "${status}" not "active"`)
  }
  if (roles.includes('admin')) return 'admin'
  if (roles.includes('manager')) return 'manager'
  throw new HttpsError('permission-denied', `Admin or manager only: missing role (has: ${roles.join(',')})`)
}

/** A manager can never grant admin/manager — only an admin can. */
function assertRolesAllowedForManager(actorRole: 'admin' | 'manager', roles: Role[]) {
  if (actorRole === 'manager' && roles.some((r) => ELEVATED_ROLES.includes(r))) {
    throw new HttpsError('permission-denied', 'Managers cannot grant the admin or manager role')
  }
}

/** A manager can never act on an existing admin/manager account — only an admin can. */
async function assertTargetNotElevated(actorRole: 'admin' | 'manager', targetUid: string) {
  if (actorRole !== 'manager') return
  const snap = await db.doc(`users/${targetUid}`).get()
  const roles = coerceRoles(snap.data())
  if (roles.some((r) => ELEVATED_ROLES.includes(r))) {
    throw new HttpsError('permission-denied', 'Managers cannot modify admin or manager accounts')
  }
}

/**
 * Gen2 callables on Cloud Run. Use `cors: true` (all origins) for callable protocol — Firebase adds the
 * right headers; a restrictive list can break OPTIONS preflight for some dev URLs.
 * `invoker: 'public'` is required or browsers see CORS errors / `functions/internal` (403 without ACAO).
 */
const callableOpts = {
  region: CALLABLE_REGION,
  invoker: 'public' as const,
  cors: true,
  enforceAppCheck: false,
  ingressSettings: 'ALLOW_ALL' as const,
  memory: '512MiB' as const,
  timeoutSeconds: 120,
}

function randomNumericPassword() {
  return String(Math.floor(10000000 + Math.random() * 90000000))
}

/** Firebase strips client-visible messages for `internal` — never use it for actionable errors. */
function getFirebaseAuthErrorCode(e: unknown): string {
  if (!e || typeof e !== 'object') return ''
  const o = e as Record<string, unknown>
  if (typeof o.code === 'string') return o.code
  const ei = o.errorInfo
  if (ei && typeof ei === 'object' && typeof (ei as Record<string, unknown>).code === 'string') {
    return (ei as Record<string, unknown>).code as string
  }
  return ''
}

function throwFromAuthCreateFailure(e: unknown): never {
  const code = getFirebaseAuthErrorCode(e)
  const msg = e instanceof Error ? e.message : String(e)
  console.error('auth.createUser failed', code, msg)

  switch (code) {
    case 'auth/email-already-exists':
      throw new HttpsError('already-exists', 'A user with this email already exists')
    case 'auth/invalid-email':
      throw new HttpsError('invalid-argument', 'Invalid email')
    case 'auth/invalid-password':
    case 'auth/weak-password':
      throw new HttpsError('invalid-argument', 'Password does not meet Firebase Auth requirements')
    case 'auth/operation-not-allowed':
      throw new HttpsError('failed-precondition', 'Email/password sign-in is not enabled for this project')
    default:
      throw new HttpsError(
        'failed-precondition',
        `Could not create Auth user${code ? ` (${code})` : ''}: ${msg.slice(0, 220)}`,
      )
  }
}

async function syncMentorCentres(mentorId: string, centreIds: string[]) {
  const existing = await db.collection('mentor_centres').where('mentorId', '==', mentorId).get()
  const batch = db.batch()
  existing.forEach((d) => batch.delete(d.ref))
  centreIds.forEach((centreId) => {
    const ref = db.collection('mentor_centres').doc()
    batch.set(ref, { mentorId, centreId })
  })
  await batch.commit()
  await db.doc(`users/${mentorId}`).set({ centreIds }, { merge: true })
}

async function clearMentorCentres(uid: string) {
  const existing = await db.collection('mentor_centres').where('mentorId', '==', uid).get()
  const batch = db.batch()
  existing.forEach((d) => batch.delete(d.ref))
  if (!existing.empty) await batch.commit()
  await db.doc(`users/${uid}`).set({ centreIds: [] }, { merge: true })
}

export const adminCreateUser = onCall(callableOpts, async (request) => {
  console.info('adminCreateUser invoked', { hasAuth: Boolean(request.auth?.uid) })
  try {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required')
  }
  const actorRole = await assertUserManagerAccess(request.auth.uid)

  const data = request.data as {
    name?: unknown
    email?: unknown
    roles?: unknown
    centreIds?: unknown
    centreId?: unknown
    courseId?: unknown
    temporaryPassword?: unknown
  }

  if (!isNonEmptyString(data.name, 200)) {
    throw new HttpsError('invalid-argument', 'Invalid name')
  }
  if (!isNonEmptyString(data.email, 320)) {
    throw new HttpsError('invalid-argument', 'Invalid email')
  }
  validateEmail(data.email.trim())

  const roles = validateRoles(data.roles)
  assertRolesAllowedForManager(actorRole, roles)
  const centreIds = Array.isArray(data.centreIds)
    ? data.centreIds.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length < 200)
    : []
  const centreId =
    data.centreId === null || data.centreId === undefined
      ? null
      : typeof data.centreId === 'string'
        ? data.centreId
        : null
  const courseId =
    data.courseId === null || data.courseId === undefined
      ? null
      : typeof data.courseId === 'string'
        ? data.courseId
        : null

  const password =
    typeof data.temporaryPassword === 'string' && data.temporaryPassword.trim().length > 0
      ? data.temporaryPassword.trim()
      : randomNumericPassword()
  if (password.length < 8) {
    throw new HttpsError('invalid-argument', 'Temporary password must be at least 8 characters')
  }
  let userRecord: admin.auth.UserRecord
  try {
    userRecord = await auth.createUser({
      email: data.email.trim(),
      password,
      displayName: data.name.trim(),
    })
  } catch (e: unknown) {
    throwFromAuthCreateFailure(e)
  }

  const uid = userRecord.uid

  try {
    await db.doc(`users/${uid}`).set({
      name: data.name.trim(),
      email: data.email.trim(),
      roles,
      status: 'active',
      firstLogin: true,
      createdAt: FieldValue.serverTimestamp(),
      centreIds: roles.includes('mentor') ? centreIds : [],
      centreId: roles.includes('student') ? centreId : null,
      courseId: roles.includes('student') ? courseId : null,
      ...(roles.includes('student') && courseId ? { courseIds: [courseId] } : {}),
      // ID-card QR payload — generated once here (student accounts only), never
      // client-supplied, so it's not trivially guessable. See adminUpdateUser's
      // `generateQrToken` for backfilling an account created before this existed.
      qrToken: roles.includes('student') ? randomUUID() : null,
    })

    if (roles.includes('mentor')) {
      await syncMentorCentres(uid, centreIds)
    } else {
      await clearMentorCentres(uid)
    }

    if (roles.includes('student')) {
      await db.doc(`students/${uid}`).set({
        studentId: uid,
        centreId: centreId ?? '',
        courseId: courseId ?? null,
        progressPercentage: 0,
        completedCount: 0,
        totalCount: 0,
      })
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('adminCreateUser Firestore failed; rolling back Auth user', uid, e)
    try {
      await auth.deleteUser(uid)
    } catch (delErr) {
      console.error('adminCreateUser rollback deleteUser failed', delErr)
    }
    throw new HttpsError(
      'failed-precondition',
      `User was not saved (Firestore): ${msg.slice(0, 240)}`,
    )
  }

  return { uid, temporaryPassword: password }
  } catch (e: unknown) {
    if (e instanceof HttpsError) throw e
    console.error('adminCreateUser unexpected error', e)
    const msg = e instanceof Error ? e.message : String(e)
    throw new HttpsError('failed-precondition', `Create user failed: ${msg.slice(0, 380)}`)
  }
})

export const adminUpdateUser = onCall(callableOpts, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required')
  }
  const actorRole = await assertUserManagerAccess(request.auth.uid)

  const payload = request.data as {
    uid?: unknown
    name?: unknown
    email?: unknown
    roles?: unknown
    centreIds?: unknown
    centreId?: unknown
    courseId?: unknown
    courseIds?: unknown
    status?: unknown
    /** True to (re)generate this student's ID-card QR token — the Students page's
     *  "ID Card" button sends this for an account created before `qrToken` existed. */
    generateQrToken?: unknown
  }

  if (!isNonEmptyString(payload.uid, 128)) {
    throw new HttpsError('invalid-argument', 'Invalid uid')
  }
  const uid = payload.uid.trim()

  const userSnap = await db.doc(`users/${uid}`).get()
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'User not found')
  }

  const prevRoles = coerceRoles(userSnap.data())
  if (actorRole === 'manager' && prevRoles.some((r) => ELEVATED_ROLES.includes(r))) {
    throw new HttpsError('permission-denied', 'Managers cannot modify admin or manager accounts')
  }
  if (payload.roles !== undefined) {
    assertRolesAllowedForManager(actorRole, validateRoles(payload.roles))
  }

  if (payload.email !== undefined) {
    if (!isNonEmptyString(payload.email, 320)) {
      throw new HttpsError('invalid-argument', 'Invalid email')
    }
    validateEmail(payload.email.trim())
    await auth.updateUser(uid, { email: payload.email.trim() })
  }

  const nextPatch: Record<string, unknown> = {}
  if (payload.name !== undefined) {
    if (!isNonEmptyString(payload.name, 200)) throw new HttpsError('invalid-argument', 'Invalid name')
    nextPatch.name = payload.name.trim()
  }
  if (payload.roles !== undefined) {
    nextPatch.roles = validateRoles(payload.roles)
  }
  if (payload.status !== undefined) {
    if (payload.status !== 'active' && payload.status !== 'disabled') {
      throw new HttpsError('invalid-argument', 'Invalid status')
    }
    nextPatch.status = payload.status
  }
  if (payload.centreIds !== undefined) {
    nextPatch.centreIds = Array.isArray(payload.centreIds)
      ? payload.centreIds.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length < 200)
      : []
  }
  if (payload.centreId !== undefined) {
    nextPatch.centreId =
      payload.centreId === null ? null : typeof payload.centreId === 'string' ? payload.centreId : null
  }
  if (payload.courseIds !== undefined) {
    const ids = Array.isArray(payload.courseIds)
      ? (payload.courseIds as unknown[]).filter((c): c is string => typeof c === 'string' && c.length > 0)
      : []
    nextPatch.courseIds = ids
    nextPatch.courseId = ids[0] ?? null
  } else if (payload.courseId !== undefined) {
    const cid = payload.courseId === null ? null : typeof payload.courseId === 'string' ? payload.courseId : null
    nextPatch.courseId = cid
    nextPatch.courseIds = cid ? [cid] : []
  }
  if (payload.generateQrToken === true) {
    nextPatch.qrToken = randomUUID()
  }

  nextPatch.role = FieldValue.delete()

  await db.doc(`users/${uid}`).set(nextPatch, { merge: true })

  const afterSnap = await db.doc(`users/${uid}`).get()
  const afterData = afterSnap.data()
  if (!afterData) {
    throw new HttpsError('failed-precondition', 'User document missing after update')
  }
  const nextRoles = coerceRoles(afterData)
  const centreIdsAfter = (afterData.centreIds as string[]) ?? []

  if (nextRoles.includes('mentor')) {
    await syncMentorCentres(uid, centreIdsAfter)
  } else {
    await clearMentorCentres(uid)
  }

  const hadStudent = prevRoles.includes('student')
  const hasStudent = nextRoles.includes('student')
  if (hadStudent && !hasStudent) {
    await db.doc(`students/${uid}`).delete().catch(() => undefined)
  }

  if (hasStudent) {
    const centreIdVal = (afterData.centreId as string) ?? ''
    const courseIdVal = (afterData.courseId as string) ?? null
    if (!hadStudent) {
      await db.doc(`students/${uid}`).set({
        studentId: uid,
        centreId: centreIdVal,
        courseId: courseIdVal,
        progressPercentage: 0,
        completedCount: 0,
        totalCount: 0,
      })
    } else {
      await db.doc(`students/${uid}`).set(
        {
          studentId: uid,
          centreId: centreIdVal,
          courseId: courseIdVal,
        },
        { merge: true },
      )
    }
  }

  if (payload.status === 'disabled') {
    await auth.updateUser(uid, { disabled: true })
  } else if (payload.status === 'active') {
    await auth.updateUser(uid, { disabled: false })
  }

  return { ok: true }
})

export const adminDisableUser = onCall(callableOpts, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required')
  }
  const actorRole = await assertUserManagerAccess(request.auth.uid)

  const { uid, disabled } = request.data as { uid?: unknown; disabled?: unknown }
  if (!isNonEmptyString(uid, 128) || typeof disabled !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Invalid payload')
  }
  const targetUid = uid.trim()
  await assertTargetNotElevated(actorRole, targetUid)

  await auth.updateUser(targetUid, { disabled })
  await db.doc(`users/${targetUid}`).set({ status: disabled ? 'disabled' : 'active' }, { merge: true })

  return { ok: true }
})

export const adminDeleteUser = onCall(callableOpts, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required')
  }
  await assertAdmin(request.auth.uid)

  const { uid } = request.data as { uid?: unknown }
  if (!isNonEmptyString(uid, 128)) {
    throw new HttpsError('invalid-argument', 'Invalid uid')
  }
  const targetUid = uid.trim()

  if (targetUid === request.auth.uid) {
    throw new HttpsError('failed-precondition', 'Cannot delete your own account')
  }

  try {
    await auth.deleteUser(targetUid)
  } catch (e: unknown) {
    if (getFirebaseAuthErrorCode(e) !== 'auth/user-not-found') throw e
  }

  const batch = db.batch()
  batch.delete(db.doc(`users/${targetUid}`))
  batch.delete(db.doc(`students/${targetUid}`))
  await batch.commit()

  const centres = await db.collection('mentor_centres').where('mentorId', '==', targetUid).get()
  if (!centres.empty) {
    const b2 = db.batch()
    centres.forEach((d) => b2.delete(d.ref))
    await b2.commit()
  }

  return { ok: true }
})

export const adminResetPassword = onCall(callableOpts, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required')
  }
  const actorRole = await assertUserManagerAccess(request.auth.uid)

  const raw = request.data as { uid?: unknown }
  if (!isNonEmptyString(raw.uid, 128)) {
    throw new HttpsError('invalid-argument', 'Invalid uid')
  }
  const uid = raw.uid.trim()

  const userSnap = await db.doc(`users/${uid}`).get()
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'User not found')
  }
  if (actorRole === 'manager' && coerceRoles(userSnap.data()).some((r) => ELEVATED_ROLES.includes(r))) {
    throw new HttpsError('permission-denied', 'Managers cannot reset an admin or manager account\'s password')
  }

  const password = randomNumericPassword()
  await auth.updateUser(uid, { password })
  await db.doc(`users/${uid}`).set({ firstLogin: true }, { merge: true })

  return { temporaryPassword: password }
})
