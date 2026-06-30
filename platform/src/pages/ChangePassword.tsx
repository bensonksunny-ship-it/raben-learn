import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function ChangePassword() {
  const { firebaseUser, profile, loading, changePasswordAndClearFirstLogin } = useAuth()
  const [currentPw, setCurrentPw] = useState('')
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')

  if (!loading && (!firebaseUser || !profile)) {
    return <Navigate to="/login" replace />
  }

  if (!loading && profile && !profile.firstLogin) {
    return <Navigate to="/" replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (currentPw.length < 1) {
      setError('Enter your current (temporary) password.')
      return
    }
    if (pw1.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (pw1 !== pw2) {
      setError('Passwords do not match.')
      return
    }
    try {
      await changePasswordAndClearFirstLogin(currentPw, pw1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update password')
    }
  }

  return (
    <div className="shell narrow">
      <h1>Set a new password</h1>
      <p className="muted">For security, replace your temporary password before continuing.</p>
      <form className="form" onSubmit={onSubmit}>
        <label>
          Current (temporary) password
          <input
            type="password"
            autoComplete="current-password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            required
          />
        </label>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" className="btn primary">
          Save and continue
        </button>
      </form>
    </div>
  )
}
