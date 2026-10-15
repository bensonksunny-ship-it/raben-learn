import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export interface NavCardProps {
  /** Vector icon (e.g. from StatIcons.tsx) — rendered white so it reads on the solid color below. */
  icon: ReactNode
  /** The destination page's own title — this is the card's primary label, not a metric. */
  title: string
  /** Optional one-line description of what's on that page. */
  subtitle?: string
  /** Solid background color for this card. */
  color: string
  to: string
}

/**
 * A solid-color launcher tile for the Manager Dashboard — one per destination page
 * (Users / Students / Schedule). Unlike `.dash-stat-card` (a number on a pale panel,
 * used by Admin/Student dashboards), this card's whole point is navigation: the page
 * name is the headline, the background carries the color, and the only "value" is
 * the arrow telling you it goes somewhere.
 */
export function NavCard({ icon, title, subtitle, color, to }: NavCardProps) {
  return (
    <Link to={to} className="nav-card" style={{ background: color }}>
      <span className="nav-card-icon" aria-hidden>{icon}</span>
      <span className="nav-card-title">{title}</span>
      {subtitle ? <span className="nav-card-subtitle">{subtitle}</span> : null}
      <span className="nav-card-arrow" aria-hidden>→</span>
    </Link>
  )
}
