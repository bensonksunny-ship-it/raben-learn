import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { can, type Capability } from '../lib/rbac'
import { homePath } from '../lib/roles'

/**
 * Route-level guard — the actual enforcement behind the nav hiding in AppShell.
 * AppShell already blocks rendering until `profile` exists, so by the time any
 * route nested under it mounts, `profile` is non-null; the `/login` fallback
 * below is just defensive, not an expected path.
 */
export function RequireCapability({ cap, children }: { cap: Capability; children: ReactNode }) {
  const { profile } = useAuth()
  if (!profile) return <Navigate to="/login" replace />
  if (!can(profile.roles, cap)) return <Navigate to={homePath(profile)} replace />
  return <>{children}</>
}
