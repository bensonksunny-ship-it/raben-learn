import { httpsCallableFromURL } from 'firebase/functions'
import { functions, auth, FIREBASE_PROJECT_ID, FIREBASE_FUNCTIONS_REGION } from '../firebase/config'
import { getCallableErrorDiagnostics } from './callableErrorDetails'
import type { Role } from '../types'

/**
 * Official callable HTTPS endpoint for 2nd gen (same host the JS SDK resolves to when region is set).
 * Using it explicitly avoids rare resolution issues that surface as `functions/internal`.
 */
function callableHttpsUrl(functionName: string) {
  return `https://${FIREBASE_FUNCTIONS_REGION}-${FIREBASE_PROJECT_ID}.cloudfunctions.net/${functionName}`
}

/** Fresh ID token avoids rare callable failures when the session is stale. */
async function ensureFreshIdToken(): Promise<void> {
  const user = auth.currentUser
  if (!user) return
  await user.getIdToken(true)
}

export interface CreateUserPayload {
  name: string
  email: string
  roles: Role[]
  centreIds: string[]
  centreId: string | null
  courseId: string | null
  temporaryPassword?: string | null
}

export interface CreateUserResult {
  uid: string
  temporaryPassword: string
}

export type UpdateUserPayload = {
  uid: string
  name?: string
  email?: string
  roles?: Role[]
  centreIds?: string[]
  centreId?: string | null
  courseId?: string | null
  status?: 'active' | 'disabled'
}

const adminCreateUser = httpsCallableFromURL(functions, callableHttpsUrl('adminCreateUser'))
const adminUpdateUser = httpsCallableFromURL(functions, callableHttpsUrl('adminUpdateUser'))
const adminDisableUser = httpsCallableFromURL(functions, callableHttpsUrl('adminDisableUser'))
const adminResetPassword = httpsCallableFromURL(functions, callableHttpsUrl('adminResetPassword'))

export async function callCreateUser(payload: CreateUserPayload): Promise<CreateUserResult> {
  const user = auth.currentUser
  if (!user) {
    console.error('[callCreateUser] Not authenticated')
    throw new Error('You must be signed in to create users.')
  }
  console.log('[callCreateUser] Authenticated user:', user.email)
  try {
    await ensureFreshIdToken()
    const res = await adminCreateUser(payload)
    return res.data as CreateUserResult
  } catch (err) {
    console.error('[callCreateUser] Error:', getCallableErrorDiagnostics(err))
    throw err
  }
}

export async function callUpdateUser(payload: UpdateUserPayload) {
  await ensureFreshIdToken()
  const res = await adminUpdateUser(payload)
  return res.data as { ok: boolean }
}

export async function callDisableUser(uid: string, disabled: boolean) {
  await ensureFreshIdToken()
  const res = await adminDisableUser({ uid, disabled })
  return res.data as { ok: boolean }
}

export async function callResetPassword(uid: string): Promise<{ temporaryPassword: string }> {
  await ensureFreshIdToken()
  const res = await adminResetPassword({ uid })
  return res.data as { temporaryPassword: string }
}
