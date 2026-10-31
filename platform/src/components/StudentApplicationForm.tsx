import { useEffect, useState, type ReactNode } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { formatFirebaseError } from '../lib/formatFirebaseError'
import {
  FILE_KIND_LABEL, deleteApplicationFile, loadApplication, loadApplicationFile, needsParentDeclaration,
  saveApplication, uploadApplicationFile, validateApplication,
  type ApplicationCollection, type ApplicationFileKind, type ApplicationStatus, type StudentApplication,
} from '../lib/studentApplication'
import type { Course } from '../types'

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: 'Not submitted yet',
  submitted: 'Submitted — waiting for review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  recruited: 'Recruited',
}

export function ApplicationStatusTag({ status }: { status: ApplicationStatus | null }) {
  if (!status) return <span className="tag">Not started</span>
  const cls = status === 'changes_requested' ? 'danger' : ''
  const style = status === 'approved' || status === 'recruited' ? { background: '#e7f6ee', borderColor: '#b9e3cc', color: 'var(--green)' } : undefined
  return <span className={`tag ${cls}`} style={style}>{STATUS_LABEL[status]}</span>
}

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Opens a stored data URL in a new tab via a blob URL (browsers block direct
 *  top-level navigation to `data:` URLs). */
function openDataUrl(dataUrl: string) {
  const [head, b64] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(head ?? '')?.[1] ?? 'application/octet-stream'
  const bytes = Uint8Array.from(atob(b64 ?? ''), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  window.open(url, '_blank', 'noopener')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

interface Props {
  studentId: string
  /** Pre-fills the name on a brand-new application. */
  defaultName: string
  /** 'student' fills in and submits their own form; 'staff' can edit, approve,
   *  or send it back with a note; 'applicant' is staff entering a prospective
   *  student (no account yet) from "+ New Student" — saved to `applicants`. */
  mode: 'student' | 'staff' | 'applicant'
  reviewerId?: string
  /** Applicant mode only — the courses offered as "Target level / syllabus". */
  courses?: Course[]
  /** Called after any save, with the new status (e.g. so a list can refresh). */
  onSaved?: (status: ApplicationStatus) => void
}

/**
 * The student application form — student details, parents/emergency contact,
 * and documents (photo, ID card, birth certificate; a parent's ID card plus a
 * declaration in place of a missing one). Uploads save straight away; the text
 * fields save on "Save draft"/"Submit" (or the staff actions).
 */
export function StudentApplicationForm({ studentId, defaultName, mode, reviewerId, courses = [], onSaved }: Props) {
  const coll: ApplicationCollection = mode === 'applicant' ? 'applicants' : 'student_applications'
  const asStaff = mode !== 'student'
  const [app, setApp] = useState<StudentApplication | null>(null)
  const [savedStatus, setSavedStatus] = useState<ApplicationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState<ApplicationFileKind | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showMissing, setShowMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadApplication(studentId, defaultName, coll)
      .then(({ app: a, exists }) => { if (!cancelled) { setApp(a); setSavedStatus(exists ? a.status : null) } })
      .catch((e) => { if (!cancelled) setError(formatFirebaseError(e, 'Could not load the application')) })
    return () => { cancelled = true }
  }, [studentId, defaultName, coll])

  if (!app) {
    return error ? <p className="error">{error}</p> : <p className="muted">Loading application…</p>
  }

  const locked = (mode === 'student' && app.status === 'approved') || app.status === 'recruited'
  const missing = validateApplication(app)
  const set = (patch: Partial<StudentApplication>) => { setApp({ ...app, ...patch }); setNotice('') }

  /** The status a save keeps when nothing is being submitted/approved. */
  const keepStatus: ApplicationStatus = app.status

  async function persist(next: StudentApplication, status: ApplicationStatus, message: string) {
    setBusy(true); setError(''); setNotice('')
    try {
      await saveApplication(next, status, { asStaff, reviewerId, collection: coll })
      // Keep the account's display name in step with the application.
      if (mode === 'student' && status === 'submitted' && next.fullName.trim()) {
        await updateDoc(doc(db, 'users', studentId), { name: next.fullName.trim() })
      }
      setApp({ ...next, status })
      setSavedStatus(status)
      setNotice(message)
      onSaved?.(status)
    } catch (e) {
      setError(formatFirebaseError(e, 'Could not save the application'))
    } finally {
      setBusy(false)
    }
  }

  async function onPickFile(kind: ApplicationFileKind, file: File | undefined) {
    if (!file || !app) return
    setUploading(kind); setError(''); setNotice('')
    try {
      const meta = await uploadApplicationFile(studentId, kind, file)
      const next = { ...app, files: { ...app.files, [kind]: meta } }
      await saveApplication(next, savedStatus ?? 'draft', { asStaff, reviewerId, collection: coll })
      setApp({ ...next, status: savedStatus ?? 'draft' })
      setSavedStatus(savedStatus ?? 'draft')
    } catch (e) {
      setError(formatFirebaseError(e, 'Upload failed'))
    } finally {
      setUploading(null)
    }
  }

  async function onRemoveFile(kind: ApplicationFileKind) {
    if (!app || !window.confirm(`Remove the ${FILE_KIND_LABEL[kind].toLowerCase()}?`)) return
    setUploading(kind); setError('')
    try {
      await deleteApplicationFile(studentId, kind)
      const files = { ...app.files }
      delete files[kind]
      const next = { ...app, files }
      await saveApplication(next, savedStatus ?? 'draft', { asStaff, reviewerId, collection: coll })
      setApp({ ...next, status: savedStatus ?? 'draft' })
      setSavedStatus(savedStatus ?? 'draft')
    } catch (e) {
      setError(formatFirebaseError(e, 'Could not remove the file'))
    } finally {
      setUploading(null)
    }
  }

  function submit() {
    if (!app) return
    if (missing.length > 0) { setShowMissing(true); return }
    void persist(app, 'submitted', 'Application submitted. Thank you!')
  }

  function saveApplicant() {
    if (!app) return
    const email = app.email.trim()
    if (!app.fullName.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      setError('Enter the applicant’s full name and a valid email (used for their login when recruited).')
      return
    }
    void persist({ ...app, email }, 'submitted', 'Application saved — find it under Applications to recruit.')
  }

  function approve() {
    if (!app) return
    if (missing.length > 0 && !window.confirm(`This application is still missing:\n• ${missing.join('\n• ')}\n\nApprove anyway?`)) return
    void persist({ ...app, reviewNote: '' }, 'approved', 'Application approved.')
  }

  function requestChanges() {
    if (!app) return
    if (!app.reviewNote.trim()) { setError('Write a note telling the student what to change first.'); return }
    void persist(app, 'changes_requested', 'Sent back to the student with your note.')
  }

  const declarationFor = [!app.hasStudentId && 'an ID card', !app.hasBirthCertificate && 'a birth certificate'].filter(Boolean).join(' or ')
  const decl = app.declaration ?? { parentName: '', relation: '', agreed: false, signedOn: todayLocal() }

  return (
    <div className="application-form">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <ApplicationStatusTag status={savedStatus} />
        {mode === 'student' && app.status === 'changes_requested' && app.reviewNote && (
          <span className="small" style={{ color: 'var(--danger)' }}>Office note: {app.reviewNote}</span>
        )}
      </div>
      {locked && (
        <p className="muted small" style={{ marginTop: 0 }}>
          {app.status === 'recruited'
            ? 'This applicant has been recruited — their application now lives on their student record.'
            : 'Your application has been approved. To change anything, please contact the office.'}
        </p>
      )}

      <fieldset disabled={locked || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {mode === 'applicant' && (
          <Section title="Admission">
            <Field label="Login email (used to create their account when recruited)" required>
              <input type="email" value={app.email} onChange={(e) => set({ email: e.target.value })} placeholder="name@example.com" />
            </Field>
            <div className="small" style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Target level / syllabus</div>
            <div style={{ display: 'flex', gap: '0.5rem 1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              {courses.map((c) => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 400 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={app.targetCourseIds.includes(c.id)}
                    onChange={() => set({
                      targetCourseIds: app.targetCourseIds.includes(c.id)
                        ? app.targetCourseIds.filter((x) => x !== c.id)
                        : [...app.targetCourseIds, c.id],
                    })}
                  />
                  {c.title}
                </label>
              ))}
              {courses.length === 0 && <span className="muted small">No courses yet.</span>}
            </div>
          </Section>
        )}
        <Section title="Student details">
          <Grid>
            <Field label="Full name" required><input value={app.fullName} onChange={(e) => set({ fullName: e.target.value })} /></Field>
            <Field label="Date of birth" required><input type="date" value={app.dateOfBirth} onChange={(e) => set({ dateOfBirth: e.target.value })} /></Field>
            <Field label="Gender" required>
              <select value={app.gender} onChange={(e) => set({ gender: e.target.value })}>
                <option value="">Select…</option><option>Male</option><option>Female</option><option>Other</option>
              </select>
            </Field>
            <Field label="Blood group">
              <select value={app.bloodGroup} onChange={(e) => set({ bloodGroup: e.target.value })}>
                <option value="">Don't know</option>
                {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((g) => <option key={g}>{g}</option>)}
              </select>
            </Field>
            <Field label="Student's phone"><input type="tel" value={app.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
            <Field label="School name"><input value={app.schoolName} onChange={(e) => set({ schoolName: e.target.value })} /></Field>
            <Field label="Class / grade"><input value={app.grade} onChange={(e) => set({ grade: e.target.value })} placeholder="e.g. 7" /></Field>
          </Grid>
          <Field label="Home address" required>
            <textarea rows={2} value={app.address} onChange={(e) => set({ address: e.target.value })} />
          </Field>
        </Section>

        <Section title="Parents & emergency contact">
          <Grid>
            <Field label="Father's name"><input value={app.fatherName} onChange={(e) => set({ fatherName: e.target.value })} /></Field>
            <Field label="Father's phone"><input type="tel" value={app.fatherPhone} onChange={(e) => set({ fatherPhone: e.target.value })} /></Field>
            <Field label="Father's occupation"><input value={app.fatherOccupation} onChange={(e) => set({ fatherOccupation: e.target.value })} /></Field>
            <Field label="Mother's name"><input value={app.motherName} onChange={(e) => set({ motherName: e.target.value })} /></Field>
            <Field label="Mother's phone"><input type="tel" value={app.motherPhone} onChange={(e) => set({ motherPhone: e.target.value })} /></Field>
            <Field label="Mother's occupation"><input value={app.motherOccupation} onChange={(e) => set({ motherOccupation: e.target.value })} /></Field>
            <Field label="Parent's email"><input type="email" value={app.parentEmail} onChange={(e) => set({ parentEmail: e.target.value })} /></Field>
          </Grid>
          <Grid>
            <Field label="Emergency contact name" required><input value={app.emergencyName} onChange={(e) => set({ emergencyName: e.target.value })} /></Field>
            <Field label="Relation"><input value={app.emergencyRelation} onChange={(e) => set({ emergencyRelation: e.target.value })} placeholder="e.g. Uncle" /></Field>
            <Field label="Emergency phone" required><input type="tel" value={app.emergencyPhone} onChange={(e) => set({ emergencyPhone: e.target.value })} /></Field>
          </Grid>
          <Field label="Allergies / medical notes">
            <textarea rows={2} value={app.medicalNotes} onChange={(e) => set({ medicalNotes: e.target.value })} />
          </Field>
        </Section>

        <Section title="Photo & documents">
          <FileSlot kind="photo" app={app} studentId={studentId} uploading={uploading} disabled={locked} onPick={onPickFile} onRemove={onRemoveFile} required />

          <YesNo
            label="Does the student have an ID card (e.g. Aadhaar)?"
            value={app.hasStudentId}
            onChange={(v) => set({ hasStudentId: v })}
          />
          {app.hasStudentId && (
            <>
              <Grid>
                <Field label="ID card type"><input value={app.studentIdType} onChange={(e) => set({ studentIdType: e.target.value })} placeholder="e.g. Aadhaar" /></Field>
                <Field label="ID number"><input value={app.studentIdNumber} onChange={(e) => set({ studentIdNumber: e.target.value })} /></Field>
              </Grid>
              <FileSlot kind="student_id" app={app} studentId={studentId} uploading={uploading} disabled={locked} onPick={onPickFile} onRemove={onRemoveFile} required />
            </>
          )}

          <YesNo
            label="Does the student have a birth certificate?"
            value={app.hasBirthCertificate}
            onChange={(v) => set({ hasBirthCertificate: v })}
          />
          {app.hasBirthCertificate && (
            <FileSlot kind="birth_certificate" app={app} studentId={studentId} uploading={uploading} disabled={locked} onPick={onPickFile} onRemove={onRemoveFile} required />
          )}

          {needsParentDeclaration(app) && (
            <div className="panel" style={{ background: 'var(--surface-soft)', marginTop: '1rem' }}>
              <h4 style={{ margin: '0 0 0.75rem' }}>Parent's ID card & declaration</h4>
              <Grid>
                <Field label="Parent's name on the ID"><input value={app.parentIdName} onChange={(e) => set({ parentIdName: e.target.value })} /></Field>
                <Field label="ID card type"><input value={app.parentIdType} onChange={(e) => set({ parentIdType: e.target.value })} placeholder="e.g. Aadhaar" /></Field>
              </Grid>
              <FileSlot kind="parent_id" app={app} studentId={studentId} uploading={uploading} disabled={locked} onPick={onPickFile} onRemove={onRemoveFile} required />

              <div style={{ marginTop: '1rem' }}>
                <strong className="small">Declaration</strong>
                <Grid>
                  <Field label="Parent / guardian full name" required>
                    <input value={decl.parentName} onChange={(e) => set({ declaration: { ...decl, parentName: e.target.value } })} />
                  </Field>
                  <Field label="Relation to student">
                    <input value={decl.relation} onChange={(e) => set({ declaration: { ...decl, relation: e.target.value } })} placeholder="e.g. Father" />
                  </Field>
                </Grid>
                <p className="small" style={{ lineHeight: 1.5, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.75rem' }}>
                  I, <strong>{decl.parentName || '__________'}</strong>{decl.relation ? `, ${decl.relation}` : ''} of{' '}
                  <strong>{app.fullName || '__________'}</strong>, declare that the information given in this application is
                  true and correct to the best of my knowledge. My child does not currently have {declarationFor || 'the required document'},
                  and I have attached my own ID card as proof of identity in its place. I will submit the missing document
                  to Raben Learn once it is available.
                </p>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={decl.agreed}
                    onChange={(e) => set({ declaration: { ...decl, agreed: e.target.checked, signedOn: todayLocal() } })}
                    style={{ width: 'auto', marginTop: '0.2rem' }}
                  />
                  I agree to this declaration{decl.agreed && decl.signedOn ? ` (signed ${decl.signedOn})` : ''}
                </label>
              </div>
            </div>
          )}
        </Section>
      </fieldset>

      {showMissing && missing.length > 0 && (
        <div className="error small" style={{ margin: '0.75rem 0' }}>
          Please complete before submitting:
          <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.2rem' }}>{missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      {error ? <p className="error small">{error}</p> : null}
      {notice ? <p className="small" style={{ color: 'var(--green)', fontWeight: 600 }}>✓ {notice}</p> : null}

      {mode === 'student' && !locked && (
        <div className="row" style={{ gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" disabled={busy || uploading !== null} onClick={submit}>
            {busy ? 'Saving…' : app.status === 'submitted' ? 'Update submission' : 'Submit application'}
          </button>
          <button type="button" className="btn secondary" disabled={busy || uploading !== null} onClick={() => void persist(app, keepStatus === 'submitted' ? 'submitted' : keepStatus, 'Saved.')}>
            Save draft
          </button>
        </div>
      )}

      {mode === 'applicant' && !locked && (
        <div className="row" style={{ gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn primary" disabled={busy || uploading !== null} onClick={saveApplicant}>
            {busy ? 'Saving…' : savedStatus ? 'Save changes' : 'Submit application'}
          </button>
          {missing.length > 0 && <span className="muted small">Can be completed later — still missing: {missing.join(', ')}.</span>}
        </div>
      )}

      {mode === 'staff' && (
        <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          <Field label="Note to student (for “Request changes”)">
            <textarea rows={2} value={app.reviewNote} onChange={(e) => set({ reviewNote: e.target.value })} />
          </Field>
          {missing.length > 0 && <p className="muted small">Still missing: {missing.join(', ')}.</p>}
          <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" disabled={busy || uploading !== null} onClick={approve}>✓ Approve</button>
            <button type="button" className="btn secondary" disabled={busy || uploading !== null} onClick={requestChanges}>Request changes</button>
            <button type="button" className="btn secondary" disabled={busy || uploading !== null} onClick={() => void persist(app, keepStatus, 'Saved.')}>Save</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ fontSize: '1.02rem', margin: '0 0 0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)' }}>{title}</h3>
      {children}
    </section>
  )
}

function Grid({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 1rem' }}>{children}</div>
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: '0.75rem' }}>
      <span className="small" style={{ fontWeight: 600 }}>{label}{required ? <span style={{ color: 'var(--danger)' }}> *</span> : null}</span>
      {children}
    </label>
  )
}

function YesNo({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ margin: '1rem 0 0.6rem' }}>
      <div className="small" style={{ fontWeight: 600, marginBottom: '0.35rem' }}>{label}</div>
      <div className="row" style={{ gap: '0.5rem' }}>
        <button type="button" className={`btn small ${value ? 'primary' : 'secondary'}`} onClick={() => onChange(true)}>Yes</button>
        <button type="button" className={`btn small ${!value ? 'primary' : 'secondary'}`} onClick={() => onChange(false)}>No</button>
      </div>
    </div>
  )
}

interface FileSlotProps {
  kind: ApplicationFileKind
  app: StudentApplication
  studentId: string
  uploading: ApplicationFileKind | null
  disabled: boolean
  required?: boolean
  onPick: (kind: ApplicationFileKind, file: File | undefined) => void
  onRemove: (kind: ApplicationFileKind) => void
}

function FileSlot({ kind, app, studentId, uploading, disabled, required, onPick, onRemove }: FileSlotProps) {
  const meta = app.files[kind]
  const metaKey = meta ? `${meta.fileName}:${meta.size}` : ''
  // Keyed by the upload it belongs to, so a replaced/removed file never shows a stale preview.
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null)
  const preview = metaKey && loaded?.key === metaKey ? loaded.url : null

  useEffect(() => {
    if (!metaKey) return
    let cancelled = false
    void loadApplicationFile(studentId, kind).then((url) => { if (!cancelled) setLoaded({ key: metaKey, url }) }).catch(() => {})
    return () => { cancelled = true }
  }, [studentId, kind, metaKey])

  const isImage = meta?.mimeType.startsWith('image/')
  const busy = uploading === kind
  const inputId = `app-file-${kind}`

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', padding: '0.7rem', border: '1px dashed var(--border)', borderRadius: 'var(--radius)', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
      <div style={{ width: kind === 'photo' ? 72 : 96, height: kind === 'photo' ? 90 : 64, borderRadius: 8, background: 'var(--surface-soft)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {meta && isImage && preview ? (
          <img src={preview} alt={FILE_KIND_LABEL[kind]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: '1.6rem' }}>{meta ? '📄' : kind === 'photo' ? '🧑' : '🪪'}</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontWeight: 600 }}>{FILE_KIND_LABEL[kind]}{required ? <span style={{ color: 'var(--danger)' }}> *</span> : null}</div>
        <div className="muted small">{busy ? 'Uploading…' : meta ? meta.fileName : 'Not uploaded yet'}</div>
      </div>
      <div className="row" style={{ gap: '0.4rem' }}>
        {meta && preview && (
          <button type="button" className="btn small secondary" onClick={() => openDataUrl(preview)}>View</button>
        )}
        {!disabled && (
          <>
            <label htmlFor={inputId} className="btn small secondary" style={{ cursor: busy ? 'wait' : 'pointer', margin: 0 }}>
              {meta ? 'Replace' : 'Upload'}
            </label>
            <input
              id={inputId}
              type="file"
              accept={kind === 'photo' ? 'image/*' : 'image/*,application/pdf'}
              style={{ display: 'none' }}
              disabled={busy}
              onChange={(e) => { onPick(kind, e.target.files?.[0]); e.target.value = '' }}
            />
            {meta && <button type="button" className="btn small ghost" disabled={busy} onClick={() => onRemove(kind)}>Remove</button>}
          </>
        )}
      </div>
    </div>
  )
}
