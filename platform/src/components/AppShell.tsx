import { useState } from 'react'
import { Link, NavLink, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { avatarClass } from '../lib/userUtils'
import { AppIcon } from './AppIcon'
import { ModuleLauncher, type LauncherItem } from './ModuleLauncher'

export default function AppShell() {
  const { firebaseUser, profile, loading, logout } = useAuth()
  const [launcherOpen, setLauncherOpen] = useState(false)
  // Sidebar is hidden by default now — the ☰ trigger (fixed top-left, always on
  // screen) slides it in as an overlay instead of it taking up permanent layout
  // width. Closes itself on a nav click, a backdrop click, or the trigger again.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // The "You" avatar's own popup — separate from the sidebar's open/closed state,
  // since it's a menu on top of the (already open) sidebar, not another overlay.
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)

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

  // Legacy docs can lack a `name` entirely (see StudentSelect/StudentsPage for the
  // same fallback) — email, then "?", so this never crashes on an old record.
  const displayName = (profile.name || profile.email || '').trim()
  const initials = displayName ? displayName.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) : '?'

  // The one place every role's pages are listed, on every screen size — reached via
  // the 🏠 launcher-fab button below. Manager/Preview Student View are deliberately
  // left out: they live as icon-only
  // links in the sidebar rail instead (see below), not as launcher tiles — the
  // launcher is for actionable modules/apps, not these two view-switching links.
  // "You" isn't here either — it's the avatar pinned to the bottom of the sidebar
  // rail now, not a launcher tile.
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
  ]

  return (
    <div className="shell">
      {/* Single trigger — always on screen, top-left — that slides the sidebar in/out. */}
      <button
        type="button"
        className="sidebar-toggle"
        aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen((v) => !v)}
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* Click-away target — only present while open. */}
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar — an ultra-minimal icon rail, hidden off-screen until the ☰ trigger
          above opens it. Every route it used to link to lives in the launcher grid
          now (see `launcherItems` above), so this is just the brand mark and the
          "You" profile avatar (its own popup — View Profile / Sign Out). */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <AppIcon className="sidebar-brand-icon" />
        </div>
        {(isAdmin || isManager) && (
          <div className="sidebar-rail-links">
            <NavLink to="/manager" end className={srl} title="Manager" aria-label="Manager" onClick={() => setSidebarOpen(false)}>🧑‍💼</NavLink>
            <NavLink to="/manager/student-preview" className={srl} title="Preview Student View" aria-label="Preview Student View" onClick={() => setSidebarOpen(false)}>👁️</NavLink>
          </div>
        )}
        <div className="profile-menu-wrap">
          {profileMenuOpen && <div className="profile-menu-backdrop" onClick={() => setProfileMenuOpen(false)} />}
          <button
            type="button"
            className={`profile-menu-trigger ${avatarClass(profile.roles)}`}
            onClick={() => setProfileMenuOpen((v) => !v)}
            title="You"
            aria-label="Profile menu"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
          >
            {initials}
          </button>
          {profileMenuOpen && (
            <div className="profile-menu-dropdown" role="menu">
              <Link to="/profile" className="profile-menu-item" role="menuitem" onClick={() => setProfileMenuOpen(false)}>
                👤 View Profile
              </Link>
              <button
                type="button"
                className="profile-menu-item danger"
                role="menuitem"
                onClick={() => { setProfileMenuOpen(false); handleLogout() }}
              >
                🚪 Sign Out
              </button>
            </div>
          )}
        </div>
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
          ☰-triggered sidebar above covers Manager/Preview/Sign out. A second,
          always-visible nav bar duplicating the same links was redundant with it. */}
      <button type="button" className="launcher-fab" aria-label="Open app launcher" onClick={() => setLauncherOpen(true)}>
        🏠
      </button>

      <ModuleLauncher items={launcherItems} open={launcherOpen} onClose={() => setLauncherOpen(false)} />
    </div>
  )
}
