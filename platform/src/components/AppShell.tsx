import { useState } from 'react'
import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { AppIcon } from './AppIcon'
import { ModuleLauncher, type LauncherItem } from './ModuleLauncher'

export default function AppShell() {
  const { firebaseUser, profile, loading, logout } = useAuth()
  const [launcherOpen, setLauncherOpen] = useState(false)

  if (loading) return <div style={{ minHeight: '100dvh', background: 'var(--bg)' }} />
  if (!firebaseUser) return <Navigate to="/login" replace />
  if (!profile) return <div style={{ minHeight: '100dvh', background: 'var(--bg)' }} />
  if (profile.firstLogin) return <Navigate to="/change-password" replace />

  const isAdmin = profile.roles.includes('admin')
  const isMentor = profile.roles.includes('mentor')
  const isStudent = profile.roles.includes('student')
  const isManager = profile.roles.includes('manager')

  const srl = ({ isActive }: { isActive: boolean }) => `sidebar-rail-link${isActive ? ' active' : ''}`

  function handleLogout() {
    if (window.confirm('Are you sure you want to sign out?')) void logout()
  }

  // The one place every role's pages are listed, on every screen size — reached via
  // the 🏠 launcher-fab button below. Manager/Preview Student View are deliberately
  // left out: they live as icon-only
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

      {/* No separate mobile bottom nav — the launcher below (reachable from the same
          🏠 button on every screen size) already lists every page and menu, and the
          sidebar rail (kept visible on mobile too, see index.css) covers Manager/
          Preview/Sign out. A second, always-visible nav bar duplicating the same
          links was redundant with it. */}
      <button type="button" className="launcher-fab" aria-label="Open app launcher" onClick={() => setLauncherOpen(true)}>
        🏠
      </button>

      <ModuleLauncher items={launcherItems} open={launcherOpen} onClose={() => setLauncherOpen(false)} />
    </div>
  )
}
