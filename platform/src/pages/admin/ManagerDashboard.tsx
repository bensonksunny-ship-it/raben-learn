import { lazy, Suspense } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { NavCard } from '../../components/manager/NavCard'
import { ManagerWelcomeBanner } from '../../components/manager/ManagerWelcomeBanner'
import { NavigationSidebar } from '../../components/manager/NavigationSidebar'
import { StudentsIcon, MentorsIcon, ScheduleIcon } from '../../components/manager/StatIcons'

// Lazy, same as App.tsx's own routes for these — keeps their (heavier, admin-callable)
// code out of the dashboard's own chunk until a manager actually opens one.
const UserManagement = lazy(() => import('./UserManagement').then((m) => ({ default: m.UserManagement })))
const StudentsPage = lazy(() => import('./StudentsPage').then((m) => ({ default: m.StudentsPage })))
const SchedulePage = lazy(() => import('./SchedulePage').then((m) => ({ default: m.SchedulePage })))

type ManagerView = 'students' | 'users' | 'schedule'

function isManagerView(v: string | null): v is ManagerView {
  return v === 'students' || v === 'users' || v === 'schedule'
}

/**
 * For a manager, every other page (Students/Users/Schedule) opens as a popup over
 * this dashboard instead of navigating away — the URL stays `/manager`, just with
 * a `?view=` param, so the dashboard is the only "page" a manager ever leaves.
 * Reached via a nav card here or the sidebar's Students/Users/Schedule links
 * (AppShell points those at `/manager?view=...` for the manager nav block).
 *
 * The cards below are solid-color navigation tiles, not stat tiles — the page name
 * is the headline, not a number. See `NavCard`.
 *
 * Visual style: scoped `.kid-theme` (same class SchedulePage already uses) gives
 * every panel/button/input here its rounded, pastel, Baloo-2-headed look — including
 * inside the popups below, since they render as descendants of this div. The page's
 * own `<NavigationSidebar />` sits alongside the content, in-theme — AppShell's
 * shared navy sidebar still wraps everything outside this div for branding/sign-out.
 */
export function ManagerDashboard() {
  const { profile } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const rawView = searchParams.get('view')
  const view = isManagerView(rawView) ? rawView : null

  function closeView() { navigate('/manager') }

  return (
    <div className="kid-theme manager-layout">
      <NavigationSidebar />

      <div className="manager-main">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <div>
            <h1 style={{ marginBottom: '0.2rem' }}>Manager Dashboard</h1>
            <p className="muted" style={{ margin: 0 }}>
              Welcome back{profile?.name ? `, ${profile.name}` : ''}
            </p>
          </div>
        </div>

        <ManagerWelcomeBanner />

        <div className="nav-card-grid">
          <NavCard
            icon={<StudentsIcon color="#ffffff" />}
            title="Students"
            subtitle="Create & manage student accounts"
            color="#f97316"
            to="/manager?view=students"
          />
          <NavCard
            icon={<MentorsIcon color="#ffffff" />}
            title="Users"
            subtitle="Create & manage mentor accounts"
            color="#3b82f6"
            to="/manager?view=users"
          />
          <NavCard
            icon={<ScheduleIcon color="#ffffff" />}
            title="Schedule"
            subtitle="Class timetable & student diaries"
            color="#8b5cf6"
            to="/manager?view=schedule"
          />
        </div>

        {view && (
          <div className="modal-backdrop" onClick={closeView}>
            <div className="modal manager-view-modal" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="btn small ghost manager-view-close" onClick={closeView}>✕ Close</button>
              <Suspense fallback={<p className="muted">Loading…</p>}>
                {view === 'students' && <StudentsPage />}
                {view === 'users' && <UserManagement />}
                {view === 'schedule' && <SchedulePage />}
              </Suspense>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
