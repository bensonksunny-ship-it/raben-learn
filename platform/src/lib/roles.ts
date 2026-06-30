import type { Role, UserProfile } from '../types'

export function normalizeRoles(data: Record<string, unknown>): Role[] {
  const raw = data.roles
  if (Array.isArray(raw)) return raw as Role[]
  if (typeof raw === 'string') return [raw as Role]
  if (data.role && typeof data.role === 'string') return [data.role as Role]
  return ['student']
}

export function homePath(profile: UserProfile): string {
  if (profile.roles.includes('admin')) return '/admin'
  if (profile.roles.includes('mentor')) return '/mentor'
  return '/student'
}
