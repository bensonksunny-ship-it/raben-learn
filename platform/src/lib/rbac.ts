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
export type Capability = 'adminArea' | 'mentorArea' | 'studentArea' | 'managerArea' | 'manageUsers' | 'manageStudents' | 'manageTimetable' | 'syllabusArea' | 'liveClassArea'

const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  // Admin can also reach /schedule and /manager (no separate /admin/* routes for
  // either) — in practice admin is the only account most people have day to day,
  // so without this neither page would ever actually get looked at.
  admin: ['adminArea', 'manageTimetable', 'managerArea', 'liveClassArea'],
  // Mentor gets `liveClassArea` on top of its own area — mentors are the ones
  // actually running periods day to day, so they're the most frequent user of
  // the live roster, not just admin/manager.
  mentor: ['mentorArea', 'liveClassArea'],
  student: ['studentArea'],
  // Manager is intentionally narrow: just the Dashboard, Users, Students, and
  // Schedule pages, nothing under /admin, /mentor, or /student. See
  // UserManagement/StudentsPage for the additional restriction that a manager
  // can't touch admin/manager accounts or grant those roles — that's enforced
  // server-side, this table only decides which pages are reachable at all.
  manager: ['managerArea', 'manageUsers', 'manageStudents', 'manageTimetable', 'liveClassArea'],
  // Academic Consultant — exactly one page, nothing else. `/syllabus` (App.tsx)
  // is the only route gated on `syllabusArea`; admin/mentor reach the same
  // `<SyllabusPage>` through their own `adminArea`/`mentorArea` routes instead,
  // so this capability is consultant-only in practice.
  consultant: ['syllabusArea'],
}

export function can(roles: Role[], cap: Capability): boolean {
  return roles.some((r) => ROLE_CAPABILITIES[r]?.includes(cap))
}
