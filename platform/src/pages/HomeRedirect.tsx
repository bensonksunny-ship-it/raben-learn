import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homePath } from '../lib/roles'

export function HomeRedirect() {
  const { firebaseUser, profile, loading } = useAuth()
  if (loading) return <div className="shell"><p className="muted">Loading…</p></div>
  if (!firebaseUser) return <Navigate to="/login" replace />
  if (!profile) return <div className="shell"><p className="muted">Loading profile…</p></div>
  if (profile.firstLogin) return <Navigate to="/change-password" replace />
  return <Navigate to={homePath(profile)} replace />
}
