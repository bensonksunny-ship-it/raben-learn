import { auth } from '../firebase/config'
import { getCallableErrorDiagnostics } from './callableErrorDetails'
import type { Role } from '../types'

if (import.meta.env.DEV) {
  console.info(
    '[adminGcfCallables] Loaded: fetch + Bearer only — POST /__gcf__/… on localhost (no firebase/functions httpsCallable).',
  )
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

/**
 * Same-origin `/__gcf__/*` (Vite proxy → Cloud Functions) avoids calling `*.cloudfunctions.net` from
 * http://localhost — the browser blocks that with CORS. Deployed sites use the regional HTTPS URL;
 * Firebase callable endpoints allow CORS for web clients when called with `fetch` + Bearer token.
 */
function sameOriginGcfProxyEnabled(): boolean {
  if (typeof window === 'undefined') return false

  const h = (window.location.hostname || '').trim().toLowerCase()
  const isLoopbackOrLocalDevHost =
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '[::1]' ||
    (h.length > 0 && h.endsWith('.localhost'))

  if (isLoopbackOrLocalDevHost) return true

  const raw = import.meta.env.VITE_USE_GCF_PROXY
  const p = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (p === 'true' || p === '1' || p === 'yes') return true
  if (p === 'false' || p === '0' || p === 'no') return false

  if (!import.meta.env.PROD) return true

  return false
}

/** Extra guard: some environments report odd `hostname`; `origin` still shows localhost. */
function isLocalDevPageOrigin(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const o = window.location.origin
    return (
      o.startsWith('http://localhost') ||
      o.startsWith('http://127.0.0.1') ||
      o.startsWith('http://[::1]')
    )
  } catch {
    return false
  }
}

function callableHttpUrl(name: string): string {
  if (typeof window === 'undefined') {
    const region = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION
    const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
    if (typeof region !== 'string' || !region.trim() || typeof projectId !== 'string' || !projectId.trim()) {
      throw new Error('[adminGcfCallables] Set VITE_FIREBASE_FUNCTIONS_REGION and VITE_FIREBASE_PROJECT_ID')
    }
    return `https://${region.trim()}-${projectId.trim()}.cloudfunctions.net/${name}`
  }

  // `vite` dev server: always same-origin + `/__gcf__/` proxy — never hit *.cloudfunctions.net from the browser (CORS).
  if (import.meta.env.DEV) {
    return `${window.location.origin}/__gcf__/${name}`
  }

  if (sameOriginGcfProxyEnabled() || isLocalDevPageOrigin()) {
    return `${window.location.origin}/__gcf__/${name}`
  }

  const region = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  if (typeof region !== 'string' || !region.trim() || typeof projectId !== 'string' || !projectId.trim()) {
    throw new Error('[adminGcfCallables] Set VITE_FIREBASE_FUNCTIONS_REGION and VITE_FIREBASE_PROJECT_ID')
  }
  return `https://${region.trim()}-${projectId.trim()}.cloudfunctions.net/${name}`
}

/** Map callable `error.status` (e.g. UNAUTHENTICATED) → `functions/unauthenticated`. */
function toFunctionsErrorCode(status: string): string {
  return `functions/${status.toLowerCase().replace(/_/g, '-')}`
}

function throwLikeFirebaseCallable(err: { status?: string; message?: string }) {
  const st = err.status ?? 'INTERNAL'
  const msg = err.message ?? 'Callable error'
  const e = new Error(msg) as Error & { code: string }
  e.code = toFunctionsErrorCode(st)
  throw e
}

/**
 * HTML 401 from `*.cloudfunctions.net` / Cloud Run usually means IAM: the HTTPS endpoint is not
 * publicly invokable. Firebase callables still need anonymous access at the edge; the Firebase ID
 * token is validated inside the function, not by Cloud Run IAM.
 */
function isCloudRunInvoker401Html(body: string): boolean {
  return (
    body.includes('401 Unauthorized') &&
    (body.includes('does not have permission') || body.includes('Your client does not have permission'))
  )
}

function errorForHttpFailure(name: string, status: number, body: string): Error {
  if (status === 401 && isCloudRunInvoker401Html(body)) {
    return new Error(
      `Callable "${name}": Google Cloud returned 401 (IAM). Allow unauthenticated invocation on the ` +
        `function’s Cloud Run service: Cloud Console → Cloud Run → open the service for this function → ` +
        `Permissions → Grant access → Principal "allUsers", Role "Cloud Run Invoker". ` +
        `Or: gcloud run services add-iam-policy-binding SERVICE_NAME --region=REGION --member=allUsers --role=roles/run.invoker ` +
        `(replace SERVICE_NAME with the service shown in Cloud Run; Gen2 functions deploy as Cloud Run).`,
    )
  }
  return new Error(
    `Callable ${name}: HTTP ${status}${body ? ` — ${body.slice(0, 400)}` : ' (empty body)'}`,
  )
}

async function invokeCallable<T>(name: string, data: unknown): Promise<T> {
  const user = auth.currentUser
  if (!user) {
    throw new Error('You must be signed in.')
  }
  if (typeof window === 'undefined') {
    throw new Error('Functions must be called from the browser.')
  }

  const token = await user.getIdToken(true)
  const url = callableHttpUrl(name)
  if (import.meta.env.DEV && url.includes('cloudfunctions.net')) {
    throw new Error('[adminGcfCallables] Dev build must use /__gcf__/ only — check vite dev server and adminGcfCallables.callableHttpUrl.')
  }
  const controller = new AbortController()
  const t = window.setTimeout(() => controller.abort(), 120_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data }),
      signal: controller.signal,
    })

    const text = await res.text()
    let parsed: unknown = null
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        if (!res.ok) {
          throw errorForHttpFailure(name, res.status, text)
        }
        throw new Error(`Callable ${name}: invalid JSON response`)
      }
    }

    const o = parsed as { result?: T; error?: { status?: string; message?: string } } | null

    if (!res.ok) {
      if (o?.error) {
        throwLikeFirebaseCallable(o.error)
      }
      throw errorForHttpFailure(name, res.status, text)
    }

    if (o && o.error) {
      throwLikeFirebaseCallable(o.error)
    }
    if (o && Object.prototype.hasOwnProperty.call(o, 'result')) {
      return o.result as T
    }
    throw new Error(`Callable ${name}: unexpected response`)
  } finally {
    window.clearTimeout(t)
  }
}

export async function callCreateUser(payload: CreateUserPayload): Promise<CreateUserResult> {
  try {
    return await invokeCallable<CreateUserResult>('adminCreateUser', payload)
  } catch (err) {
    console.error('[callCreateUser]', getCallableErrorDiagnostics(err))
    throw err
  }
}

export async function callUpdateUser(payload: UpdateUserPayload) {
  return invokeCallable<{ ok: boolean }>('adminUpdateUser', payload)
}

export async function callDisableUser(uid: string, disabled: boolean) {
  return invokeCallable<{ ok: boolean }>('adminDisableUser', { uid, disabled })
}

export async function callResetPassword(uid: string): Promise<{ temporaryPassword: string }> {
  return invokeCallable<{ temporaryPassword: string }>('adminResetPassword', { uid })
}
