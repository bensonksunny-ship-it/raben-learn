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
export type Capability = 'adminArea' | 'mentorArea' | 'studentArea' | 'managerArea' | 'manageUsers' | 'manageStudents' | 'manageTimetable'

const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  // Admin can also reach /schedule and /manager (no separate /admin/* routes for
  // either) — in practice admin is the only account most people have day to day,
  // so without this neither page would ever actually get looked at.
  admin: ['adminArea', 'manageTimetable', 'managerArea'],
  mentor: ['mentorArea'],
  student: ['studentArea'],
  // Manager is intentionally narrow: just the Dashboard, Users, Students, and
  // Schedule pages, nothing under /admin, /mentor, or /student. See
  // UserManagement/StudentsPage for the additional restriction that a manager
  // can't touch admin/manager accounts or grant those roles — that's enforced
  // server-side, this table only decides which pages are reachable at all.
  manager: ['managerArea', 'manageUsers', 'manageStudents', 'manageTimetable'],
}

export function can(roles: Role[], cap: Capability): boolean {
  return roles.some((r) => ROLE_CAPABILITIES[r]?.includes(cap))
}
