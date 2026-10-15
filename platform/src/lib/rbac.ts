import type { Role } from '../types'

/**
 * The single rulebook for "who can see which part of the app." Route guards
 * (`<RequireCapability>`) and the sidebar nav (`AppShell`) both read from this
 * table, so a page can never be reachable by URL while being hidden from nav
 * (or vice versa) — there's one list to update, not two to keep in sync.
 */
export type Capability = 'adminArea' | 'mentorArea' | 'studentArea' | 'manageUsers' | 'manageStudents' | 'manageTimetable'

const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  admin: ['adminArea'],
  mentor: ['mentorArea'],
  student: ['studentArea'],
  // Manager is intentionally narrow: just the Users, Students, and Timetable
  // pages, nothing under /admin, /mentor, or /student. See UserManagement/
  // StudentsPage for the additional restriction that a manager can't touch
  // admin/manager accounts or grant those roles — that's enforced server-side,
  // this table only decides which pages are reachable at all.
  manager: ['manageUsers', 'manageStudents', 'manageTimetable'],
}

export function can(roles: Role[], cap: Capability): boolean {
  return roles.some((r) => ROLE_CAPABILITIES[r]?.includes(cap))
}
