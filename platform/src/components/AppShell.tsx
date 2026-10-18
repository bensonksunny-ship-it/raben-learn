import { useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { AppIcon } from './AppIcon'
import { ModuleLauncher, type LauncherItem } from './ModuleLauncher'

export default function AppShell() {
  const { firebaseUser, profile, loading, logout } = useAuth()
  const location = useLocation()
  const [launcherOpen, setLauncherOpen] = useState(false)

  if (loading) return <div style={{ minHeight: '100dvh', background: 'var(--bg)' }} />
  if (!firebaseUser) return <Navigate to="/login" replace />
  if (!profile) return <div style={{ minHeight: '100dvh', background: 'var(--bg)' }} />
  if (profile.firstLogin) return <Navigate to="/change-password" replace />

  const isAdmin = profile.roles.includes('admin')
  const isMentor = profile.roles.includes('mentor')
  const isStudent = profile.roles.includes('student')
  const isManager = profile.roles.includes('manager')

  const bnl = ({ isActive }: { isActive: boolean }) => `bottom-nav-link${isActive ? ' active' : ''}`
  const srl = ({ isActive }: { isActive: boolean }) => `sidebar-rail-link${isActive ? ' active' : ''}`

  // Manager's Users/Students/Schedule links point at /manager?view=... (they open as a
  // popup over the dashboard, not a real navigation — see ManagerDashboard), so NavLink's
  // own pathname-only matching can't tell them apart. Compute "active" from the ?view=
  // param ourselves instead; `managerView` of '' means the plain Dashboard link.
  const managerView = isManager && location.pathname === '/manager' ? (new URLSearchParams(location.search).get('view') ?? '') : null
  function managerLinkClass(base: string, view: string) { return `${base}${managerView === view ? ' active' : ''}` }

  function handleLogout() {
    if (window.confirm('Are you sure you want to sign out?')) void logout()
  }

  // Mirrors the per-role nav/bottom-nav lists below one-for-one — same routes,
  // same labels — so the launcher is just another way to reach the same places.
  // Manager/Preview Student View are deliberately left out: they live as icon-only
  // links in the sidebar rail instead (see below), not as launcher tiles — the
  // launcher is for actionable modules/apps, not these two view-switching links.
  const launcherItems: LauncherItem[] = [
    ...(isAdmin ? [
      { to: '/admin', label: 'Dashboard', icon: '🏠' },
      { to: '/admin/students', label: 'Students', icon: '🎓' },
      { to: '/admin/users', label: 'Users', icon: '👤' },
      { to: '/admin/syllabus', label: 'Syllabus', icon: '📚' },
      { to: '/schedule', label: 'Schedule', icon: '🗓️' },
      { to: '/admin/reports', label: 'Reports', icon: '📊' },
    ] : []),
    ...(isMentor ? [
      { to: '/mentor', label: 'Dashboard', icon: '🏠' },
      { to: '/mentor/syllabus', label: 'Syllabus', icon: '📚' },
      { to: '/mentor/reports', label: 'Reports', icon: '📊' },
    ] : []),
    ...(isStudent ? [
      { to: '/student', label: 'Dashboard', icon: '🏠' },
      { to: '/student/planner', label: "Today's Plan", icon: '📅' },
      { to: '/student/history', label: 'History', icon: '🏆' },
    ] : []),
    ...(isManager ? [
      { to: '/manager', label: 'Dashboard', icon: '🏠' },
      { to: '/manager?view=users', label: 'Users', icon: '👤' },
      { to: '/manager?view=students', label: 'Students', icon: '🎓' },
      { to: '/manager?view=schedule', label: 'Schedule', icon: '🗓️' },
    ] : []),
    { to: '/profile', label: 'You', icon: '👤' },
  ]

  return (
    <div className="shell">
      {/* Sidebar — desktop. An ultra-minimal icon rail, not a nav list — every
          route it used to link to lives in the launcher grid now (see
          `launcherItems` above), so this is just the brand mark and sign out. */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <AppIcon className="sidebar-brand-icon" />
        </div>
        {(isAdmin || isManager) && (
          <div className="sidebar-rail-links">
            <NavLink to="/manager" end className={srl} title="Manager" aria-label="Manager">🧑‍💼</NavLink>
            <NavLink to="/manager/student-preview" className={srl} title="Preview Student View" aria-label="Preview Student View">👁️</NavLink>
          </div>
        )}
        <button type="button" className="sidebar-rail-action" onClick={handleLogout} title="Sign out" aria-label="Sign out">
          🚪
        </button>
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

      {/* Floating launcher trigger — deliberately its own thing, not part of either
          nav bar, so it reads as "open everything" rather than another nav item. */}
      <button type="button" className="launcher-fab" aria-label="Open app launcher" onClick={() => setLauncherOpen(true)}>
        🏠
      </button>

      <ModuleLauncher items={launcherItems} open={launcherOpen} onClose={() => setLauncherOpen(false)} />
    </div>
  )
}
