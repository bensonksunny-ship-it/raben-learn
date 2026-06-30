import { normalizeTopicType, type Topic } from '../types'

/**
 * Reads a Firestore session's raw `activities` array and returns a properly typed,
 * order-preserving list of Topics. Legacy `implementation` / `songsheet` / unknown
 * type values are normalized to 'exercise' via `normalizeTopicType`.
 */
export function readTopicsFromSessionDoc(raw: unknown): Topic[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const r = (entry ?? {}) as Record<string, unknown>
    return {
      id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
      title: typeof r.title === 'string' ? r.title : '',
      remark: typeof r.remark === 'string' ? r.remark : '',
      type: normalizeTopicType(r.type),
    }
  })
}
