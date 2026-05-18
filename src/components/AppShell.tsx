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

  const nl = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? ' active' : ''}`
  const bnl = ({ isActive }: { isActive: boolean }) => `bottom-nav-link${isActive ? ' active' : ''}`

  function handleLogout() {
    if (window.confirm('Are you sure you want to sign out?')) void logout()
  }

  return (
    <div className="shell">
      {/* Sidebar — desktop */}
      <aside className="sidebar">
        <div className="brand">Raben Learn</div>
        <nav className="nav-list">
          {isAdmin && <>
            <NavLink to="/admin" end className={nl}>🏠 Dashboard</NavLink>
            <NavLink to="/admin/students" className={nl}>🎓 Students</NavLink>
            <NavLink to="/admin/users" className={nl}>👤 Users</NavLink>
            <NavLink to="/admin/syllabus" className={nl}>📚 Syllabus</NavLink>
            <NavLink to="/admin/reports" className={nl}>📊 Reports</NavLink>
          </>}
          {isMentor && <>
            <NavLink to="/mentor" end className={nl}>🏠 Dashboard</NavLink>
            <NavLink to="/mentor" className={nl}>🎓 Students</NavLink>
            <NavLink to="/mentor/syllabus" className={nl}>📚 Syllabus</NavLink>
            <NavLink to="/mentor/reports" className={nl}>📊 Reports</NavLink>
          </>}
          {isStudent && <>
            <NavLink to="/student" end className={nl}>📖 My Courses</NavLink>
            <NavLink to="/student/planner" className={nl}>📅 Today's Plan</NavLink>
            <NavLink to="/student/history" className={nl}>🏆 History</NavLink>
          </>}
        </nav>
        <div className="user-meta">
          <span className="user-meta-name">{profile.name}</span>
          <span className="muted small">{profile.roles.join(' · ')}</span>
          <button type="button" className="btn ghost small" onClick={handleLogout}>Sign out</button>
        </div>
        <div className="muted small" style={{ textAlign: 'center', padding: '0.25rem', opacity: 0.4 }}>v3</div>
      </aside>

      <main className="main"><Outlet /></main>

      {/* Bottom nav — mobile only (shown via CSS at ≤600px) */}
      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {isAdmin && <>
            <NavLink to="/admin" end className={bnl}><span className="bn-icon">🏠</span><span className="bn-label">Home</span></NavLink>
            <NavLink to="/admin/students" className={bnl}><span className="bn-icon">🎓</span><span className="bn-label">Students</span></NavLink>
            <NavLink to="/admin/users" className={bnl}><span className="bn-icon">👤</span><span className="bn-label">Users</span></NavLink>
            <NavLink to="/admin/syllabus" className={bnl}><span className="bn-icon">📚</span><span className="bn-label">Syllabus</span></NavLink>
            <NavLink to="/admin/reports" className={bnl}><span className="bn-icon">📊</span><span className="bn-label">Reports</span></NavLink>
          </>}
          {isMentor && <>
            <NavLink to="/mentor" end className={bnl}><span className="bn-icon">🏠</span><span className="bn-label">Home</span></NavLink>
            <NavLink to="/mentor/syllabus" className={bnl}><span className="bn-icon">📚</span><span className="bn-label">Syllabus</span></NavLink>
            <NavLink to="/mentor/reports" className={bnl}><span className="bn-icon">📊</span><span className="bn-label">Reports</span></NavLink>
          </>}
          {isStudent && <>
            <NavLink to="/student" end className={bnl}><span className="bn-icon">📖</span><span className="bn-label">Courses</span></NavLink>
            <NavLink to="/student/planner" className={bnl}><span className="bn-icon">📅</span><span className="bn-label">Planner</span></NavLink>
            <NavLink to="/student/history" className={bnl}><span className="bn-icon">🏆</span><span className="bn-label">History</span></NavLink>
          </>}
        </div>
      </nav>
    </div>
  )
}
