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

export type LessonItemType = 'concept' | 'exercise' | 'implementation' | 'songsheet'

export type ItemStatus = 'locked' | 'in_progress' | 'review' | 'completed'

export interface Activity {
  id: string
  type: LessonItemType
  title: string
  remark?: string
}

export interface Session {
  id: string
  title: string
  subtitle?: string
  courseName?: string
  courseId: string | null
  order?: number
  activities: Activity[]
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
  items: DailyPlanItem[]
}

export interface ProgressEntry {
  activityId: string
  status: ItemStatus
  due?: boolean
  attemptsUsed?: number
  studentMarkedAt?: string | null
  mentorApprovedAt?: string | null
}
