export function formatFirebaseError(err: unknown, fallback = 'Request failed') {
  if (!err || typeof err !== 'object') return fallback

  const anyErr = err as Record<string, unknown>
  const message =
    typeof anyErr.message === 'string' && anyErr.message.trim().length > 0 ? anyErr.message : fallback
  const code = typeof anyErr.code === 'string' ? anyErr.code : ''

  const details = anyErr.details
  const customData = anyErr.customData

  const hint =
    code === 'functions/internal'
      ? ' (Typical causes: wrong Functions region in `VITE_FIREBASE_FUNCTIONS_REGION`, hosting build missing env vars, App Check enforced on Functions, or a server crash — check Functions logs in Firebase Console.)'
      : ''

  if (code && typeof details !== 'undefined') {
    try {
      return `${code}: ${message} · ${JSON.stringify(details)}${hint}`
    } catch {
      return `${code}: ${message}${hint}`
    }
  }
  if (customData != null) {
    try {
      return `${code || 'error'}: ${message} · ${JSON.stringify(customData)}${hint}`
    } catch {
      return `${code || 'error'}: ${message}${hint}`
    }
  }
  if (code) return `${code}: ${message}${hint}`
  return `${message}${hint}`
}

