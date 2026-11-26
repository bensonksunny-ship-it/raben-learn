import type { Role } from '../types'

/**
 * The single rulebook for "who can see which part of the app." Route guards
 * (`<RequireCapability>`) and the sidebar nav (`AppShell`) both read from this
 * table, so a page can never be reachable by URL while being hidden from nav
 * (or vice versa) — there's one list to update, not two to keep in sync.
 */
// `manageTimetable` now gates /schedule — the merged page that absorbed both the old
// Timetable Planner (editable shared class schedule) and the old Student Diary
// (read-only per-student log). Kept the original capability name to limit churn.
export type Capability = 'adminArea' | 'mentorArea' | 'studentArea' | 'managerArea' | 'manageUsers' | 'manageStudents' | 'manageTimetable' | 'syllabusArea' | 'scheduleExams' | 'founderArea'

const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  // Admin can also reach /schedule and /manager (no separate /admin/* routes for
  // either) — in practice admin is the only account most people have day to day,
  // so without this neither page would ever actually get looked at.
  admin: ['adminArea', 'manageTimetable', 'managerArea', 'scheduleExams', 'founderArea'],
  // `scheduleExams` — the Exam Schedule page (/exam-schedule): admin, manager,
  // teachers (mentors) and academic consultants can all book subject exams.
  mentor: ['mentorArea', 'scheduleExams'],
  student: ['studentArea'],
  // Manager has full access to the app now — every capability admin has
  // (including `adminArea`, so the whole /admin/* tree — Reports and all —
  // is reachable, not just the manager-specific Users/Students/Schedule
  // views). The one boundary left is the admin role itself: granting it, or
  // touching an existing admin account, which `UserManagement`/the Cloud
  // Functions/Firestore rules enforce server-side — this table only decides
  // which pages are reachable at all, not per-account restrictions.
  manager: ['adminArea', 'managerArea', 'manageUsers', 'manageStudents', 'manageTimetable', 'syllabusArea', 'scheduleExams', 'founderArea'],
  // Academic Consultant — exactly one page, nothing else. `/syllabus` (App.tsx)
  // is the only route gated on `syllabusArea` for a FULL-edit visitor; manager
  // reaches the same route too, but SyllabusPage forces it read-only for them.
  consultant: ['syllabusArea', 'scheduleExams'],
  // Founder — the read-only Founder Overview (/founder), plus the Users page
  // (/users) so a founder can set/edit accounts and passwords directly, same
  // narrow (non-admin-account) access as manager. Admin reaches founderArea too.
  founder: ['founderArea', 'manageUsers'],
}

export function can(roles: Role[], cap: Capability): boolean {
  return roles.some((r) => ROLE_CAPABILITIES[r]?.includes(cap))
}
