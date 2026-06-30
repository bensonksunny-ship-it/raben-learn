/**
 * Firebase Web SDK config from Vite (`import.meta.env`).
 * Only `VITE_*` variables are exposed to the client — restart `npm run dev` after changing `platform/.env.local`.
 */

function requiredEnv(name: keyof ImportMetaEnv): string {
  const raw = import.meta.env[name]
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) {
    throw new Error(
      `[Firebase] Missing or empty ${String(name)}. Ensure platform/.env.local exists next to platform/vite.config.ts ` +
        'with all VITE_FIREBASE_* keys set, then restart the dev server.',
    )
  }
  return value
}

/** Mask for logs — never log full API keys. */
export function maskKey(key: string): string {
  if (key.length <= 12) return '(too short)'
  return `${key.slice(0, 6)}…${key.slice(-4)} (${key.length} chars)`
}

/** Fields passed to `initializeApp` (from Firebase Console → Web app). */
export type FirebaseWebEnvConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
  measurementId: string
}

/**
 * Validates every required `VITE_FIREBASE_*` variable and shape-checks known prefixes.
 */
export function getValidatedFirebaseEnv(): {
  firebaseConfig: FirebaseWebEnvConfig
  functionsRegion: string
} {
  const apiKey = requiredEnv('VITE_FIREBASE_API_KEY')
  if (!apiKey.startsWith('AIza')) {
    throw new Error(
      '[Firebase] VITE_FIREBASE_API_KEY must be the Web API key from Firebase Console (starts with "AIza").',
    )
  }

  const measurementId = requiredEnv('VITE_FIREBASE_MEASUREMENT_ID')
  if (!measurementId.startsWith('G-')) {
    throw new Error('[Firebase] VITE_FIREBASE_MEASUREMENT_ID must be a GA4 ID (starts with "G-").')
  }

  const firebaseConfig: FirebaseWebEnvConfig = {
    apiKey,
    authDomain: requiredEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: requiredEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: requiredEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: requiredEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: requiredEnv('VITE_FIREBASE_APP_ID'),
    measurementId,
  }

  const functionsRegion = requiredEnv('VITE_FIREBASE_FUNCTIONS_REGION')

  return { firebaseConfig, functionsRegion }
}
