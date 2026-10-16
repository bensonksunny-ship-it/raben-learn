import type { LevelId } from '../types'

export const LEVELS: LevelId[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

export function levelName(id: LevelId): string {
  return id === 0 ? 'Basement' : `Level ${id}`
}

/** Runtime guard for values coming from Firestore or a <select>'s string value. */
export function isLevelId(v: unknown): v is LevelId {
  return typeof v === 'number' && LEVELS.includes(v as LevelId)
}
