import pngtreeOnline from '../assets/pngtree-online-education-and-learning-apps-for-android-and-ios-image_13202565.jpg'

export function DashboardImageCard() {
  return (
    <section className="panel dash-banner">
      <img src={pngtreeOnline} alt="" aria-hidden />
      <div className="dash-banner__scrim">
        <span className="dash-banner__title">Everything for the learning journey</span>
        <span className="dash-banner__sub">Courses, daily plans, and progress — all in one place.</span>
      </div>
    </section>
  )
}
