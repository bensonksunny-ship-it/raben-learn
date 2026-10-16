import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore'
import { isLevelId } from './levels'
import type { Course } from '../types'

/** Single source of truth for reading a `courses/{id}` doc — every page that lists
 *  courses uses this, so `levelId`/`coreOutcome` can never be silently dropped. */
export function mapCourseDoc(docSnap: QueryDocumentSnapshot<DocumentData>): Course {
  const x = docSnap.data()
  return {
    id: docSnap.id,
    title: (x.title as string) ?? '',
    description: (x.description as string) ?? '',
    levelId: isLevelId(x.levelId) ? x.levelId : null,
    coreOutcome: (x.coreOutcome as string) ?? '',
  }
}
