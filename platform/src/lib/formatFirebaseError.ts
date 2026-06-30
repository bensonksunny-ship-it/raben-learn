import { formatCallableErrorForUi } from './callableErrorDetails'

export function formatFirebaseError(err: unknown, fallback = 'Request failed') {
  if (!err || typeof err !== 'object') return fallback

  const anyErr = err as Record<string, unknown>
  const message =
    typeof anyErr.message === 'string' && anyErr.message.trim().length > 0 ? anyErr.message : fallback
  const code = typeof anyErr.code === 'string' ? anyErr.code : ''

  const details = anyErr.details
  const customData = anyErr.customData

  /** See also `getCallableErrorDiagnostics` / Network tab / Functions logs — "internal" is never exact on its own. */
  const internalHint =
    code === 'functions/internal'
      ? ' — Check Network (callable POST status/response) and Firebase Functions logs (see adminCreateUser invoked).'
      : ''

  if (code && typeof details !== 'undefined') {
    try {
      return `${code}: ${message} · ${JSON.stringify(details)}${internalHint}`
    } catch {
      return `${code}: ${message}${internalHint}`
    }
  }
  if (customData != null) {
    try {
      return `${code || 'error'}: ${message} · ${JSON.stringify(customData)}${internalHint}`
    } catch {
      return `${code || 'error'}: ${message}${internalHint}`
    }
  }
  if (code === 'functions/internal') {
    return `${formatCallableErrorForUi(err)}${internalHint}`
  }
  if (code) return `${code}: ${message}${internalHint}`
  return `${message}${internalHint}`
}

