// 'consultant' = Academic Consultant — see lib/rbac.ts's `syllabusArea` capability:
// the only role scoped to exactly one page (Syllabus), with full edit/add-course
// rights there and nothing else reachable anywhere in the app.
export type Role = 'admin' | 'mentor' | 'student' | 'manager' | 'consultant'
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
  /** A student's ID-card QR payload — opaque, random, generated once (server-side
   *  on account creation, or backfilled from the Students page's "ID Card"
   *  button). Not a secret in the security sense (it's printed on a card anyone
   *  can read), but unguessable enough that scanning someone else's actual card
   *  is the only way to mark them present — see `attendance.rules` and
   *  `lib/attendance.ts`. */
  qrToken?: string
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
  /** Set when this period was created by picking a custom Activity Type (Lunch,
   *  Assembly, …) from the title autocomplete — drives its card color/icon on the
   *  grid (see `ActivityType`). Null/omitted falls back to the plain school-period
   *  look, same as before this existed. */
  activityTypeId?: string | null
  /** Which syllabus `Course` this period is teaching — set when the title was
   *  picked from the syllabus side of the autocomplete rather than an Activity
   *  Type or free text. Null/omitted = not attributed to any subject (every
   *  period saved before this existed, or a period for a non-subject activity).
   *  Drives the subject-wise hours summary on the Schedule page. */
  courseId?: string | null
}

export interface TimetableDay {
  periods: TimetablePeriod[]
}

/** The shared, platform-wide class timetable for one week — stored at
 *  `class_timetable/{weekStartDate}` (that week's Monday, "YYYY-MM-DD"), not a
 *  single static `master` doc. The legacy `class_timetable/master` doc is kept
 *  only as the one-time migration fallback `loadEffectiveWeekSchedule`/"Copy
 *  from Previous Week" read when a week has no doc of its own yet — see
 *  `schedulerShared.ts`. */
export interface ClassTimetable {
  /** "HH:MM" grid display bounds — default school-day window is 10:00–18:00. */
  windowStart: string
  windowEnd: string
  days: Record<Weekday, TimetableDay>
}

/**
 * One Priority-2 ("flexible") booking into an otherwise-open slot on the scheduler
 * grid — e.g. an elective a mentor is running. Unlike a `TimetablePeriod` it's never
 * mandatory: it layers on top of the locked timetable rather than replacing it, and
 * can be added, edited, or removed without touching the school's fixed periods.
 */
export interface ElectiveSession {
  id: string
  /** Blank only while `claimed` is false — an open slot waiting for a student or
   *  mentor to claim and fill it in from their own view. There's no separate "who
   *  it's for" field: any open slot is available to either role. */
  title: string
  /** "HH:MM" — this session's own start time. */
  startTime: string
  durationMinutes: number
  /** Optional — who's running it, free text (no mentor directory lookup). */
  mentorName?: string | null
  /** True once real content exists — either the manager supplied a title at
   *  creation, or a student/mentor has since claimed an open slot by filling one
   *  in. Defaults to true for any session that doesn't carry the field (every
   *  session created before this existed always had a title). */
  claimed?: boolean
  /** Same Activity Type link as `TimetablePeriod.activityTypeId` — set when this
   *  session was created from a non-subject activity (Lunch, Travel, …) rather
   *  than a syllabus subject or free text. */
  activityTypeId?: string | null
  /** Same subject link as `TimetablePeriod.courseId` — set when this elective
   *  was created by picking a syllabus course/session/topic from the title
   *  autocomplete, rather than an Activity Type or free text. */
  courseId?: string | null
}

export interface ElectiveDay {
  sessions: ElectiveSession[]
}

/** The shared, platform-wide elective-session board for one week — same
 *  per-week doc id scheme as `ClassTimetable` (`elective_sessions/{weekStartDate}`,
 *  `master` kept only as the migration fallback). Priority-2 bookings shown
 *  over the locked `ClassTimetable` (Priority 1) on the same scheduler grid. */
export interface ElectiveSchedule {
  days: Record<Weekday, ElectiveDay>
}

/**
 * A custom, non-subject recurring activity (Lunch, Break, Assembly, Travel,
 * Library, Sports, Chores, …) — managed from the Schedule page's "Manage
 * Activity Types" panel (`activity_types/{id}`), and offered alongside real
 * syllabus subjects in the same title-search dropdown when adding/editing a
 * school period or elective. Picking one auto-fills `defaultDurationMinutes`
 * and tags the saved period/session with this type's id, so its card renders
 * in `color`/`icon` instead of the plain Priority-1/2 look.
 */
export interface ActivityType {
  id: string
  name: string
  icon: string
  color: { bg: string; text: string }
  defaultDurationMinutes: number
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
  /** Minutes of class time this topic is expected to take — set per-row in the
   *  Syllabus Builder's flattened grid. Summed across a course's topics to show
   *  that subject's "required hours total" (there's no separate per-session
   *  duration field in the UI — sessions aren't shown as their own rows there). */
  durationMinutes?: number
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

/** A exam is either a printable paper for a written/in-person exam, or an
 *  in-app, auto-graded multiple-choice exam. Both share the same sectioned
 *  structure (e.g. "Part A" = 10 × 1 mark, "Part B" = 5 × 5 marks) — a real
 *  question paper's shape — rather than a random pool pulled per attempt. */
export type ExamType = 'written' | 'mcq'

export interface ExamSection {
  id: string
  label: string              // e.g. "Part A"
  caption?: string           // explanation for students — instructions for this section
  questionCount: number      // target count — a guide while pasting, not enforced
  marksPerQuestion: number
}

/** A reusable sub-section design, built once by the academic coordinator and
 *  picked from a list whenever anyone assembles an exam paper afterward —
 *  rather than retyping the same section's label/explanation/marks every
 *  time. Picking one seeds a fresh `ExamSection`; editing the template later
 *  doesn't retroactively change exams that already used it. */
export interface SectionTemplate {
  id: string
  title: string
  caption: string            // explanation for students
  marksPerQuestion: number
  createdBy: string          // uid
  updatedAt?: unknown
}

export interface ExamQuestionItem {
  id: string
  sectionId: string
  text: string
  options?: string[]         // mcq only, always 4
  correctAnswer?: string     // mcq only — must match one of options exactly
}

export interface Exam {
  id: string
  courseId: string
  type: ExamType
  title: string
  /** Which syllabus topic (flat SL No./Title row) this exam is for — null/absent
   *  means a general, whole-subject exam (e.g. the course's "Main Exam"), not
   *  tied to any one topic. `topicTitle` is denormalized alongside it so lists
   *  can show it without a lookup. */
  topicId?: string | null
  topicTitle?: string | null
  sections: ExamSection[]
  questions: ExamQuestionItem[]
  totalQuestions: number     // target entered up front, for the mismatch check
  totalMarks: number         // target entered up front, for the mismatch check
  durationMinutes: number    // mcq only
  isActive: boolean          // mcq only — students can see and start it
  createdBy: string          // uid
  updatedAt?: unknown
}

export interface ExamAttempt {
  id: string
  examId: string
  courseId: string
  studentId: string
  startedAt: string          // ISO timestamp string
  submittedAt: string | null
  timeSpentSeconds: number
  questionOrder: string[]            // question ids, fixed at start (exam order)
  optionOrder: Record<string, string[]>  // per-question shuffled options snapshot
  answers: Record<string, string>    // questionId → chosen option text
  score: number
  totalMarks: number
}

/** One scan event — the Live Class page's whole job is turning a day's worth of
 *  these, per student, into a live roster. `kind: 'period'` carries `periodId`
 *  (a `TimetablePeriod.id` from that weekday's locked schedule); login/logout
 *  don't need one, there's only ever one of each per day. */
export type AttendanceCheckpointKind = 'login' | 'period' | 'logout'

export interface AttendanceCheckpoint {
  kind: AttendanceCheckpointKind
  periodId?: string
  /** ISO timestamp, client clock — see `lib/attendance.ts` for the known caveat
   *  (no server-side time source without a Cloud Function). */
  scannedAt: string
  status: 'on-time' | 'late'
}

/** One student's whole day — doc id is `${studentId}_${date}` (`date` = "YYYY-MM-DD"),
 *  same composite-key convention as `DailyPlan`/`student_daily_plans`. */
export interface AttendanceRecord {
  id: string
  studentId: string
  date: string
  checkpoints: AttendanceCheckpoint[]
}
