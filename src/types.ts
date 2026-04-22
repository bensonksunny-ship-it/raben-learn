export type Role = 'admin' | 'mentor' | 'student'
export type UserStatus = 'active' | 'disabled'

export interface UserProfile {
  id: string
  name: string
  email: string
  roles: Role[]
  status: UserStatus
  firstLogin: boolean
  createdAt: unknown
  courseIds?: string[]
}

export interface Course {
  id: string
  title: string
  description?: string
  createdAt?: unknown
}

/**
 * Canonical type for a session Topic. A Topic is either a Concept or an Exercise.
 * Legacy session documents may still carry 'implementation' / 'songsheet' / 'custom' —
 * those are mapped to one of these two buckets via `normalizeTopicType()`.
 */
export type TopicType = 'concept' | 'exercise'

/**
 * Wider union kept for non-topic surfaces (e.g. DailyPlanItem lets students add a
 * free-form 'custom' item that isn't part of any course session).
 */
export type LessonItemType = TopicType | 'custom'

export type ItemStatus = 'locked' | 'in_progress' | 'review' | 'completed'

/**
 * A single syllabus unit inside a Session. Rendered in declared order
 * (no implicit grouping by type) so a session can freely interleave concepts
 * and exercises — e.g. 3 concepts followed by 2 exercises.
 */
export interface Topic {
  id: string
  type: TopicType
  title: string
  remark?: string
}

/** @deprecated Use `Topic`. Kept as a type alias so older call sites keep compiling. */
export type Activity = Topic

/**
 * Map any legacy / unknown type string onto a canonical TopicType.
 * Anything that isn't clearly a concept falls back to 'exercise' (hands-on work).
 */
export function normalizeTopicType(raw: unknown): TopicType {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return v === 'concept' ? 'concept' : 'exercise'
}

export interface Session {
  id: string
  title: string
  subtitle?: string
  courseName?: string
  courseId: string | null
  order?: number
  /** Ordered list of Topics. Stored in Firestore under the same field name for back-compat. */
  activities: Topic[]
}

export interface DailyPlanItem {
  id: string
  sessionId: string
  sessionTitle: string
  courseId: string
  activityId: string
  activityTitle: string
  activityType: LessonItemType
  plannedMinutes: number
  timeSpentMs: number
  done: boolean
  startedAt?: string | null
  completedAt?: string | null
}

export interface DailyPlan {
  id: string
  studentId: string
  date: string
  startTime?: string | null
  items: DailyPlanItem[]
}

/** Single row in Attempt History (student syllabus). */
export interface AttemptRecord {
  at: string
  status?: string
}

export interface ProgressEntry {
  activityId: string
  status: ItemStatus
  due?: boolean
  attemptsUsed?: number
  studentMarkedAt?: string | null
  mentorApprovedAt?: string | null
  /** Optional self-rating 1–5 (student syllabus UI). */
  rating?: number
  notes?: string
  attemptHistory?: AttemptRecord[]
}
