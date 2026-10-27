import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore'
import type { ActivityType } from '../types'

export function mapActivityTypeDoc(docSnap: QueryDocumentSnapshot<DocumentData>): ActivityType {
  const d = docSnap.data()
  const color = (d.color as { bg?: string; text?: string } | undefined) ?? {}
  return {
    id: docSnap.id,
    name: (d.name as string) ?? '',
    icon: (d.icon as string) || '📌',
    color: { bg: color.bg || '#f3f4f6', text: color.text || '#374151' },
    defaultDurationMinutes: Number(d.defaultDurationMinutes ?? 30),
  }
}

/** A short, pastel palette consistent with the app's existing kid-theme look —
 *  picked from (not a free color input) so every activity type's card stays
 *  legible and on-brand, same reasoning as `DAY_COLORS`. */
export const ACTIVITY_TYPE_COLOR_PRESETS: { bg: string; text: string }[] = [
  { bg: '#ffe3e3', text: '#e03131' },
  { bg: '#ffe8cc', text: '#e8590c' },
  { bg: '#fff3bf', text: '#f08c00' },
  { bg: '#d3f9d8', text: '#2b8a3e' },
  { bg: '#d0ebff', text: '#1971c2' },
  { bg: '#e5dbff', text: '#7048e8' },
  { bg: '#ffdeeb', text: '#c2255c' },
  { bg: '#f3f4f6', text: '#374151' },
]
