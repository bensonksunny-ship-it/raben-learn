import pngtreeOnline from '../assets/pngtree-online-education-and-learning-apps-for-android-and-ios-image_13202565.jpg'

export function DashboardImageCard() {
  return (
    <section className="panel" style={{ marginTop: '1.75rem', padding: 0, overflow: 'hidden' }}>
      <img
        src={pngtreeOnline}
        alt="Online education and learning apps"
        style={{ display: 'block', width: '100%', height: 'auto' }}
      />
    </section>
  )
}
