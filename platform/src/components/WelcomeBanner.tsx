import { OwlMascot } from './manager/OwlMascot'

interface WelcomeBannerProps {
  title: string
  subtitle: string
}

/**
 * Illustrated welcome banner — owl mascot + title/subtitle — shared by the Admin,
 * Mentor, and Student dashboards. Replaces the old DashboardImageCard (a realistic
 * stock photo) with the same vector mascot ManagerDashboard already uses, so every
 * dashboard's header reads as one consistent, illustrated design system rather than
 * three copies of a photo plus one owl. Each page supplies its own copy.
 */
export function WelcomeBanner({ title, subtitle }: WelcomeBannerProps) {
  return (
    <section className="panel welcome-banner">
      <OwlMascot size={88} />
      <div>
        <span className="welcome-banner__title">{title}</span>
        <span className="welcome-banner__sub">{subtitle}</span>
      </div>
    </section>
  )
}
