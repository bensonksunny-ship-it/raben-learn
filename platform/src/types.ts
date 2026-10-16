export type Role = 'admin' | 'mentor' | 'student' | 'manager'
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

/** Weekday key for the class timetable — Monday through Saturday, no Sunday. */
export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat'

/** One mandatory ("locked") slot in the shared class timetable. Each period carries its
 *  own start time, so periods may have gaps between them — picking a grid slot fixes
 *  that period's start time independently of whatever else is scheduled that day. */
export interface TimetablePeriod {
  id: string
  title: string
  /** "HH:MM" — this period's own start time (not derived from any other period). */
  startTime: string
  durationMinutes: number
}

export interface TimetableDay {
  periods: TimetablePeriod[]
}

/** The single shared, platform-wide weekly class timetable (`class_timetable/master`). */
export interface ClassTimetable {
  /** "HH:MM" grid display bounds — default school-day window is 10:00–18:00. */
  windowStart: string
  windowEnd: string
  days: Record<Weekday, TimetableDay>
}

/**
 * Who's responsible for filling in an elective session's real content.
 *  - 'manager': the manager already specified the title when creating it (the
 *    original, still-default behavior).
 *  - 'student' / 'mentor': the manager deliberately left it as a placeholder for
 *    that role to claim — it renders on the grid as an open/pending slot (dashed
 *    border, "Pending Student Input" / "Open Mentor Spot" badge, no real title
 *    yet) until someone with that role fills it in.
 */
export type SlotFillMode = 'manager' | 'student' | 'mentor'

/**
 * One Priority-2 ("flexible") booking into an otherwise-open slot on the scheduler
 * grid — e.g. an elective a mentor is running. Unlike a `TimetablePeriod` it's never
 * mandatory: it layers on top of the locked timetable rather than replacing it, and
 * can be added, edited, or removed without touching the school's fixed periods.
 */
export interface ElectiveSession {
  id: string
  /** Blank only while `fillMode` isn't 'manager' and `claimed` is false — an
   *  open placeholder waiting for a student or mentor to fill it in. */
  title: string
  /** "HH:MM" — this session's own start time. */
  startTime: string
  durationMinutes: number
  /** Optional — who's running it, free text (no mentor directory lookup). */
  mentorName?: string | null
  /** Who was meant to fill this slot in. Defaults to 'manager' for any session that
   *  doesn't carry the field (i.e. every session created before this existed). */
  fillMode?: SlotFillMode
  /** True once real content exists — either the manager supplied it at creation
   *  ('manager' fillMode, always true), or a student/mentor has since claimed an
   *  open placeholder by filling in a title. */
  claimed?: boolean
}

export interface ElectiveDay {
  sessions: ElectiveSession[]
}

/** The single shared, platform-wide weekly elective-session board
 *  (`elective_sessions/master`) — Priority-2 bookings shown over the
 *  locked `ClassTimetable` (Priority 1) on the same scheduler grid. */
export interface ElectiveSchedule {
  days: Record<Weekday, ElectiveDay>
}

/** Grade/class level — 0 ("Basement") through 10. Fixed range, not Firestore-backed
 *  (same pattern as `Weekday`/`WEEKDAYS`) — no admin UI to add/remove levels. */
export type LevelId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export interface Course {
  id: string
  title: string
  description?: string
  createdAt?: unknown
  /** null = not yet migrated/assigned to a level — see the migration task. Every
   *  course created through the Syllabus Builder or Planning UI always has one. */
  levelId: LevelId | null
  /** The outcome expected of a student who completes this subject at this level.
   *  Edited from the Planning page. */
  coreOutcome?: string
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
  completed?: boolean
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
  durationMinutes?: number
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

export interface ExamConfig {
  duration: number           // minutes
  totalMarks: number
  questionsPerExam: number
  isActive: boolean
  createdBy: string          // uid
}

export interface ExamQuestion {
  id: string
  question: string
  options: string[]          // always 4
  correctAnswer: string      // must match one of options exactly
  explanation: string
  difficulty: 'easy' | 'medium' | 'hard'
  topic: string
  marks: number
  usageCount: number
}

export interface QuestionSnapshot extends ExamQuestion {
  shuffledOptions: string[]  // options in the order shown to the student
}

export interface ExamAttempt {
  id: string
  studentId: string
  courseId: string
  startedAt: string          // ISO timestamp string
  submittedAt: string | null
  timeSpentSeconds: number
  questions: QuestionSnapshot[]
  answers: Record<string, string>  // questionId → chosen option text
  score: number
  totalMarks: number
  topicBreakdown: Record<string, { correct: number; total: number }>
}
