import { getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getValidatedFirebaseEnv } from '../firebase/env'
import { callableHttpUrl } from './adminGcfCallables'

/** A secondary, isolated Firebase app — so signing into the kiosk's custom-token
 *  session never touches (or signs out) a staff member's own session if the Live
 *  Class link is opened in the same browser as their logged-in admin tab. */
const KIOSK_APP_NAME = 'live-class-kiosk'

function getKioskApp() {
  const existing = getApps().find((a) => a.name === KIOSK_APP_NAME)
  if (existing) return existing
  const { firebaseConfig } = getValidatedFirebaseEnv()
  return initializeApp(firebaseConfig, KIOSK_APP_NAME)
}

export const kioskAuth = getAuth(getKioskApp())
export const kioskDb = getFirestore(getKioskApp())

/**
 * Calls the public `resolveLiveClassKiosk` Cloud Function with the URL's token.
 * Deliberately a plain unauthenticated `fetch` (not `adminGcfCallables.ts`'s
 * `invokeCallable`, which requires a signed-in Bearer token) — the whole point
 * of this call is that the caller hasn't signed in yet.
 */
export async function resolveLiveClassKioskToken(token: string): Promise<string> {
  const url = callableHttpUrl('resolveLiveClassKiosk')
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

  const o = parsed as { result?: { customToken?: string }; error?: { message?: string } } | null
  if (!res.ok || o?.error) {
    throw new Error(o?.error?.message ?? `This link could not be opened (HTTP ${res.status}).`)
  }
  if (!o?.result?.customToken) {
    throw new Error('This link could not be opened (unexpected response).')
  }
  return o.result.customToken
}

/** Builds the shareable kiosk URL for the current origin. */
export function liveClassKioskUrl(token: string): string {
  return `${window.location.origin}/live-class/${token}`
}
