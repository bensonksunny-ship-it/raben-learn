import { OwlMascot } from './manager/OwlMascot'

interface EmptyStateProps {
  title: string
  subtitle?: string
}

/**
 * Shared "no data yet" placeholder — the owl mascot standing in for a generic
 * illustration, instead of a bare emoji or plain text. Used on list pages
 * (Students, Users, …) wherever the list comes back empty.
 */
export function EmptyState({ title, subtitle }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <OwlMascot size={56} />
      <span className="empty-state__title">{title}</span>
      {subtitle ? <span className="empty-state__sub">{subtitle}</span> : null}
    </div>
  )
}
