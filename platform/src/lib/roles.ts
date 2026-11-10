import type { Role } from '../types'

export function normalizeRoles(data: Record<string, unknown>): Role[] {
  const raw = data.roles
  if (Array.isArray(raw)) return raw as Role[]
  if (typeof raw === 'string') return [raw as Role]
  if (data.role && typeof data.role === 'string') return [data.role as Role]
  return ['student']
}

export function homePath(roles: Role[]): string {
  if (roles.includes('admin')) return '/admin'
  if (roles.includes('manager')) return '/manager'
  if (roles.includes('mentor')) return '/mentor'
  if (roles.includes('consultant')) return '/consultant'
  return '/student'
}
