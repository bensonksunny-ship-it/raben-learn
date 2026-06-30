/**
 * Firestore rejects `undefined`. Deep-strip `undefined` fields from objects/arrays so
 * any `setDoc` / `updateDoc` payload stays valid, regardless of optional fields.
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefinedDeep(v)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue
      out[k] = stripUndefinedDeep(v as unknown)
    }
    return out as T
  }
  return value
}
