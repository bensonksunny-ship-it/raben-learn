import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProfilePage() {
  const { profile, logout } = useAuth()

  function handleLogout() {
    if (window.confirm('Are you sure you want to sign out?')) void logout()
  }

  if (!profile) return null

  const isAdmin = profile.roles.includes('admin')
  const initials = profile.name.trim().split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '1.5rem' }}>You</h1>

      {/* Profile card */}
      <section className="panel" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '1.4rem', color: '#fff',
            background: isAdmin
              ? 'linear-gradient(135deg, #7c3aed, #a78bfa)'
              : profile.roles.includes('mentor')
                ? 'linear-gradient(135deg, #d97706, #fbbf24)'
                : 'linear-gradient(135deg, var(--primary), #60a5fa)',
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.2 }}>{profile.name}</div>
            <div style={{ color: 'var(--muted-2)', fontSize: '0.88rem', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.email}</div>
            <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
              {profile.roles.map((r) => (
                <span key={r} className={`role-chip ${r}`}>{r}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Admin-only: User Management */}
      {isAdmin && (
        <section className="panel" style={{ marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Admin</h2>
          <Link to="/admin/users" className="dash-action-link">
            <span style={{ fontSize: '1.3rem' }}>👤</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>User Management</div>
              <div className="muted small">Roles, passwords, accounts</div>
            </div>
            <span style={{ marginLeft: 'auto', color: 'var(--muted-2)' }}>›</span>
          </Link>
        </section>
      )}

      {/* Sign out */}
      <section className="panel">
        <button type="button" className="btn" onClick={handleLogout}
          style={{ width: '100%', justifyContent: 'center', color: 'var(--danger)', borderColor: '#ffc7c7', background: '#fff0f0' }}>
          Sign out
        </button>
      </section>
    </div>
  )
}
