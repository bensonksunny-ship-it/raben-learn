import { getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getValidatedFirebaseEnv, maskKey } from './env'

const { firebaseConfig, functionsRegion } = getValidatedFirebaseEnv()

/** Safe for console: never prints the raw API key. */
const firebaseConfigForLog = {
  ...firebaseConfig,
  apiKey: maskKey(firebaseConfig.apiKey),
}

if (import.meta.env.DEV) {
  console.log('Firebase Config:', firebaseConfigForLog)
  console.assert(firebaseConfig.apiKey !== undefined && firebaseConfig.apiKey.length > 0, 'apiKey must be set')
  console.assert(
    firebaseConfig.apiKey.startsWith('AIza'),
    'apiKey should start with "AIza" (Firebase Web API key)',
  )
  console.info('[Firebase] mode:', import.meta.env.MODE, 'functionsRegion:', functionsRegion)
}

function getOrInitApp() {
  const existing = getApps()
  if (existing.length > 0) return existing[0]!
  return initializeApp(firebaseConfig)
}

export const app = getOrInitApp()
export const auth = getAuth(app)
export const db = getFirestore(app)
