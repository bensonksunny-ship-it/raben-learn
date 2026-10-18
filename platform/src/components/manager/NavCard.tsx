import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export interface NavCardProps {
  /** Vector icon (e.g. from StatIcons.tsx) — rendered white so it reads on the solid color below.
   *  Omitted entirely in `minimal` mode. */
  icon?: ReactNode
  /** The destination page's own title — this is the card's primary label, not a metric. */
  title: string
  /** Optional one-line description of what's on that page. Ignored in `minimal` mode. */
  subtitle?: string
  /** Solid background color for this card. */
  color: string
  to: string
  /** Strips the card down to just the bold title, centered — no icon, subtitle, or
   *  arrow. Used by the Student dashboard's simplified action cards. */
  minimal?: boolean
  /** Tighter padding/min-height than `minimal`'s own (roomier) sizing — for dense
   *  layouts like the Student Preview tool, where the cards should stay small. */
  compact?: boolean
}

/**
 * A solid-color launcher tile — one per destination page (e.g. Manager Dashboard's
 * Users / Students / Schedule). Unlike `.dash-stat-card` (a number on a pale panel,
 * used by Admin/Student dashboards), this card's whole point is navigation: the page
 * name is the headline, the background carries the color, and the only "value" is
 * the arrow telling you it goes somewhere — unless `minimal` drops even that.
 */
export function NavCard({ icon, title, subtitle, color, to, minimal, compact }: NavCardProps) {
  if (minimal) {
    return (
      <Link to={to} className={`nav-card nav-card-minimal${compact ? ' nav-card-compact' : ''}`} style={{ background: color }}>
        <span className="nav-card-title">{title}</span>
      </Link>
    )
  }
  return (
    <Link to={to} className={`nav-card${compact ? ' nav-card-compact' : ''}`} style={{ background: color }}>
      {icon ? <span className="nav-card-icon" aria-hidden>{icon}</span> : null}
      <span className="nav-card-title">{title}</span>
      {subtitle ? <span className="nav-card-subtitle">{subtitle}</span> : null}
      <span className="nav-card-arrow" aria-hidden>→</span>
    </Link>
  )
}
