import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function AppShell() {
  const { firebaseUser, profile, loading, logout } = useAuth()

  if (loading) return <div className="shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><p className="muted">Loading…</p></div>
  if (!firebaseUser) return <Navigate to="/login" replace />
  if (!profile) return <div className="shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><p className="muted">Loading profile…</p></div>
  if (profile.firstLogin) return <Navigate to="/change-password" replace />

  const isAdmin = profile.roles.includes('admin')
  const isMentor = profile.roles.includes('mentor')
  const isStudent = profile.roles.includes('student')

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Raben Learn</div>
        <nav className="nav-list">
          {isAdmin && <>
            <NavLink to="/admin/syllabus" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>📚 Syllabus</NavLink>
            <NavLink to="/admin/students" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>🎓 Students</NavLink>
            <NavLink to="/admin/reports" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>📊 Reports</NavLink>
            <NavLink to="/admin/users" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>👤 Users</NavLink>
          </>}
          {isMentor && <>
            <NavLink to="/mentor" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>🏠 Dashboard</NavLink>
            <NavLink to="/mentor" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>🎓 Students</NavLink>
            <NavLink to="/mentor/syllabus" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>📚 Syllabus</NavLink>
            <NavLink to="/mentor/reports" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>📊 Reports</NavLink>
          </>}
          {isStudent && <>
            <NavLink to="/student" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>📖 My Courses</NavLink>
            <NavLink to="/student/planner" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>📅 Today's Plan</NavLink>
            <NavLink to="/student/history" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>🏆 History</NavLink>
          </>}
        </nav>
        <div className="user-meta">
          <span className="user-meta-name">{profile.name}</span>
          <span className="muted small">{profile.roles.join(' · ')}</span>
          <button type="button" className="btn ghost small" onClick={() => void logout()}>Sign out</button>
        </div>
        <div className="muted small" style={{ textAlign: 'center', padding: '0.25rem', opacity: 0.4 }}>v3 · Apr 7</div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  )
}
