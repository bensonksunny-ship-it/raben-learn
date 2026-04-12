import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/config'
import type { Role } from '../types'

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

// Use the SDK’s normal callable wiring (`getFunctions(app, region)` in `firebase/config.ts`).
// Custom `httpsCallableFromURL` + `*.cloudfunctions.net/...` URLs can fail against Functions v2 (Gen2)
// and surface as `functions/internal` even when the function is deployed.
const adminCreateUser = httpsCallable(functions, 'adminCreateUser')
const adminUpdateUser = httpsCallable(functions, 'adminUpdateUser')
const adminDisableUser = httpsCallable(functions, 'adminDisableUser')
const adminResetPassword = httpsCallable(functions, 'adminResetPassword')

export async function callCreateUser(payload: CreateUserPayload): Promise<CreateUserResult> {
  const res = await adminCreateUser(payload)
  return res.data as CreateUserResult
}

export async function callUpdateUser(payload: UpdateUserPayload) {
  const res = await adminUpdateUser(payload)
  return res.data as { ok: boolean }
}

export async function callDisableUser(uid: string, disabled: boolean) {
  const res = await adminDisableUser({ uid, disabled })
  return res.data as { ok: boolean }
}

export async function callResetPassword(uid: string): Promise<{ temporaryPassword: string }> {
  const res = await adminResetPassword({ uid })
  return res.data as { temporaryPassword: string }
}
