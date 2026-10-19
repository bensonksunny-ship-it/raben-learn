import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore'
import { normalizeRoles } from './roles'
import type { UserProfile } from '../types'

export function mapUserDoc(docSnap: QueryDocumentSnapshot<DocumentData>): UserProfile {
  const d = docSnap.data()
  return {
    id: docSnap.id,
    name: (d.name as string) ?? '',
    email: (d.email as string) ?? '',
    roles: normalizeRoles(d),
    status: d.status as UserProfile['status'],
    firstLogin: Boolean(d.firstLogin),
    createdAt: d.createdAt,
    courseIds: (d.courseIds as string[]) ?? [],
  }
}

export function avatarClass(roles: string[]): string {
  if (roles.includes('admin')) return 'user-avatar is-admin'
  if (roles.includes('manager')) return 'user-avatar is-manager'
  if (roles.includes('mentor')) return 'user-avatar is-mentor'
  if (roles.includes('consultant')) return 'user-avatar is-consultant'
  return 'user-avatar is-student'
}
