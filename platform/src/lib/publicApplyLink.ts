import { getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getValidatedFirebaseEnv } from '../firebase/env'
import { callableHttpUrl } from './adminGcfCallables'
import { PUBLIC_APP_URL } from './publicUrl'
import type { ApplicationCollection } from './studentApplication'

/** A secondary, isolated Firebase app — same reasoning as `lib/liveClassKiosk.ts`'s
 *  own one: signing into this no-login link's custom-token session must never
 *  touch (or sign out) a staff member's own session if they open the link in the
 *  same browser they're signed into. */
const PUBLIC_APPLY_APP_NAME = 'public-apply-link'

function getPublicApplyApp() {
  const existing = getApps().find((a) => a.name === PUBLIC_APPLY_APP_NAME)
  if (existing) return existing
  const { firebaseConfig } = getValidatedFirebaseEnv()
  return initializeApp(firebaseConfig, PUBLIC_APPLY_APP_NAME)
}

export const publicApplyAuth = getAuth(getPublicApplyApp())
export const publicApplyDb = getFirestore(getPublicApplyApp())

interface ResolvedApplicationLink {
  customToken: string
  coll: ApplicationCollection
  studentId: string
}

/**
 * Calls the public `resolveApplicationLink` Cloud Function with the URL's
 * token. Deliberately a plain unauthenticated `fetch` (not
 * `adminGcfCallables.ts`'s `invokeCallable`, which requires a signed-in Bearer
 * token) — the whole point of this call is that the caller hasn't signed in.
 */
export async function resolveApplicationLinkToken(token: string): Promise<ResolvedApplicationLink> {
  const url = callableHttpUrl('resolveApplicationLink')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { token } }),
  })

  const text = await res.text()
  let parsed: unknown = null
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      throw new Error(`This link could not be opened (HTTP ${res.status}).`)
    }
  }

  const o = parsed as { result?: Partial<ResolvedApplicationLink>; error?: { message?: string } } | null
  if (!res.ok || o?.error) {
    throw new Error(o?.error?.message ?? `This link could not be opened (HTTP ${res.status}).`)
  }
  if (!o?.result?.customToken || !o.result.coll || !o.result.studentId) {
    throw new Error('This link could not be opened (unexpected response).')
  }
  return { customToken: o.result.customToken, coll: o.result.coll, studentId: o.result.studentId }
}

/** Marks the link used right after a successful submit, so reopening it shows
 *  "already submitted" instead of the form — same unauthenticated `fetch`
 *  pattern as the resolve call above. Failures are logged, not thrown: the
 *  application itself already saved, and the parent shouldn't see an error for
 *  a step that only tidies up the link's own state. */
export async function completePublicApplyToken(token: string): Promise<void> {
  try {
    const url = callableHttpUrl('completeApplicationLink')
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { token } }),
    })
    if (!res.ok) console.error('[completePublicApplyToken] HTTP', res.status, await res.text())
  } catch (e) {
    console.error('[completePublicApplyToken] failed', e)
  }
}

/** Builds the shareable application-link URL on the permanent production site. */
export function publicApplyUrl(token: string): string {
  return `${PUBLIC_APP_URL}/apply/${token}`
}
