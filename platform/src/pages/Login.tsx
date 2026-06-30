import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { useAuth } from '../context/AuthContext'
import { auth, db } from '../firebase/config'
import { normalizeRoles } from '../lib/roles'

export function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email.trim(), password)
      const user = auth.currentUser
      if (user) {
        const snap = await getDoc(doc(db, 'users', user.uid))
        if (snap.exists()) {
          const d = snap.data()
          if (d.firstLogin) { navigate('/change-password', { replace: true }); return }
          const roles = normalizeRoles(d)
          if (roles.includes('admin')) navigate('/admin', { replace: true })
          else if (roles.includes('mentor')) navigate('/mentor', { replace: true })
          else navigate('/student', { replace: true })
          return
        }
      }
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Check your email and password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="shell narrow">
      <div className="brand" style={{ textAlign: 'center', marginBottom: '1.5rem', fontSize: '1.15rem' }}>
        🎓 Raben Learn
      </div>
      <h1 style={{ textAlign: 'center', marginBottom: '0.25rem' }}>Sign in</h1>
      <p className="muted small" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        Enter your credentials to continue
      </p>
      {error ? <p className="error" style={{ marginBottom: '0.75rem' }}>{error}</p> : null}
      <form onSubmit={(e) => void handleSubmit(e)} className="form">
        <label>
          Email
          <input type="email" placeholder="you@example.com" value={email}
            onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input type="password" placeholder="••••••••" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button type="submit" className="btn primary" disabled={loading} style={{ marginTop: '0.25rem' }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
export default Login
