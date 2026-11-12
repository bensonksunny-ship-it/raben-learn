import { collection, doc, getDocs, serverTimestamp, setDoc, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore'
import { db } from '../firebase/config'
import type { ClassTimetable, ElectiveSchedule, StudyPlace } from '../types'

/** Subjects actually on a schedule — periods/sessions linked to a course. Activity
 *  Types (Lunch, Break, …) and exams never get a place, only subjects do. */
export function courseIdsOnSchedule(timetable: ClassTimetable | null, electives: ElectiveSchedule | null, extra: string[] = []): string[] {
  const ids = new Set<string>(extra)
  for (const day of Object.values(timetable?.days ?? {})) {
    for (const p of day.periods) if (p.courseId && !p.activityTypeId && !p.examId) ids.add(p.courseId)
  }
  for (const day of Object.values(electives?.days ?? {})) {
    for (const s of day.sessions) if (s.courseId && !s.activityTypeId && !s.examId) ids.add(s.courseId)
  }
  return [...ids]
}

/** studentId → courseId → placeId, for every student at once — the collection
 *  is one small doc per student, so seat counts are computed client-side. */
export type AllPlaceAssignments = Record<string, Record<string, string>>

export function mapStudyPlaceDoc(snap: QueryDocumentSnapshot<DocumentData>): StudyPlace {
  const d = snap.data()
  return {
    id: snap.id,
    name: (d.name as string) ?? '',
    capacity: Math.max(1, Number(d.capacity ?? 1) || 1),
  }
}

export async function loadStudyPlaces(): Promise<StudyPlace[]> {
  const snap = await getDocs(collection(db, 'study_places'))
  return snap.docs.map(mapStudyPlaceDoc).sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadAllPlaceAssignments(): Promise<AllPlaceAssignments> {
  const snap = await getDocs(collection(db, 'study_place_assignments'))
  const all: AllPlaceAssignments = {}
  snap.forEach((d) => {
    const by = d.data().byCourseId
    all[d.id] = by && typeof by === 'object' ? { ...(by as Record<string, string>) } : {}
  })
  return all
}

/** Students assigned to `placeId` for `courseId` — capacity is per subject. */
export function seatsUsed(placeId: string, courseId: string, all: AllPlaceAssignments): number {
  let n = 0
  for (const by of Object.values(all)) if (by[courseId] === placeId) n++
  return n
}

export function pickPlaceWithFreeSeat(courseId: string, places: StudyPlace[], all: AllPlaceAssignments): StudyPlace | null {
  return places.find((p) => seatsUsed(p.id, courseId, all) < p.capacity) ?? null
}

async function writeAssignments(studentId: string, byCourseId: Record<string, string>) {
  await setDoc(doc(db, 'study_place_assignments', studentId), { byCourseId, updatedAt: serverTimestamp() })
}

/**
 * Gives `studentId` a place for every course in `courseIds` that has none yet
 * (or whose place has since been deleted) — first place with a free seat for
 * that subject. Mutates `all` in place so later picks see the seats just taken,
 * and only writes when something actually changed. Returns the student's map.
 */
export async function autoAssignMissing(
  studentId: string, courseIds: string[], places: StudyPlace[], all: AllPlaceAssignments,
): Promise<Record<string, string>> {
  const placeIds = new Set(places.map((p) => p.id))
  const current = all[studentId] ?? {}
  const next = { ...current }
  let changed = false
  for (const courseId of courseIds) {
    if (next[courseId] && placeIds.has(next[courseId])) continue
    const pick = pickPlaceWithFreeSeat(courseId, places, all)
    if (!pick) { if (next[courseId]) { delete next[courseId]; changed = true }; continue }
    next[courseId] = pick.id
    all[studentId] = next
    changed = true
  }
  if (changed) {
    all[studentId] = next
    await writeAssignments(studentId, next)
  }
  return next
}

/** Manager override — `null` clears the subject's place for that student. */
export async function savePlaceAssignment(studentId: string, courseId: string, placeId: string | null, all: AllPlaceAssignments): Promise<void> {
  const next = { ...(all[studentId] ?? {}) }
  if (placeId) next[courseId] = placeId; else delete next[courseId]
  all[studentId] = next
  await writeAssignments(studentId, next)
}

/** courseId → place name, for drawing "📍 Desk A" on one student's grid. */
export function placeNamesByCourse(byCourseId: Record<string, string> | undefined, places: StudyPlace[]): Record<string, string> {
  const nameById = new Map(places.map((p) => [p.id, p.name]))
  const out: Record<string, string> = {}
  for (const [courseId, placeId] of Object.entries(byCourseId ?? {})) {
    const name = nameById.get(placeId)
    if (name) out[courseId] = name
  }
  return out
}
