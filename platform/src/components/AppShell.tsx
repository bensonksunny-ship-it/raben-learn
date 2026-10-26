import { useState } from 'react'
import { Link, NavLink, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { avatarClass } from '../lib/userUtils'
import { AppIcon } from './AppIcon'
import { ModuleLauncher, type LauncherItem } from './ModuleLauncher'

export default function AppShell() {
  const { firebaseUser, profile, loading, logout } = useAuth()
  const [launcherOpen, setLauncherOpen] = useState(false)
  // The "You" avatar's own popup — the sidebar itself is always visible now (no
  // open/closed state of its own), so this is just a menu floating on top of it.
  // Shared with the mobile top bar's own avatar button below md (CSS alone
  // decides which of the two trigger/dropdown pairs is actually visible).
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  // The mobile top bar's "☰" — only rendered for admin/manager, opens a
  // slide-out drawer (not a dropdown) standing in for the sidebar's
  // Manager/Preview rail links below md.
  const [drawerOpen, setDrawerOpen] = useState(false)

  if (loading) return <div style={{ minHeight: '100dvh', background: 'var(--bg)' }} />
  if (!firebaseUser) return <Navigate to="/login" replace />
  if (!profile) return <div style={{ minHeight: '100dvh', background: 'var(--bg)' }} />
  if (profile.firstLogin) return <Navigate to="/change-password" replace />

  const isAdmin = profile.roles.includes('admin')
  const isMentor = profile.roles.includes('mentor')
  const isStudent = profile.roles.includes('student')
  const isManager = profile.roles.includes('manager')
  const isConsultant = profile.roles.includes('consultant')

  const srl = ({ isActive }: { isActive: boolean }) => `sidebar-rail-link${isActive ? ' active' : ''}`

  function handleLogout() {
    if (window.confirm('Are you sure you want to sign out?')) void logout()
  }

  // The rail's brand logo doubles as the Home button — one Dashboard destination,
  // picked by role in the same priority the launcher's own role blocks below are
  // listed in. (Manager-only accounts land on the same place their own Manager
  // icon does — that overlap already existed before this was added, for the same
  // reason.)
  const homeTo = isAdmin ? '/admin' : isMentor ? '/mentor' : isStudent ? '/student' : isConsultant ? '/consultant' : '/manager'

  // Legacy docs can lack a `name` entirely (see StudentSelect/StudentsPage for the
  // same fallback) — email, then "?", so this never crashes on an old record.
  const displayName = (profile.name || profile.email || '').trim()
  const initials = displayName ? displayName.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) : '?'

  // Every role's pages except Dashboard — that one's exclusively the sidebar's own
  // Home icon now (see `homeTo` above), not a launcher tile, so it's dropped from
  // every block below. Reached via the 🏠 launcher-fab button. Manager/Preview
  // Student View are deliberately left out too: they live as icon-only links in
  // the sidebar rail instead (see below), not as launcher tiles — the launcher is
  // for actionable modules/apps. "You" isn't here either — it's the avatar pinned
  // to the bottom of the sidebar rail now, not a launcher tile.
  const launcherItems: LauncherItem[] = [
    ...(isAdmin ? [
      { to: '/admin/students', label: 'Students', icon: '🎓' },
      { to: '/admin/users', label: 'Users', icon: '👤' },
      { to: '/admin/syllabus', label: 'Syllabus', icon: '📚' },
      { to: '/schedule', label: 'Schedule', icon: '🗓️' },
      { to: '/live-class', label: 'Live Class', icon: '🟢' },
      { to: '/admin/reports', label: 'Reports', icon: '📊' },
    ] : []),
    ...(isMentor ? [
      { to: '/mentor/syllabus', label: 'Syllabus', icon: '📚' },
      { to: '/live-class', label: 'Live Class', icon: '🟢' },
      { to: '/mentor/reports', label: 'Reports', icon: '📊' },
    ] : []),
    ...(isStudent ? [
      { to: '/student/planner', label: "Today's Plan", icon: '📅' },
      { to: '/student/history', label: 'History', icon: '🏆' },
      { to: '/exam', label: 'Exams', icon: '📝' },
    ] : []),
    ...(isManager ? [
      { to: '/manager?view=users', label: 'Users', icon: '👤' },
      { to: '/manager?view=students', label: 'Students', icon: '🎓' },
      { to: '/manager?view=schedule', label: 'Schedule', icon: '🗓️' },
      { to: '/live-class', label: 'Live Class', icon: '🟢' },
    ] : []),
  ]

  return (
    <div className="shell">
      {/* Sidebar — an ultra-minimal icon rail, always visible on every screen size
          (no hamburger trigger, no slide-in overlay): the brand mark itself *is*
          the Home button now — click the logo to go to Dashboard, no separate
          🏠 icon beside it — then Manager/Preview (admin & manager only), then
          the "You" profile avatar (its own popup — View Profile / Sign Out)
          pinned to the bottom. Every other route lives in the launcher grid
          instead (see `launcherItems` above). */}
      <aside className="sidebar">
        <NavLink to={homeTo} end className={({ isActive }) => `sidebar-brand-home${isActive ? ' active' : ''}`} title="Home" aria-label="Home — go to Dashboard">
          <AppIcon className="sidebar-brand-icon" />
        </NavLink>
        {(isAdmin || isManager) && (
          <div className="sidebar-rail-links">
            <NavLink to="/manager" end className={srl} title="Manager" aria-label="Manager">🧑‍💼</NavLink>
            <NavLink to="/manager/student-preview" className={srl} title="Preview Student View" aria-label="Preview Student View">👁️</NavLink>
            <NavLink to="/manager/consultant-preview" className={srl} title="Preview Consultant View" aria-label="Preview Consultant View">📖</NavLink>
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

      {/* Mobile-only compact top bar — hidden on desktop via CSS, and the sidebar
          above hides itself below the same breakpoint, so exactly one of the two
          is ever visible. Left cluster: hamburger (admin/manager only) + Home,
          grouped together at top-left. Right side: just the "You" avatar, kept
          isolated so it's never mistaken for part of the menu trigger. */}
      <header className="mobile-topbar">
        <div className="mobile-topbar-left">
          {(isAdmin || isManager) && (
            <button
              type="button"
              className="mobile-topbar-btn mobile-topbar-hamburger"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-haspopup="menu"
              aria-expanded={drawerOpen}
            >
              ☰
            </button>
          )}
          <NavLink to={homeTo} end className="mobile-topbar-home" title="Home" aria-label="Home — go to Dashboard">
            <AppIcon className="mobile-topbar-icon" />
          </NavLink>
        </div>
        <div className="mobile-topbar-actions">
          <div className="profile-menu-wrap">
            {profileMenuOpen && <div className="profile-menu-backdrop" onClick={() => setProfileMenuOpen(false)} />}
            <button
              type="button"
              className={`profile-menu-trigger mobile-topbar-avatar ${avatarClass(profile.roles)}`}
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
        </div>
      </header>

      {/* Mobile drawer — the hamburger's target. Slides out from the left edge
          over the page content (not a dropdown); mirrors the desktop sidebar
          rail's Home + Manager/Preview links. Only reachable via the hamburger
          above, so it never opens on desktop. */}
      {(isAdmin || isManager) && (
        <>
          <div className={`mobile-drawer-backdrop${drawerOpen ? ' open' : ''}`} onClick={() => setDrawerOpen(false)} />
          <aside className={`mobile-drawer${drawerOpen ? ' open' : ''}`}>
            <NavLink to={homeTo} end className={({ isActive }) => `sidebar-brand-home${isActive ? ' active' : ''}`} title="Home" aria-label="Home — go to Dashboard" onClick={() => setDrawerOpen(false)}>
              <AppIcon className="sidebar-brand-icon" />
            </NavLink>
            <div className="sidebar-rail-links">
              <NavLink to="/manager" end className={srl} title="Manager" aria-label="Manager" onClick={() => setDrawerOpen(false)}>🧑‍💼</NavLink>
              <NavLink to="/manager/student-preview" className={srl} title="Preview Student View" aria-label="Preview Student View" onClick={() => setDrawerOpen(false)}>👁️</NavLink>
              <NavLink to="/manager/consultant-preview" className={srl} title="Preview Consultant View" aria-label="Preview Consultant View" onClick={() => setDrawerOpen(false)}>📖</NavLink>
            </div>
          </aside>
        </>
      )}

      {/* .kid-theme here (not on individual pages) re-themes every view in one place —
          pastel background, rounded corners, playful fonts — via the shared CSS custom
          properties almost every existing class (.panel, .btn, .modal, .tag, inputs…)
          already reads off. Pages that still declare their own `kid-theme` wrapper
          (Schedule, Syllabus, Manager Dashboard) just redeclare the same variables —
          harmless, not worth churning those files to remove now. */}
      <main className="main"><div className="kid-theme"><Outlet /></div></main>

      {/* No separate mobile bottom nav — the launcher below (reachable from the same
          🏠 button on every screen size) already lists every page and menu, and the
          always-visible sidebar above covers Home/Manager/Preview/Sign out. A
          second, always-visible nav bar duplicating the same links was redundant
          with it. */}
      <button type="button" className="launcher-fab" aria-label="Open app launcher" onClick={() => setLauncherOpen(true)}>
        🏠
      </button>

      <ModuleLauncher items={launcherItems} open={launcherOpen} onClose={() => setLauncherOpen(false)} />
    </div>
  )
}
