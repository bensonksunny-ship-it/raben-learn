import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { AppIcon } from './AppIcon'

export default function AppShell() {
  const { firebaseUser, profile, loading, logout } = useAuth()
  const location = useLocation()

  if (loading) return <div style={{ minHeight: '100dvh', background: 'var(--bg)' }} />
  if (!firebaseUser) return <Navigate to="/login" replace />
  if (!profile) return <div style={{ minHeight: '100dvh', background: 'var(--bg)' }} />
  if (profile.firstLogin) return <Navigate to="/change-password" replace />

  const isAdmin = profile.roles.includes('admin')
  const isMentor = profile.roles.includes('mentor')
  const isStudent = profile.roles.includes('student')
  const isManager = profile.roles.includes('manager')

  const nl = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? ' active' : ''}`
  const bnl = ({ isActive }: { isActive: boolean }) => `bottom-nav-link${isActive ? ' active' : ''}`

  // Manager's Users/Students/Schedule links point at /manager?view=... (they open as a
  // popup over the dashboard, not a real navigation — see ManagerDashboard), so NavLink's
  // own pathname-only matching can't tell them apart. Compute "active" from the ?view=
  // param ourselves instead; `managerView` of '' means the plain Dashboard link.
  const managerView = isManager && location.pathname === '/manager' ? (new URLSearchParams(location.search).get('view') ?? '') : null
  function managerLinkClass(base: string, view: string) { return `${base}${managerView === view ? ' active' : ''}` }

  function handleLogout() {
    if (window.confirm('Are you sure you want to sign out?')) void logout()
  }

  return (
    <div className="shell">
      {/* Sidebar — desktop */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <AppIcon className="sidebar-brand-icon" />
          <span className="sidebar-brand-text">Raben Learn</span>
        </div>
        <nav className="nav-list">
          {isAdmin && <>
            <NavLink to="/admin" end className={nl}>🏠 Dashboard</NavLink>
            <NavLink to="/admin/students" className={nl}>🎓 Students</NavLink>
            <NavLink to="/admin/users" className={nl}>👤 Users</NavLink>
            <NavLink to="/admin/syllabus" className={nl}>📚 Syllabus</NavLink>
            <NavLink to="/schedule" className={nl}>🗓️ Schedule</NavLink>
            <NavLink to="/manager" className={nl}>🧑‍💼 Manager</NavLink>
            <NavLink to="/manager/student-preview" className={nl}>👁️ Preview Student View</NavLink>
            <NavLink to="/admin/reports" className={nl}>📊 Reports</NavLink>
          </>}
          {isMentor && <>
            <NavLink to="/mentor" end className={nl}>🏠 Dashboard</NavLink>
            <NavLink to="/mentor" className={nl}>🎓 Students</NavLink>
            <NavLink to="/mentor/syllabus" className={nl}>📚 Syllabus</NavLink>
            <NavLink to="/mentor/reports" className={nl}>📊 Reports</NavLink>
          </>}
          {isStudent && <>
            <NavLink to="/student" end className={nl}>🏠 Dashboard</NavLink>
            <NavLink to="/student/planner" className={nl}>📅 Today's Plan</NavLink>
            <NavLink to="/student/history" className={nl}>🏆 History</NavLink>
          </>}
          {isManager && <>
            <Link to="/manager" className={managerLinkClass('nav-link', '')}>🏠 Dashboard</Link>
            <Link to="/manager?view=users" className={managerLinkClass('nav-link', 'users')}>👤 Users</Link>
            <Link to="/manager?view=students" className={managerLinkClass('nav-link', 'students')}>🎓 Students</Link>
            <Link to="/manager?view=schedule" className={managerLinkClass('nav-link', 'schedule')}>🗓️ Schedule</Link>
            <NavLink to="/manager/student-preview" className={nl}>👁️ Preview Student View</NavLink>
          </>}
        </nav>
        <div className="user-meta">
          <span className="user-meta-name">{profile.name}</span>
          <span className="muted small">{profile.roles.join(' · ')}</span>
          <button type="button" className="btn ghost small" onClick={handleLogout}>Sign out</button>
        </div>
        <div className="muted small" style={{ textAlign: 'center', padding: '0.25rem', opacity: 0.4 }}>v3</div>
      </aside>

      {/* .kid-theme here (not on individual pages) re-themes every view in one place —
          pastel background, rounded corners, playful fonts — via the shared CSS custom
          properties almost every existing class (.panel, .btn, .modal, .tag, inputs…)
          already reads off. Pages that still declare their own `kid-theme` wrapper
          (Schedule, Syllabus, Manager Dashboard) just redeclare the same variables —
          harmless, not worth churning those files to remove now. */}
      <main className="main"><div className="kid-theme"><Outlet /></div></main>

      {/* Bottom nav — mobile only (shown via CSS at ≤600px) */}
      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {isAdmin && <>
            <NavLink to="/admin" end className={bnl}><span className="bn-icon">🏠</span><span className="bn-label">Home</span></NavLink>
            <NavLink to="/admin/students" className={bnl}><span className="bn-icon">🎓</span><span className="bn-label">Students</span></NavLink>
            <NavLink to="/admin/syllabus" className={bnl}><span className="bn-icon">📚</span><span className="bn-label">Syllabus</span></NavLink>
            <NavLink to="/schedule" className={bnl}><span className="bn-icon">🗓️</span><span className="bn-label">Schedule</span></NavLink>
            <NavLink to="/manager" className={bnl}><span className="bn-icon">🧑‍💼</span><span className="bn-label">Manager</span></NavLink>
            <NavLink to="/manager/student-preview" className={bnl}><span className="bn-icon">👁️</span><span className="bn-label">Preview</span></NavLink>
            <NavLink to="/admin/reports" className={bnl}><span className="bn-icon">📊</span><span className="bn-label">Reports</span></NavLink>
          </>}
          {isMentor && <>
            <NavLink to="/mentor" end className={bnl}><span className="bn-icon">🏠</span><span className="bn-label">Home</span></NavLink>
            <NavLink to="/mentor/syllabus" className={bnl}><span className="bn-icon">📚</span><span className="bn-label">Syllabus</span></NavLink>
            <NavLink to="/mentor/reports" className={bnl}><span className="bn-icon">📊</span><span className="bn-label">Reports</span></NavLink>
          </>}
          {isStudent && <>
            <NavLink to="/student" end className={bnl}><span className="bn-icon">🏠</span><span className="bn-label">Home</span></NavLink>
            <NavLink to="/student/planner" className={bnl}><span className="bn-icon">📅</span><span className="bn-label">Planner</span></NavLink>
            <NavLink to="/student/history" className={bnl}><span className="bn-icon">🏆</span><span className="bn-label">History</span></NavLink>
          </>}
          {isManager && <>
            <Link to="/manager" className={managerLinkClass('bottom-nav-link', '')}><span className="bn-icon">🏠</span><span className="bn-label">Home</span></Link>
            <Link to="/manager?view=users" className={managerLinkClass('bottom-nav-link', 'users')}><span className="bn-icon">👤</span><span className="bn-label">Users</span></Link>
            <Link to="/manager?view=students" className={managerLinkClass('bottom-nav-link', 'students')}><span className="bn-icon">🎓</span><span className="bn-label">Students</span></Link>
            <Link to="/manager?view=schedule" className={managerLinkClass('bottom-nav-link', 'schedule')}><span className="bn-icon">🗓️</span><span className="bn-label">Schedule</span></Link>
            <NavLink to="/manager/student-preview" className={bnl}><span className="bn-icon">👁️</span><span className="bn-label">Preview</span></NavLink>
          </>}
          <NavLink to="/profile" className={bnl}><span className="bn-icon">👤</span><span className="bn-label">You</span></NavLink>
        </div>
      </nav>
    </div>
  )
}
