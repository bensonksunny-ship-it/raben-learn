import { OwlMascot } from './OwlMascot'

/**
 * Manager Dashboard's own welcome banner — an illustrated owl instead of the
 * realistic stock photo the other dashboards use (DashboardImageCard). Kept
 * local to the manager pages rather than changing the shared component, so
 * Admin/Mentor/Student dashboards are untouched.
 */
export function ManagerWelcomeBanner() {
  return (
    <section className="panel manager-welcome-banner">
      <OwlMascot size={88} />
      <div>
        <span className="manager-welcome-banner__title">Hoo's ready to manage today?</span>
        <span className="manager-welcome-banner__sub">Students, mentors, and the class schedule — all in one place.</span>
      </div>
    </section>
  )
}
