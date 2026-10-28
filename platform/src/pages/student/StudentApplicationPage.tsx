import { useAuth } from '../../context/AuthContext'
import { StudentApplicationForm } from '../../components/StudentApplicationForm'

/** A student's own application form — new and existing students alike fill this
 *  in so every student's details, photo and documents are on record. */
export function StudentApplicationPage() {
  const { firebaseUser, profile, refreshProfile } = useAuth()
  if (!firebaseUser || !profile) return null
  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>My Application</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: '1.25rem' }}>
        Please fill in your details with a parent. Fields marked <span style={{ color: 'var(--danger)' }}>*</span> are required.
      </p>
      <div className="panel">
        <StudentApplicationForm
          studentId={firebaseUser.uid}
          defaultName={profile.name}
          mode="student"
          onSaved={() => void refreshProfile()}
        />
      </div>
    </div>
  )
}
