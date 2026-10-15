import { Link, useLocation } from 'react-router-dom'
import { OwlMascot } from './OwlMascot'

interface NavItem {
  /** '' means the plain Dashboard link (no ?view= param). */
  view: '' | 'students' | 'users' | 'schedule'
  label: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { view: '', label: 'Dashboard', icon: '🏠' },
  { view: 'students', label: 'Students', icon: '🎓' },
  { view: 'users', label: 'Users', icon: '👤' },
  { view: 'schedule', label: 'Schedule', icon: '🗓️' },
]

/**
 * The Manager Dashboard's own pastel, rounded navigation rail — distinct from
 * AppShell's shared navy `.sidebar` (which still provides branding/sign-out for
 * every role and stays in place around this). This one is scoped to the manager
 * area's own pages: Dashboard/Students/Users/Schedule, the same `?view=` links
 * AppShell's manager nav block points at, so the two never fall out of sync.
 */
export function NavigationSidebar() {
  const location = useLocation()
  const activeView = location.pathname === '/manager' ? (new URLSearchParams(location.search).get('view') ?? '') : ''

  return (
    <nav className="manager-nav" aria-label="Manager sections">
      <div className="manager-nav-brand">
        <OwlMascot size={40} />
        <span className="manager-nav-brand-label">Manager</span>
      </div>
      <ul className="manager-nav-list">
        {NAV_ITEMS.map((item) => {
          const to = item.view ? `/manager?view=${item.view}` : '/manager'
          const isActive = activeView === item.view
          return (
            <li key={item.view}>
              <Link to={to} className={`manager-nav-link${isActive ? ' active' : ''}`} aria-current={isActive ? 'page' : undefined}>
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
