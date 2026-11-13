import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { signInWithCustomToken } from 'firebase/auth'
import { publicApplyAuth, publicApplyDb, resolveApplicationLinkToken, completePublicApplyToken } from '../lib/publicApplyLink'
import { StudentApplicationForm } from '../components/StudentApplicationForm'
import type { ApplicationCollection, ApplicationStatus } from '../lib/studentApplication'

type Phase = 'resolving' | 'ready' | 'error' | 'done'

/**
 * What a parent opens from the link staff send them — no account, no login,
 * just this one application's form. Signs into the isolated `publicApplyAuth`/
 * `publicApplyDb` secondary app (see `lib/publicApplyLink.ts`) with a custom
 * token the `resolveApplicationLink` Cloud Function mints only if `:token`
 * still matches that application's live link — so an already-submitted or
 * since-resent link just fails to open instead of showing a stale form.
 * Submitting marks the link used (`completePublicApplyToken`); a correction
 * afterwards needs a fresh link from staff, not a reopen of this one.
 */
export default function PublicApplyPage() {
  const { token } = useParams<{ token: string }>()
  const [phase, setPhase] = useState<Phase>('resolving')
  const [error, setError] = useState('')
  const [resolved, setResolved] = useState<{ coll: ApplicationCollection; studentId: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!token) {
        if (!cancelled) { setError('This link is missing its token.'); setPhase('error') }
        return
      }
      try {
        const r = await resolveApplicationLinkToken(token)
        await signInWithCustomToken(publicApplyAuth, r.customToken)
        if (!cancelled) { setResolved({ coll: r.coll, studentId: r.studentId }); setPhase('ready') }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'This link could not be opened.')
          setPhase('error')
        }
      }
    })()
    return () => { cancelled = true }
  }, [token])

  function handleSaved(status: ApplicationStatus) {
    if (status !== 'submitted' || !token) return
    void completePublicApplyToken(token)
    setPhase('done')
  }

  if (phase === 'resolving') {
    return <NarrowShell><p className="muted" style={{ fontSize: '1.1rem' }}>Opening the application…</p></NarrowShell>
  }
  if (phase === 'error') {
    return (
      <NarrowShell>
        <span style={{ fontSize: '2.5rem' }}>📋</span>
        <h2 style={{ margin: '0.5rem 0 0.25rem' }}>Can't open this link</h2>
        <p className="error" style={{ margin: 0 }}>{error}</p>
      </NarrowShell>
    )
  }
  if (phase === 'done') {
    return (
      <NarrowShell>
        <span style={{ fontSize: '2.5rem' }}>✅</span>
        <h2 style={{ margin: '0.5rem 0 0.25rem' }}>Submitted — thank you!</h2>
        <p className="muted" style={{ margin: 0 }}>The office has your application. This link is now closed; they'll send a fresh one if anything needs fixing.</p>
      </NarrowShell>
    )
  }

  return (
    <div className="kid-theme" style={{ minHeight: '100dvh', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Student Application</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: '1.25rem' }}>
          Please fill in these details with a parent. Fields marked <span style={{ color: 'var(--danger)' }}>*</span> are required.
        </p>
        <div className="panel">
          {resolved && (
            <StudentApplicationForm
              studentId={resolved.studentId}
              defaultName=""
              mode="public"
              coll={resolved.coll}
              db={publicApplyDb}
              onSaved={handleSaved}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** Loading/error/done states only — the form itself uses the wider layout
 *  above. Opens straight from a shared link, never through app nav, so it
 *  stands alone rather than reusing `<AppShell>`. */
function NarrowShell({ children }: { children: ReactNode }) {
  return (
    <div className="kid-theme" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
      <div className="panel" style={{ maxWidth: 420, width: '100%', textAlign: 'center', padding: '2rem 1.5rem' }}>
        {children}
      </div>
    </div>
  )
}
