/**
 * Extracts everything the Firebase JS SDK exposes on Functions errors.
 * `functions/internal` is generic — the payload below is what pinpoints the real issue.
 */
export function getCallableErrorDiagnostics(err: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!err || typeof err !== 'object') {
    out.raw = String(err)
    return out
  }
  const e = err as Record<string, unknown>
  for (const k of ['name', 'message', 'code', 'stack']) {
    if (k in e) out[k] = e[k]
  }
  // Firebase modular SDK often attaches these on Functions failures:
  if ('customData' in e) out.customData = e.customData
  if ('details' in e) out.details = e.details
  // Some versions expose nested server payload:
  if ('serverResponse' in e) out.serverResponse = e.serverResponse
  return out
}

export function formatCallableErrorForUi(err: unknown): string {
  const d = getCallableErrorDiagnostics(err)
  const code = typeof d.code === 'string' ? d.code : ''
  const msg = typeof d.message === 'string' ? d.message : 'Request failed'
  const extra =
    d.details != null
      ? ` · details=${safeJson(d.details)}`
      : d.customData != null
        ? ` · customData=${safeJson(d.customData)}`
        : ''
  return code ? `${code}: ${msg}${extra}` : `${msg}${extra}`
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, 800)
  } catch {
    return String(v)
  }
}
